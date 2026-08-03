import {
  AUTH_PATHS,
  Decimal,
  DEFAULT_CURRENCY,
  ERROR_CODES,
  HRM_PATHS,
  Money,
  PAGE_SIZE,
  type ApiError,
  type AuthenticatedSession,
  type EmployeeListResponse,
  type EmployeeResponse,
  type PayRunResponse,
  type SignUpRequest,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';
import { createFactories, type Factories } from './harness/factories';

/**
 * The conventions every module inherits, exercised through the only module that has a list.
 *
 * The claim is not "hrm's employee list pages correctly". It is that hrm wrote no paging,
 * sorting, filtering or searching code at all — it declared four fields — so whatever is
 * asserted here is a property of the platform that inventory, parties and products get for
 * nothing. The conformance pack in ticket 05 turns that from a claim into a test every
 * module runs.
 *
 * Driven over HTTP against a real database, like everything at this seam. A list convention
 * asserted against a mocked Prisma would be asserting that the arguments were assembled,
 * which is the half that cannot go wrong quietly.
 */
describe('API conventions', () => {
  let app: TestApp;
  let factories: Factories;

  const PASSWORD = 'correct-horse-battery';

  type SupertestRequest = ReturnType<TestApp['http']['get']>;

  interface Tenant {
    session: AuthenticatedSession;
    as: (request: SupertestRequest) => SupertestRequest;
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

  async function signUp(overrides: Partial<SignUpRequest> = {}): Promise<Tenant> {
    const response = await app.http
      .post(AUTH_PATHS.signUp)
      .send({
        companyName: 'Northwind Trading',
        name: 'Ada Okafor',
        email: 'ada@northwind.test',
        password: PASSWORD,
        ...overrides,
      })
      .expect(201);

    const session = response.body as AuthenticatedSession;

    // This file exercises hrm's list, which is enterprise tier. There is no self-serve
    // upgrade screen, so the tier is set directly, the same way a future billing process
    // eventually would.
    await factories.setTier(session.company.id, 'enterprise');

    return {
      session,
      as: (request) => request.set('Authorization', `Bearer ${session.token}`),
    };
  }

  /**
   * A colleague of the owner: same company, holding every ordinary HRM permission and
   * neither of its two restriction grants. They are the caller every restriction test needs,
   * because the owner holds everything by construction — and they need the ordinary
   * permissions too, or every request below would be refused for lacking them before it ever
   * reached the restriction this file is actually testing.
   */
  async function colleagueOf(owner: Tenant): Promise<Tenant['as']> {
    await factories.addColleague({
      ownerUserId: owner.session.user.id,
      name: 'Kit Bramley',
      email: 'kit@northwind.test',
      permissions: [
        'hrm:employees:read',
        'hrm:employees:write',
        'hrm:pay-runs:read',
        'hrm:pay-runs:write',
      ],
    });

    const response = await app.http
      .post(AUTH_PATHS.signIn)
      .send({ email: 'kit@northwind.test', password: PASSWORD })
      .expect(200);

    const { token } = response.body as AuthenticatedSession;
    return (request) => request.set('Authorization', `Bearer ${token}`);
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

  async function list(tenant: Tenant, query = ''): Promise<EmployeeListResponse> {
    const response = await tenant
      .as(app.http.get(`${HRM_PATHS.employees}${query}`))
      .expect(200);

    return response.body as EmployeeListResponse;
  }

  /** Twenty-six people, named so that alphabetical order is obvious at a glance. */
  async function addAlphabet(tenant: Tenant): Promise<void> {
    for (let index = 0; index < 26; index += 1) {
      const letter = String.fromCharCode(65 + index);
      await addEmployee(tenant, `${letter} Person`, `${30000 + index * 1000}.00`);
    }
  }

  describe('the one list shape', () => {
    it('describes an empty account without inventing a page', async () => {
      const owner = await signUp();

      const employees = await list(owner);

      // Zero pages rather than one: there is no page 1 of nothing, and a screen that was
      // told there was one would render paging controls over an empty state.
      expect(employees).toEqual({
        items: [],
        page: { number: 1, size: PAGE_SIZE.default, total: 0, pages: 0 },
      });
    });

    it('carries the items and where they sit in the whole', async () => {
      const owner = await signUp();
      await addAlphabet(owner);

      const second = await list(owner, '?page=2&pageSize=10');

      expect(second.items.map((employee) => employee.name)).toEqual([
        'K Person',
        'L Person',
        'M Person',
        'N Person',
        'O Person',
        'P Person',
        'Q Person',
        'R Person',
        'S Person',
        'T Person',
      ]);
      expect(second.page).toEqual({ number: 2, size: 10, total: 26, pages: 3 });
    });

    it('reports the page that was asked for, even past the end', async () => {
      const owner = await signUp();
      await addAlphabet(owner);

      const past = await list(owner, '?page=9&pageSize=10');

      // Renumbering the answer to 1 would hide the mistake and hand back a page nobody
      // requested. The total is still there, which is enough to work out what happened.
      expect(past.items).toEqual([]);
      expect(past.page).toEqual({ number: 9, size: 10, total: 26, pages: 3 });
    });

    it('refuses a page size that would ask for everything', async () => {
      const owner = await signUp();

      const response = await owner
        .as(app.http.get(`${HRM_PATHS.employees}?pageSize=100000`))
        .expect(422);

      const error = response.body as ApiError;
      expect(error.code).toBe(ERROR_CODES.validationFailed);
      expect(error.fields?.pageSize).toContain(String(PAGE_SIZE.max));
    });
  });

  describe('sorting', () => {
    it('sorts ascending by default and descending on request', async () => {
      const owner = await signUp();
      await addEmployee(owner, 'Bo Lindqvist', '52000.00');
      await addEmployee(owner, 'Ada Okafor', '48000.00');

      expect((await list(owner)).items.map((e) => e.name)).toEqual([
        'Ada Okafor',
        'Bo Lindqvist',
      ]);
      expect((await list(owner, '?sort=-name')).items.map((e) => e.name)).toEqual([
        'Bo Lindqvist',
        'Ada Okafor',
      ]);
    });

    it('pages a column full of duplicates without repeating or losing a row', async () => {
      const owner = await signUp();
      for (let index = 0; index < 12; index += 1) {
        await addEmployee(owner, 'Same Name', '40000.00');
      }

      const first = await list(owner, '?pageSize=6');
      const second = await list(owner, '?page=2&pageSize=6');
      const seen = new Set([...first.items, ...second.items].map((e) => e.id));

      // Twelve identical names leave the database free to order the ties however it likes,
      // and it need not choose the same way twice — so without the identifier tiebreak the
      // platform appends, a row can appear on both pages and another on neither.
      expect(seen.size).toBe(12);
    });

    it('refuses a field the endpoint does not offer, and says what it does', async () => {
      const owner = await signUp();

      const response = await owner
        .as(app.http.get(`${HRM_PATHS.employees}?sort=passwordHash`))
        .expect(422);

      const error = response.body as ApiError;
      expect(error.code).toBe(ERROR_CODES.validationFailed);
      expect(error.fields?.sort).toContain('passwordHash');
      expect(error.fields?.sort).toContain('name');
    });
  });

  describe('filtering and searching', () => {
    it('filters on equality and on a substring, case-insensitively', async () => {
      const owner = await signUp();
      await addEmployee(owner, 'Ada Okafor', '48000.00');
      await addEmployee(owner, 'Bo Lindqvist', '52000.00');

      expect((await list(owner, '?filter.name=Ada Okafor')).items).toHaveLength(1);
      expect(
        (await list(owner, '?filter.name.contains=OKAF')).items.map((e) => e.name),
      ).toEqual(['Ada Okafor']);
    });

    it('compares a decimal filter exactly rather than through a double', async () => {
      const owner = await signUp();
      await addEmployee(owner, 'Ada Okafor', '48000.10');
      await addEmployee(owner, 'Bo Lindqvist', '48000.11');

      const above = await list(owner, '?filter.annualSalary.gt=48000.10');

      expect(above.items.map((e) => e.name)).toEqual(['Bo Lindqvist']);
    });

    it('searches across the fields the endpoint declares searchable', async () => {
      const owner = await signUp();
      await addEmployee(owner, 'Ada Okafor', '48000.00');
      await addEmployee(owner, 'Bo Lindqvist', '52000.00');

      expect((await list(owner, '?search=lind')).items.map((e) => e.name)).toEqual([
        'Bo Lindqvist',
      ]);
    });

    it('narrows a search by the filters already applied rather than beside them', async () => {
      const owner = await signUp();
      await addEmployee(owner, 'Ada Okafor', '48000.00');
      await addEmployee(owner, 'Ada Lindqvist', '52000.00');

      const both = await list(owner, '?search=ada&filter.annualSalary.gte=50000.00');

      expect(both.items.map((e) => e.name)).toEqual(['Ada Lindqvist']);
    });

    it('refuses a filter value that is not the type the field was declared as', async () => {
      const owner = await signUp();

      const response = await owner
        .as(app.http.get(`${HRM_PATHS.employees}?filter.createdAt.gte=yesterday`))
        .expect(422);

      const error = response.body as ApiError;
      expect(error.fields?.['filter.createdAt.gte']).toContain('yesterday');
    });

    it('refuses an operator the field does not support', async () => {
      const owner = await signUp();

      const response = await owner
        .as(app.http.get(`${HRM_PATHS.employees}?filter.confidential.contains=yes`))
        .expect(422);

      expect((response.body as ApiError).fields?.['filter.confidential.contains']).toBeDefined();
    });

    it('collects everything wrong with one request before refusing it', async () => {
      const owner = await signUp();

      const response = await owner
        .as(app.http.get(`${HRM_PATHS.employees}?sort=nonsense&page=0`))
        .expect(422);

      const error = response.body as ApiError;
      expect(Object.keys(error.fields ?? {}).sort()).toEqual(['page', 'sort']);
    });
  });

  /**
   * The question ticket 03 handed to ticket 04.
   *
   * Naming a restricted column used to be a 500, which was right while no endpoint took a
   * field name from a caller. Now `?sort=annualSalary` is a URL a user can type, and the
   * answer is a 403 naming the field — not a 422, which would report a refusal as a typo,
   * and emphatically not a silently dropped clause. See ADR 0004.
   */
  describe('a field the caller may not read', () => {
    it('sorts by it for somebody holding the grant', async () => {
      const owner = await signUp();
      await addEmployee(owner, 'Ada Okafor', '48000.00');
      await addEmployee(owner, 'Bo Lindqvist', '52000.00');

      const sorted = await list(owner, '?sort=-annualSalary');

      expect(sorted.items.map((e) => e.name)).toEqual(['Bo Lindqvist', 'Ada Okafor']);
    });

    it('refuses the sort with a 403 naming the field for somebody who does not', async () => {
      const owner = await signUp();
      await addEmployee(owner, 'Ada Okafor', '48000.00');
      const asColleague = await colleagueOf(owner);

      const response = await asColleague(
        app.http.get(`${HRM_PATHS.employees}?sort=-annualSalary`),
      ).expect(403);

      const error = response.body as ApiError;
      expect(error.code).toBe(ERROR_CODES.fieldRestricted);
      expect(error.message).toContain('annualSalary');
    });

    it('refuses a filter on it too, rather than dropping the clause', async () => {
      const owner = await signUp();
      await addEmployee(owner, 'Ada Okafor', '48000.00');
      const asColleague = await colleagueOf(owner);

      const response = await asColleague(
        app.http.get(`${HRM_PATHS.employees}?filter.annualSalary.gt=1`),
      ).expect(403);

      // A dropped clause is the worst of the three answers: the list would come back looking
      // like an answer to a question nobody asked.
      expect((response.body as ApiError).code).toBe(ERROR_CODES.fieldRestricted);
    });

    it('refuses a filter on the flag marking a whole record restricted', async () => {
      const owner = await signUp();
      const asColleague = await colleagueOf(owner);

      const response = await asColleague(
        app.http.get(`${HRM_PATHS.employees}?filter.confidential=true`),
      ).expect(403);

      expect((response.body as ApiError).code).toBe(ERROR_CODES.fieldRestricted);
      expect((response.body as ApiError).message).toContain('confidential');
    });

    it('refuses it just as firmly when a search puts it inside an AND', async () => {
      const owner = await signUp();
      await addEmployee(owner, 'Ada Okafor', '48000.00');
      const asColleague = await colleagueOf(owner);

      // A search nests the filters one level down, and a check that only looked at the top
      // of the `where` let this through — answering 200 with no rows, which reads as "there
      // are none" rather than "you may not ask".
      const response = await asColleague(
        app.http.get(`${HRM_PATHS.employees}?filter.confidential=true&search=ada`),
      ).expect(403);

      expect((response.body as ApiError).code).toBe(ERROR_CODES.fieldRestricted);
    });

    it('still lists the rows, without the column', async () => {
      const owner = await signUp();
      await addEmployee(owner, 'Ada Okafor', '48000.00');
      const asColleague = await colleagueOf(owner);

      const response = await asColleague(app.http.get(HRM_PATHS.employees)).expect(200);
      const employees = response.body as EmployeeListResponse;

      expect(employees.items[0]?.name).toBe('Ada Okafor');
      expect(employees.items[0]?.annualSalary).toBeNull();
      expect(employees.page.total).toBe(1);
    });
  });

  describe('the one error shape', () => {
    it('names the offending fields on a validation failure', async () => {
      const owner = await signUp();

      const response = await owner
        .as(app.http.post(HRM_PATHS.employees))
        .send({ annualSalary: 'not a number' })
        .expect(422);

      const error = response.body as ApiError;
      expect(error.code).toBe(ERROR_CODES.validationFailed);
      expect(typeof error.message).toBe('string');
      // Both problems, not just the first: a user fixing a form should be told everything
      // that is wrong with it at once.
      expect(Object.keys(error.fields ?? {}).sort()).toEqual(['annualSalary', 'name']);
    });

    it('carries a code and a message with no fields on an ordinary refusal', async () => {
      const owner = await signUp();

      const response = await owner
        .as(app.http.get(HRM_PATHS.employee('00000000-0000-4000-8000-000000000000')))
        .expect(404);

      const error = response.body as ApiError;
      expect(error.code).toBe('not_found');
      expect(error.fields).toBeUndefined();
    });

    it('ignores a field the schema does not mention rather than refusing the request', async () => {
      const owner = await signUp();

      // A client that sends a record back exactly as it received it should not be broken by
      // the next field the API starts returning.
      const created = await owner
        .as(app.http.post(HRM_PATHS.employees))
        .send({ name: 'Ada Okafor', annualSalary: '48000.00', id: 'whatever', extra: 1 })
        .expect(201);

      expect((created.body as EmployeeResponse).name).toBe('Ada Okafor');
    });
  });

  describe('money on the wire', () => {
    it('carries the currency rather than leaving it to be assumed', async () => {
      const owner = await signUp();

      const created = await addEmployee(owner, 'Ada Okafor', '48000.10');

      expect(created.annualSalary).toEqual({
        amount: '48000.10',
        currency: DEFAULT_CURRENCY,
      });
    });

    it('refuses an amount in a currency the column cannot record', async () => {
      const owner = await signUp();

      const response = await owner
        .as(app.http.post(HRM_PATHS.employees))
        .send({ name: 'Ada Okafor', annualSalary: { amount: '48000.00', currency: 'USD' } })
        .expect(422);

      // Storing it as pounds because the column has nowhere to put "USD" is precisely the
      // silently-wrong outcome the type exists to prevent.
      expect((response.body as ApiError).fields?.annualSalary).toContain(DEFAULT_CURRENCY);
    });

    it.each(['0.01', '48000.10', '999999999999.99', '0.00'])(
      'survives the database, the API and back without alteration: %s',
      async (amount) => {
        const owner = await signUp();

        const created = await addEmployee(owner, 'Ada Okafor', amount);
        const listed = await list(owner);

        expect(created.annualSalary?.amount).toBe(amount);
        expect(listed.items[0]?.annualSalary?.amount).toBe(amount);
      },
    );

    it('refuses more precision than the column can hold', async () => {
      const owner = await signUp();

      const response = await owner
        .as(app.http.post(HRM_PATHS.employees))
        .send({ name: 'Ada Okafor', annualSalary: '48000.123' })
        .expect(422);

      expect((response.body as ApiError).fields?.annualSalary).toBeDefined();
    });
  });

  /**
   * The property that cannot be retrofitted.
   *
   * Twelve monthly pay runs apportion one annual salary across 365 days. Unrounded, the
   * twelve gross figures sum to exactly the salary; rounded to the penny, they can be off by
   * at most half a penny each. Asserting the bound rather than a precomputed total is what
   * makes this a test of *drift* rather than a copy of the implementation — a float would
   * fail it long before it failed a single-value comparison.
   */
  describe('precision across a long sequence of arithmetic', () => {
    it('does not drift when one salary is apportioned across a year', async () => {
      const owner = await signUp();
      const salary = '48000.10';
      await addEmployee(owner, 'Ada Okafor', salary);

      const months = monthsOf(2026);
      let total = Money.zero();

      for (const [start, end] of months) {
        const response = await owner
          .as(app.http.post(HRM_PATHS.payRuns))
          .send({ periodStart: start, periodEnd: end })
          .expect(201);

        const line = (response.body as PayRunResponse).lines[0];
        expect(line?.grossPay).not.toBeNull();
        total = total.plus(Money.fromValue(line!.grossPay!));
      }

      const drift = total.minus(Money.parse(salary)).amount.absolute();

      expect(drift.compare(Decimal.parse('0.06'))).toBeLessThanOrEqual(0);
      // And the total is still exact text at the penny — never a value with a tail of
      // floating-point noise on it.
      expect(total.toValue().amount).toMatch(/^\d+\.\d{2}$/);
    });
  });

  /**
   * "The list stays responsive with several thousand records."
   *
   * The budget is deliberately loose — this runs on whatever machine CI gave us, against a
   * containerised Postgres, and a tight bound would fail for reasons that have nothing to do
   * with the code. It is not calibration: it is an order of magnitude. An implementation that
   * read the table into memory to slice a page, or counted by fetching every row, takes
   * seconds here rather than milliseconds, and that is the mistake worth catching.
   */
  describe('at several thousand records', () => {
    const RECORDS = 5_000;
    const BUDGET_MS = 2_000;

    it('returns a page from deep in the list without reading the list', async () => {
      const owner = await signUp();
      await factories.fillPayroll({ companyId: owner.session.company.id, count: RECORDS });

      const started = Date.now();
      const deep = await list(owner, '?page=180&pageSize=25');
      const elapsed = Date.now() - started;

      expect(deep.page).toEqual({ number: 180, size: 25, total: RECORDS, pages: 200 });
      expect(deep.items).toHaveLength(25);
      expect(deep.items[0]?.name).toBe('Employee 4476');
      expect(elapsed).toBeLessThan(BUDGET_MS);
    });

    it('searches and sorts the whole table rather than a page of it', async () => {
      const owner = await signUp();
      await factories.fillPayroll({ companyId: owner.session.company.id, count: RECORDS });

      const started = Date.now();
      const matches = await list(owner, '?search=4999&sort=-name');
      const elapsed = Date.now() - started;

      // One row, and it is nowhere near the first page in the default order — so a search
      // that only looked at the page it was holding would find nothing.
      expect(matches.items.map((employee) => employee.name)).toEqual(['Employee 4999']);
      expect(matches.page.total).toBe(1);
      expect(elapsed).toBeLessThan(BUDGET_MS);
    });
  });

  /** The twelve calendar months of a non-leap year, as inclusive `YYYY-MM-DD` pairs. */
  function monthsOf(year: number): Array<[string, string]> {
    return Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, '0');
      const lastDay = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
      return [`${year}-${month}-01`, `${year}-${month}-${String(lastDay).padStart(2, '0')}`];
    });
  }
});
