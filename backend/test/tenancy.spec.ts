import {
  AUTH_PATHS,
  HRM_PATHS,
  HRM_ERROR_CODES,
  type AuthenticatedSession,
  type EmployeeListResponse,
  type EmployeeResponse,
  type PayRunResponse,
  type SignUpRequest,
} from '@erp/shared';
import { Prisma } from '@prisma/client';
import {
  ImmutableRecordError,
  MissingCompanyContextError,
  RestrictedFieldError,
  RestrictedRecordError,
} from '../src/platform/tenancy';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';
import { createFactories, type Factories } from './harness/factories';

/**
 * Tenant isolation — the suite's highest-value test, per the spec.
 *
 * Two companies, both created the way a real company is created, both driven over HTTP with
 * their own sessions. Nothing is mocked and nothing is arranged past what a user could do,
 * because the claim being made is about the running system rather than about a function.
 *
 * The claim is stronger than "the queries have the right filter on them". It is that there
 * is no filter to get wrong: the module code these requests run through does not mention a
 * company anywhere, so the isolation asserted below is a property of the platform and every
 * module still to be written inherits it.
 */
describe('tenant scoping', () => {
  let app: TestApp;
  let factories: Factories;

  const PASSWORD = 'correct-horse-battery';

  interface Tenant {
    session: AuthenticatedSession;
    /** Requests as this company's owner. */
    as: (request: SupertestRequest) => SupertestRequest;
  }

  type SupertestRequest = ReturnType<TestApp['http']['get']>;

  async function signUp(overrides: Partial<SignUpRequest>): Promise<Tenant> {
    const response = await app.http
      .post(AUTH_PATHS.signUp)
      .send({ password: PASSWORD, ...overrides })
      .expect(201);

    const session = response.body as AuthenticatedSession;
    return {
      session,
      as: (request) => request.set('Authorization', `Bearer ${session.token}`),
    };
  }

  function bearer(token: string) {
    return (request: SupertestRequest): SupertestRequest =>
      request.set('Authorization', `Bearer ${token}`);
  }

  async function northwind(): Promise<Tenant> {
    return signUp({
      companyName: 'Northwind Trading',
      name: 'Ada Okafor',
      email: 'ada@northwind.test',
    });
  }

  async function tradewinds(): Promise<Tenant> {
    return signUp({
      companyName: 'Tradewinds Supply',
      name: 'Bo Lindqvist',
      email: 'bo@tradewinds.test',
    });
  }

  /**
   * A second person in the company, holding nothing.
   *
   * Same company, so tenancy lets them see everything the owner can — which is exactly what
   * makes them the right person to prove that restriction is a separate thing from scoping.
   * Until ticket 07 there is no way to invite one, so the harness arranges it directly.
   */
  async function colleagueWithout(tenant: Tenant): Promise<Tenant['as']> {
    await factories.addColleague({
      ownerUserId: tenant.session.user.id,
      name: 'Kit Moreau',
      email: 'kit@northwind.test',
    });

    const signedIn = await app.http
      .post(AUTH_PATHS.signIn)
      .send({ email: 'kit@northwind.test', password: PASSWORD })
      .expect(200);

    return bearer((signedIn.body as AuthenticatedSession).token);
  }

  async function addEmployee(
    tenant: Tenant,
    name: string,
    annualSalary: string,
  ): Promise<EmployeeResponse> {
    const response = await tenant
      .as(app.http.post(HRM_PATHS.employees))
      .send({ name, annualSalary })
      .expect(201);
    return response.body as EmployeeResponse;
  }

  beforeAll(async () => {
    app = await createTestApp();
    factories = createFactories(app.prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  describe('two companies, and nothing between them', () => {
    it('shows each company only its own records', async () => {
      const a = await northwind();
      const b = await tradewinds();

      await addEmployee(a, 'Ada Okafor', '48000.00');
      await addEmployee(b, 'Bo Lindqvist', '52000.00');

      const seenByA = await a.as(app.http.get(HRM_PATHS.employees)).expect(200);
      const seenByB = await b.as(app.http.get(HRM_PATHS.employees)).expect(200);

      expect((seenByA.body as EmployeeListResponse).employees.map((e) => e.name)).toEqual([
        'Ada Okafor',
      ]);
      expect((seenByB.body as EmployeeListResponse).employees.map((e) => e.name)).toEqual([
        'Bo Lindqvist',
      ]);

      // Both rows are really there. The list was short because it was scoped, not because
      // the write failed — a test that could pass against a broken insert proves nothing.
      expect(await app.prisma.employee.count()).toBe(2);
    });

    it('refuses a read of another company row by its exact identifier', async () => {
      const a = await northwind();
      const b = await tradewinds();

      await addEmployee(a, 'Ada Okafor', '48000.00');
      const payRun = await calculatePayRun(a, '2026-07-01', '2026-07-31');

      // B has the id. Knowing an identifier is not access.
      const response = await b.as(app.http.get(HRM_PATHS.payRun(payRun.id))).expect(404);
      expect(response.body.code).toBe(HRM_ERROR_CODES.payRunNotFound);
    });

    it('refuses an update of another company row by its exact identifier', async () => {
      const a = await northwind();
      const b = await tradewinds();

      const employee = await addEmployee(a, 'Ada Okafor', '48000.00');

      const response = await b
        .as(app.http.patch(HRM_PATHS.employee(employee.id)))
        .send({ name: 'Renamed By A Stranger' })
        .expect(404);
      expect(response.body.code).toBe(HRM_ERROR_CODES.employeeNotFound);

      // Not merely refused — untouched. A refusal that had already written would be worse
      // than no refusal at all, because it would look correct from the outside.
      const stored = await app.prisma.employee.findUniqueOrThrow({
        where: { id: employee.id },
      });
      expect(stored.name).toBe('Ada Okafor');
    });

    it('refuses a delete of another company row by its exact identifier', async () => {
      const a = await northwind();
      const b = await tradewinds();

      const employee = await addEmployee(a, 'Ada Okafor', '48000.00');

      await b.as(app.http.delete(HRM_PATHS.employee(employee.id))).expect(404);

      expect(await app.prisma.employee.count({ where: { id: employee.id } })).toBe(1);
    });

    it('answers "not yours" and "not there" identically', async () => {
      const a = await northwind();
      const b = await tradewinds();

      const employee = await addEmployee(a, 'Ada Okafor', '48000.00');

      const someoneElses = await b
        .as(app.http.patch(HRM_PATHS.employee(employee.id)))
        .send({ name: 'Nope' })
        .expect(404);
      const nobodys = await b
        .as(app.http.patch(HRM_PATHS.employee('0b6d2b3e-0000-4000-8000-000000000000')))
        .send({ name: 'Nope' })
        .expect(404);

      // Telling them apart would make every endpoint a way of counting a competitor's
      // records one identifier at a time.
      expect(someoneElses.body).toEqual(nobodys.body);
    });

    it('records the acting company on a write, without being asked to', async () => {
      const a = await northwind();
      const b = await tradewinds();

      const employee = await a
        .as(app.http.post(HRM_PATHS.employees))
        // A caller naming somebody else's company. The field is not part of the request
        // shape, so this is a caller trying it on rather than a caller making a mistake.
        .send({
          name: 'Ada Okafor',
          annualSalary: '48000.00',
          companyId: b.session.company.id,
        })
        .expect(201);

      const stored = await app.prisma.employee.findUniqueOrThrow({
        where: { id: (employee.body as EmployeeResponse).id },
      });
      expect(stored.companyId).toBe(a.session.company.id);
    });
  });

  describe('a query with no company', () => {
    it('throws rather than returning every company row', async () => {
      const a = await northwind();
      await addEmployee(a, 'Ada Okafor', '48000.00');

      // No request, so no company: exactly the state a forgotten `runInCompany` in a script
      // or a job would be in. The row exists and is not returned; the query does not run.
      await expect(app.scoped.employee.findMany()).rejects.toBeInstanceOf(
        MissingCompanyContextError,
      );

      // …and the same query with a company established answers normally, so the throw is
      // about the missing context and not about the query being wrong.
      const found = await app.tenancy.runInCompany(
        { companyId: a.session.company.id, grants: 'all' },
        () => app.scoped.employee.findMany(),
      );
      expect(found).toHaveLength(1);
    });

    it('names the model and what to do about it', async () => {
      const error = await app.scoped.payRun.findMany().catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(MissingCompanyContextError);
      expect((error as Error).message).toContain('PayRun');
      expect((error as Error).message).toContain('runInCompany');
    });

    it('leaves tables that belong to no company alone', async () => {
      // Sessions are unscoped and say so, with a reason, in company-owned.ts: a session is
      // what establishes company context, so it cannot require one. Without that exemption
      // authenticating a request would deadlock against the mechanism it feeds.
      await expect(app.scoped.session.findMany()).resolves.toEqual([]);
    });
  });

  describe('records that cannot be edited', () => {
    it('refuses an update or a delete of a pay run at the platform, not at the route', async () => {
      const a = await northwind();
      await addEmployee(a, 'Ada Okafor', '48000.00');
      const payRun = await calculatePayRun(a, '2026-07-01', '2026-07-31');

      await app.tenancy.runInCompany(
        { companyId: a.session.company.id, grants: 'all' },
        async () => {
          // There is no route that would do either of these. That is not what makes the
          // record immutable — the next person to add one is. This is.
          await expect(
            app.scoped.payRun.update({
              where: { id: payRun.id },
              data: { periodEnd: new Date('2026-08-31') },
            }),
          ).rejects.toBeInstanceOf(ImmutableRecordError);

          await expect(
            app.scoped.payRunLine.deleteMany({ where: { payRunId: payRun.id } }),
          ).rejects.toBeInstanceOf(ImmutableRecordError);
        },
      );
    });

    it('refuses a second run for a period rather than recalculating', async () => {
      const a = await northwind();
      await addEmployee(a, 'Ada Okafor', '48000.00');
      await calculatePayRun(a, '2026-07-01', '2026-07-31');

      const response = await a
        .as(app.http.post(HRM_PATHS.payRuns))
        .send({ periodStart: '2026-07-01', periodEnd: '2026-07-31' })
        .expect(409);

      expect(response.body.code).toBe(HRM_ERROR_CODES.payRunAlreadyCalculated);
    });

    it('lets one company calculate a period another has already calculated', async () => {
      const a = await northwind();
      const b = await tradewinds();
      await addEmployee(a, 'Ada Okafor', '48000.00');
      await addEmployee(b, 'Bo Lindqvist', '52000.00');

      // The uniqueness is per company. Scoping that made it global would be an isolation
      // failure that looked like a validation rule.
      await calculatePayRun(a, '2026-07-01', '2026-07-31');
      await calculatePayRun(b, '2026-07-01', '2026-07-31');
    });
  });

  describe('a field restricted beyond company scope', () => {
    it('withholds the value from a colleague who may not read it', async () => {
      const a = await northwind();
      await addEmployee(a, 'Ada Okafor', '48000.00');
      const asColleague = await colleagueWithout(a);

      const owner = await a.as(app.http.get(HRM_PATHS.employees)).expect(200);
      const colleague = await asColleague(app.http.get(HRM_PATHS.employees)).expect(200);

      // Same company, same endpoint, same row — a different answer about one column.
      expect((owner.body as EmployeeListResponse).employees[0]?.annualSalary).toBe('48000.00');
      expect((colleague.body as EmployeeListResponse).employees[0]?.annualSalary).toBeNull();
      // The rest of the record is not sensitive and is not withheld: the list is still
      // useful to somebody who may know who their colleagues are but not what they earn.
      expect((colleague.body as EmployeeListResponse).employees[0]?.name).toBe('Ada Okafor');
    });

    it('refuses outright where the value is the point of the request', async () => {
      const a = await northwind();
      await addEmployee(a, 'Ada Okafor', '48000.00');
      const asColleague = await colleagueWithout(a);

      const response = await asColleague(app.http.post(HRM_PATHS.payRuns))
        .send({ periodStart: '2026-07-01', periodEnd: '2026-07-31' })
        .expect(403);

      // A pay run of blank amounts would be worse than no pay run.
      expect(response.body.code).toBe(HRM_ERROR_CODES.payRestricted);
      expect(await app.prisma.payRun.count()).toBe(0);
    });

    it('withholds the amounts on a pay run the colleague may otherwise read', async () => {
      const a = await northwind();
      await addEmployee(a, 'Ada Okafor', '48000.00');
      const payRun = await calculatePayRun(a, '2026-07-01', '2026-07-31');
      const asColleague = await colleagueWithout(a);

      const response = await asColleague(app.http.get(HRM_PATHS.payRun(payRun.id))).expect(200);

      const body = response.body as PayRunResponse;
      expect(body.lines).toHaveLength(1);
      expect(body.lines[0]?.employeeName).toBe('Ada Okafor');
      expect(body.lines[0]?.grossPay).toBeNull();
    });

    it('refuses a query that names the field instead of quietly emptying it', async () => {
      const a = await northwind();
      await addEmployee(a, 'Ada Okafor', '48000.00');
      const withoutTheGrant = { companyId: a.session.company.id, grants: new Set<string>() };

      await app.tenancy.runInCompany(withoutTheGrant, async () => {
        // Selecting it outright.
        await expect(
          app.scoped.employee.findMany({ select: { id: true, annualSalary: true } }),
        ).rejects.toBeInstanceOf(RestrictedFieldError);

        // Probing it a value at a time through a filter, which would read it just as
        // surely, one bit per request.
        await expect(
          app.scoped.employee.findMany({
            where: { AND: [{ annualSalary: { gt: new Prisma.Decimal(40000) } }] },
          }),
        ).rejects.toBeInstanceOf(RestrictedFieldError);

        // Summing it.
        await expect(
          app.scoped.employee.aggregate({ _sum: { annualSalary: true } }),
        ).rejects.toBeInstanceOf(RestrictedFieldError);

        // Reaching it through a relation, where the platform could not omit it.
        await expect(
          app.scoped.payRunLine.findMany({ include: { employee: true } }),
        ).rejects.toBeInstanceOf(RestrictedFieldError);

        // Probing a restricted column on a *related* table. The queried model is Employee,
        // whose own restriction is on a different column — the walk has to follow the
        // relation to notice that `grossPay` is not this caller's to filter on.
        await expect(
          app.scoped.employee.findMany({
            where: { payRunLines: { some: { grossPay: { gt: new Prisma.Decimal(1) } } } },
          }),
        ).rejects.toBeInstanceOf(RestrictedFieldError);

        // Grouping by it, which hands back the distinct values without ever selecting it.
        await expect(
          app.scoped.employee.groupBy({ by: ['annualSalary'] }),
        ).rejects.toBeInstanceOf(RestrictedFieldError);

        // Ordering by it, which reveals the ranking a value at a time.
        await expect(
          app.scoped.employee.findMany({ orderBy: { annualSalary: 'desc' } }),
        ).rejects.toBeInstanceOf(RestrictedFieldError);
      });
    });

    it('allows a nested read that names only the columns it may have', async () => {
      const a = await northwind();
      await addEmployee(a, 'Ada Okafor', '48000.00');
      await calculatePayRun(a, '2026-07-01', '2026-07-31');

      await app.tenancy.runInCompany(
        { companyId: a.session.company.id, grants: new Set(['hrm:pay:read']) },
        async () => {
          // Refusing every `include` would make the restriction a tax on unrelated code.
          // What is refused is reaching a column the caller may not read — so a nested
          // `select` that does not name one is fine.
          const lines = await app.scoped.payRunLine.findMany({
            include: { employee: { select: { name: true } } },
          });
          expect(lines[0]?.employee.name).toBe('Ada Okafor');
        },
      );
    });

    it('lets the same queries through for somebody who holds the grant', async () => {
      const a = await northwind();
      await addEmployee(a, 'Ada Okafor', '48000.00');

      await app.tenancy.runInCompany(
        { companyId: a.session.company.id, grants: new Set(['hrm:pay:read']) },
        async () => {
          const [employee] = await app.scoped.employee.findMany({
            select: { id: true, annualSalary: true },
          });
          expect(employee?.annualSalary.toFixed(2)).toBe('48000.00');
        },
      );
    });
  });

  describe('a record restricted beyond company scope', () => {
    it('is unreachable, not merely unlisted, without the grant', async () => {
      const a = await northwind();

      const confidential = await a
        .as(app.http.post(HRM_PATHS.employees))
        .send({ name: 'Ada Okafor', annualSalary: '250000.00', confidential: true })
        .expect(201);
      await addEmployee(a, 'Bo Lindqvist', '48000.00');

      const id = (confidential.body as EmployeeResponse).id;
      const asColleague = await colleagueWithout(a);

      const listed = await asColleague(app.http.get(HRM_PATHS.employees)).expect(200);
      expect((listed.body as EmployeeListResponse).employees.map((e) => e.name)).toEqual([
        'Bo Lindqvist',
      ]);

      // Absent from the list is the easy half. The record is also unreachable by its own
      // identifier and cannot be changed or removed — which is the difference between a
      // restricted record and a screen that chose not to render one.
      await asColleague(app.http.patch(HRM_PATHS.employee(id)))
        .send({ name: 'Renamed' })
        .expect(404);
      await asColleague(app.http.delete(HRM_PATHS.employee(id))).expect(404);

      expect(await app.prisma.employee.count()).toBe(2);
    });

    it('is ordinary data to somebody who holds the grant', async () => {
      const a = await northwind();
      await a
        .as(app.http.post(HRM_PATHS.employees))
        .send({ name: 'Ada Okafor', annualSalary: '250000.00', confidential: true })
        .expect(201);

      const listed = await a.as(app.http.get(HRM_PATHS.employees)).expect(200);
      const employees = (listed.body as EmployeeListResponse).employees;
      expect(employees).toHaveLength(1);
      expect(employees[0]?.confidential).toBe(true);
    });

    it('refuses a filter on the flag rather than quietly overruling it', async () => {
      const a = await northwind();
      const withoutTheGrant = { companyId: a.session.company.id, grants: new Set<string>() };

      await app.tenancy.runInCompany(withoutTheGrant, async () => {
        // Silently rewriting this to `confidential: false` would answer a different
        // question from the one asked, and look like it had answered the right one.
        await expect(
          app.scoped.employee.findMany({ where: { confidential: true } }),
        ).rejects.toBeInstanceOf(RestrictedRecordError);

        // And creating one would put a row in the database the writer cannot read back.
        await expect(
          app.scoped.employee.create({
            data: {
              name: 'Ghost',
              annualSalary: new Prisma.Decimal(1),
              confidential: true,
            } as never,
          }),
        ).rejects.toBeInstanceOf(RestrictedRecordError);
      });
    });
  });

  describe('the calculation the stub exists to have', () => {
    it('apportions the annual figure across the days in the period', async () => {
      const a = await northwind();
      await addEmployee(a, 'Ada Okafor', '48000.00');

      const payRun = await calculatePayRun(a, '2026-07-01', '2026-07-31');

      // 48000 × 31 ÷ 365, to the penny — arithmetic on decimals rather than on doubles,
      // which is the rule the spec sets for money and this is the first module to hold it.
      expect(payRun.lines[0]?.grossPay).toBe('4076.71');
      expect(payRun.periodStart).toBe('2026-07-01');
      expect(payRun.periodEnd).toBe('2026-07-31');
    });

    it('covers everybody on the payroll at the moment it runs', async () => {
      const a = await northwind();
      await addEmployee(a, 'Ada Okafor', '48000.00');
      await addEmployee(a, 'Zoë Bianchi', '60000.00');

      const payRun = await calculatePayRun(a, '2026-07-01', '2026-07-31');

      expect(payRun.lines.map((line) => line.employeeName)).toEqual([
        'Ada Okafor',
        'Zoë Bianchi',
      ]);
    });

    it('keeps an employee who has been paid', async () => {
      const a = await northwind();
      const employee = await addEmployee(a, 'Ada Okafor', '48000.00');
      await calculatePayRun(a, '2026-07-01', '2026-07-31');

      const response = await a
        .as(app.http.delete(HRM_PATHS.employee(employee.id)))
        .expect(409);

      // The run is immutable and its lines name this person. Removing them would leave a
      // permanent record pointing at nobody.
      expect(response.body.code).toBe(HRM_ERROR_CODES.employeeHasPayHistory);
    });
  });

  async function calculatePayRun(
    tenant: Tenant,
    periodStart: string,
    periodEnd: string,
  ): Promise<PayRunResponse> {
    const response = await tenant
      .as(app.http.post(HRM_PATHS.payRuns))
      .send({ periodStart, periodEnd })
      .expect(201);
    return response.body as PayRunResponse;
  }
});
