import {
  AUTH_PATHS,
  ERROR_CODES,
  IDENTITY_ERROR_CODES,
  IDENTITY_PATHS,
  PARTY_PATHS,
  PERMISSIONS_PATH,
  PRODUCT_PATHS,
  type ApiError,
  type AuthenticatedSession,
  type PermissionsResponse,
  type RoleListResponse,
  type RoleResponse,
  type SignUpRequest,
  type UserResponse,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';
import { createFactories, type Factories } from './harness/factories';

/**
 * Roles: the permission catalogue, creating and editing roles, assigning several to one
 * person, and the one role a company's owner can never be locked out by.
 *
 * A colleague is added through `factories.addColleague` — there is no endpoint for "add a
 * person with no role at all", and there should not be, since a real one always arrives
 * through an invitation. What *is* the API's job, and what this file drives over HTTP, is
 * everything that happens once they exist: creating roles, assigning them, and what each
 * assignment does and does not let somebody reach.
 */
describe('roles and permissions', () => {
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
    return { session, as: (request) => request.set('Authorization', `Bearer ${session.token}`) };
  }

  /** A colleague holding no role at all — the state every invited person starts in. */
  async function colleague(owner: Tenant, email = 'kit@northwind.test'): Promise<Tenant> {
    await factories.addColleague({
      ownerUserId: owner.session.user.id,
      name: 'Kit Moreau',
      email,
    });

    const response = await app.http
      .post(AUTH_PATHS.signIn)
      .send({ email, password: PASSWORD })
      .expect(200);

    const session = response.body as AuthenticatedSession;
    return { session, as: (request) => request.set('Authorization', `Bearer ${session.token}`) };
  }

  async function addRole(owner: Tenant, name: string, permissions: string[]): Promise<RoleResponse> {
    const response = await owner
      .as(app.http.post(IDENTITY_PATHS.roles))
      .send({ name, permissions })
      .expect(201);
    return response.body as RoleResponse;
  }

  describe('the permission catalogue', () => {
    it('is assembled from module manifests, with no central list to edit', async () => {
      const owner = await signUp();

      const response = await owner.as(app.http.get(PERMISSIONS_PATH)).expect(200);
      const permissions = (response.body as PermissionsResponse).permissions;

      // Every one of these was declared by its own module's manifest — nothing here compiled
      // a list by hand.
      expect(permissions).toEqual(
        expect.arrayContaining([
          'hrm:pay:read',
          'hrm:employees:read-confidential',
          'parties:parties:read',
          'products:products:write',
          'identity:roles:write',
        ]),
      );
    });

    it('refuses an anonymous caller, like every other endpoint', async () => {
      const response = await app.http.get(PERMISSIONS_PATH).expect(401);
      expect((response.body as ApiError).code).toBe(ERROR_CODES.unauthenticated);
    });
  });

  describe('creating and editing roles', () => {
    it('creates a role with the permissions given, and lists it', async () => {
      const owner = await signUp();

      const created = await addRole(owner, 'Stock clerk', [
        'parties:parties:read',
        'products:products:read',
      ]);
      expect(created.permissions.sort()).toEqual(['parties:parties:read', 'products:products:read']);

      const listed = await owner.as(app.http.get(IDENTITY_PATHS.roles)).expect(200);
      expect((listed.body as RoleListResponse).items.map((role) => role.name)).toEqual([
        'Stock clerk',
      ]);
    });

    it('renames a role and replaces its permissions wholesale, not by diffing', async () => {
      const owner = await signUp();
      const role = await addRole(owner, 'Stock clerk', ['parties:parties:read']);

      const changed = await owner
        .as(app.http.patch(IDENTITY_PATHS.role(role.id)))
        .send({ name: 'Warehouse clerk', permissions: ['products:products:read'] })
        .expect(200);

      const body = changed.body as RoleResponse;
      expect(body.name).toBe('Warehouse clerk');
      // Replaced, not merged: the old permission is gone rather than kept alongside the new.
      expect(body.permissions).toEqual(['products:products:read']);
    });

    it('names the offending field for invalid input', async () => {
      const owner = await signUp();

      const refused = await owner
        .as(app.http.post(IDENTITY_PATHS.roles))
        .send({ name: '', permissions: [] })
        .expect(422);

      expect(refused.body.code).toBe(ERROR_CODES.validationFailed);
      expect(refused.body.fields).toHaveProperty('name');
    });

    it('refuses a colleague without identity:roles:write from creating one', async () => {
      const owner = await signUp();
      const kit = await colleague(owner);

      const response = await kit
        .as(app.http.post(IDENTITY_PATHS.roles))
        .send({ name: 'Anything', permissions: [] })
        .expect(403);

      expect((response.body as ApiError).code).toBe(ERROR_CODES.forbidden);
    });
  });

  describe('assigning roles to people', () => {
    it('assigns a role, which the same session reflects on its very next request', async () => {
      const owner = await signUp();
      const kit = await colleague(owner);

      // Before assignment: the colleague holds nothing, and it shows.
      await kit.as(app.http.get(PARTY_PATHS.parties)).expect(403);

      const role = await addRole(owner, 'Reads parties', ['parties:parties:read']);
      const assigned = await owner
        .as(app.http.post(IDENTITY_PATHS.userRoles(kit.session.user.id)))
        .send({ roleId: role.id })
        .expect(200);

      expect((assigned.body as UserResponse).roles.map((r) => r.name)).toEqual(['Reads parties']);

      // Same bearer token as before, no new sign-in: permissions are resolved fresh on every
      // request rather than carried in the token.
      await kit.as(app.http.get(PARTY_PATHS.parties)).expect(200);
    });

    it('lets a person hold several roles, whose permissions union', async () => {
      const owner = await signUp();
      const kit = await colleague(owner);

      const readsParties = await addRole(owner, 'Reads parties', ['parties:parties:read']);
      const readsProducts = await addRole(owner, 'Reads products', ['products:products:read']);

      await owner
        .as(app.http.post(IDENTITY_PATHS.userRoles(kit.session.user.id)))
        .send({ roleId: readsParties.id })
        .expect(200);
      await owner
        .as(app.http.post(IDENTITY_PATHS.userRoles(kit.session.user.id)))
        .send({ roleId: readsProducts.id })
        .expect(200);

      await kit.as(app.http.get(PARTY_PATHS.parties)).expect(200);
      await kit.as(app.http.get(PRODUCT_PATHS.products)).expect(200);
    });

    it('removes one role and leaves whatever the others still grant', async () => {
      const owner = await signUp();
      const kit = await colleague(owner);

      const readsParties = await addRole(owner, 'Reads parties', ['parties:parties:read']);
      const readsProducts = await addRole(owner, 'Reads products', ['products:products:read']);
      await owner
        .as(app.http.post(IDENTITY_PATHS.userRoles(kit.session.user.id)))
        .send({ roleId: readsParties.id })
        .expect(200);
      await owner
        .as(app.http.post(IDENTITY_PATHS.userRoles(kit.session.user.id)))
        .send({ roleId: readsProducts.id })
        .expect(200);

      await owner
        .as(app.http.delete(IDENTITY_PATHS.userRole(kit.session.user.id, readsParties.id)))
        .expect(200);

      await kit.as(app.http.get(PARTY_PATHS.parties)).expect(403);
      await kit.as(app.http.get(PRODUCT_PATHS.products)).expect(200);
    });

    it('denies a whole module by simply never granting any of its permissions', async () => {
      const owner = await signUp();
      const kit = await colleague(owner);

      // A role that names every parties permission and not one products permission — "deny
      // a whole module" is not a separate switch, it is the absence of that module's strings.
      const role = await addRole(owner, 'Parties only', [
        'parties:parties:read',
        'parties:parties:write',
      ]);
      await owner
        .as(app.http.post(IDENTITY_PATHS.userRoles(kit.session.user.id)))
        .send({ roleId: role.id })
        .expect(200);

      await kit.as(app.http.get(PARTY_PATHS.parties)).expect(200);
      const refused = await kit.as(app.http.get(PRODUCT_PATHS.products)).expect(403);
      expect((refused.body as ApiError).code).toBe(ERROR_CODES.forbidden);
    });
  });

  describe('deleting a role in use', () => {
    it('refuses while somebody holds it, and succeeds once they are reassigned', async () => {
      const owner = await signUp();
      const kit = await colleague(owner);
      const role = await addRole(owner, 'Reads parties', ['parties:parties:read']);

      await owner
        .as(app.http.post(IDENTITY_PATHS.userRoles(kit.session.user.id)))
        .send({ roleId: role.id })
        .expect(200);

      const blocked = await owner.as(app.http.delete(IDENTITY_PATHS.role(role.id))).expect(409);
      expect((blocked.body as ApiError).code).toBe(IDENTITY_ERROR_CODES.roleInUse);

      await owner
        .as(app.http.delete(IDENTITY_PATHS.userRole(kit.session.user.id, role.id)))
        .expect(200);

      await owner.as(app.http.delete(IDENTITY_PATHS.role(role.id))).expect(204);
      await owner.as(app.http.get(IDENTITY_PATHS.role(role.id))).expect(404);
    });
  });

  describe('the company creator', () => {
    it('retains full access however roles are assigned, because it never depends on one', async () => {
      const owner = await signUp();

      // A role granting almost nothing, assigned to the owner. If access depended on the
      // role, this would narrow what they can do; it does not, because `isOwner` bypasses
      // role resolution unconditionally.
      const stingy = await addRole(owner, 'Almost nothing', ['parties:parties:read']);
      await owner
        .as(app.http.post(IDENTITY_PATHS.userRoles(owner.session.user.id)))
        .send({ roleId: stingy.id })
        .expect(200);

      await owner.as(app.http.get(PRODUCT_PATHS.products)).expect(200);
      await owner.as(app.http.post(IDENTITY_PATHS.roles)).send({
        name: 'Another role',
        permissions: [],
      }).expect(201);
    });
  });
});
