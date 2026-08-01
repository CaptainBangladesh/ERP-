import {
  AUTH_PATHS,
  ERROR_CODES,
  IDENTITY_ERROR_CODES,
  NAVIGATION_PATH,
  isApiError,
  type AuthenticatedSession,
  type SignUpRequest,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';
import { createFactories, type Factories } from './harness/factories';

/**
 * Seam 1 — the HTTP boundary. The real application, a real database, nothing mocked.
 *
 * Every test here starts from an empty database, because that is the state a real first
 * user starts from: nothing is seeded, so the first company in the system is the one
 * sign-up creates.
 */
describe('identity and access', () => {
  let app: TestApp;
  let factories: Factories;

  const signUpBody: SignUpRequest = {
    companyName: 'Northwind Trading',
    name: 'Ada Okafor',
    email: 'ada@northwind.test',
    password: 'correct-horse-battery',
  };

  async function signUp(
    overrides: Partial<SignUpRequest> = {},
  ): Promise<AuthenticatedSession> {
    const response = await app.http
      .post(AUTH_PATHS.signUp)
      .send({ ...signUpBody, ...overrides })
      .expect(201);
    return response.body as AuthenticatedSession;
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

  describe('signing up', () => {
    it('creates a company and its first user in one step', async () => {
      const session = await signUp();

      expect(session).toEqual({
        token: expect.any(String),
        expiresAt: expect.any(String),
        company: { id: expect.any(String), name: 'Northwind Trading' },
        user: {
          id: expect.any(String),
          name: 'Ada Okafor',
          email: 'ada@northwind.test',
          isOwner: true,
        },
      });

      // The company that exists is the one the user typed. Nothing was seeded ahead of it.
      const companies = await app.prisma.company.findMany();
      expect(companies).toHaveLength(1);
      expect(companies[0]?.name).toBe('Northwind Trading');
    });

    it('makes the creator the owner by recording that they created it', async () => {
      const session = await signUp();

      const company = await app.prisma.company.findUniqueOrThrow({
        where: { id: session.company.id },
      });

      // Ownership is a fact about who created the company, not a row somebody inserted.
      expect(company.ownerUserId).toBe(session.user.id);
    });

    it('stores the password hashed, and never hands it back', async () => {
      const session = await signUp();

      const user = await app.prisma.user.findUniqueOrThrow({
        where: { id: session.user.id },
      });

      expect(user.passwordHash).not.toContain(signUpBody.password);
      expect(JSON.stringify(session)).not.toContain(signUpBody.password);
      // A hash a reader could reverse by inspection would defeat the point; the salt is
      // what makes two identical passwords store differently.
      const second = await app.http
        .post(AUTH_PATHS.signUp)
        .send({ ...signUpBody, companyName: 'Other', email: 'b@northwind.test' })
        .expect(201);
      const otherUser = await app.prisma.user.findUniqueOrThrow({
        where: { id: (second.body as AuthenticatedSession).user.id },
      });
      expect(otherUser.passwordHash).not.toBe(user.passwordHash);
    });

    it('refuses a second registration of the same email, and says why', async () => {
      await signUp();

      const response = await app.http
        .post(AUTH_PATHS.signUp)
        .send({ ...signUpBody, companyName: 'A Different Company' })
        .expect(409);

      expect(response.body.code).toBe(IDENTITY_ERROR_CODES.emailAlreadyRegistered);
      expect(response.body.fields?.email).toMatch(/already/i);

      expect(await app.prisma.company.count()).toBe(1);
    });

    it('treats an email as the same address whatever its casing', async () => {
      await signUp();

      const response = await app.http
        .post(AUTH_PATHS.signUp)
        .send({ ...signUpBody, email: 'ADA@Northwind.test' })
        .expect(409);

      expect(response.body.code).toBe(IDENTITY_ERROR_CODES.emailAlreadyRegistered);
    });

    it('names the offending field for every invalid input', async () => {
      const response = await app.http
        .post(AUTH_PATHS.signUp)
        .send({ companyName: '  ', name: '', email: 'not-an-email', password: 'short' })
        .expect(422);

      expect(response.body.code).toBe(ERROR_CODES.validationFailed);
      // A form can only put a message beside an input if the response says which input.
      expect(Object.keys(response.body.fields ?? {}).sort()).toEqual([
        'companyName',
        'email',
        'name',
        'password',
      ]);
      expect(response.body.fields.password).toMatch(/12/);

      expect(await app.prisma.company.count()).toBe(0);
    });

    it('refuses a body that is missing fields entirely', async () => {
      const response = await app.http.post(AUTH_PATHS.signUp).send({}).expect(422);

      expect(response.body.code).toBe(ERROR_CODES.validationFailed);
      expect(response.body.fields.email).toEqual(expect.any(String));
    });

    it('leaves nothing behind when sign-up fails', async () => {
      await signUp();
      await app.http
        .post(AUTH_PATHS.signUp)
        .send({ ...signUpBody, companyName: 'Ghost Company' })
        .expect(409);

      // The company is written before the user inside one transaction. If the user insert
      // fails, a half-made company must not survive it.
      const names = (await app.prisma.company.findMany()).map((c) => c.name);
      expect(names).toEqual(['Northwind Trading']);
    });
  });

  describe('signing in', () => {
    it('establishes a session carrying the user and their company', async () => {
      const signedUp = await signUp();

      const response = await app.http
        .post(AUTH_PATHS.signIn)
        .send({ email: signUpBody.email, password: signUpBody.password })
        .expect(200);

      const session = response.body as AuthenticatedSession;
      expect(session.user.id).toBe(signedUp.user.id);
      expect(session.company).toEqual(signedUp.company);
      expect(session.token).toEqual(expect.any(String));
      expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('accepts the email in any casing', async () => {
      await signUp();

      await app.http
        .post(AUTH_PATHS.signIn)
        .send({ email: 'ADA@NORTHWIND.TEST', password: signUpBody.password })
        .expect(200);
    });

    it('refuses a wrong password and an unknown email identically', async () => {
      await signUp();

      const wrongPassword = await app.http
        .post(AUTH_PATHS.signIn)
        .send({ email: signUpBody.email, password: 'not-the-password' })
        .expect(401);

      const unknownEmail = await app.http
        .post(AUTH_PATHS.signIn)
        .send({ email: 'nobody@northwind.test', password: signUpBody.password })
        .expect(401);

      // Distinguishing them would turn the sign-in form into a way to discover who has an
      // account here.
      expect(wrongPassword.body).toEqual(unknownEmail.body);
      expect(wrongPassword.body.code).toBe(IDENTITY_ERROR_CODES.invalidCredentials);
    });

    it('validates its inputs against the offending fields', async () => {
      const response = await app.http.post(AUTH_PATHS.signIn).send({ email: '' }).expect(422);

      expect(response.body.code).toBe(ERROR_CODES.validationFailed);
      expect(Object.keys(response.body.fields).sort()).toEqual(['email', 'password']);
    });
  });

  describe('using a session', () => {
    it('tells a caller who they are', async () => {
      const session = await signUp();

      const response = await app.http
        .get(AUTH_PATHS.session)
        .set('Authorization', `Bearer ${session.token}`)
        .expect(200);

      expect(response.body.user).toEqual(session.user);
      expect(response.body.company).toEqual(session.company);
      // The token is the credential, not part of the answer to "who am I".
      expect(response.body.token).toBeUndefined();
    });

    it('refuses a request carrying no session at all', async () => {
      const response = await app.http.get(AUTH_PATHS.session).expect(401);

      expect(isApiError(response.body)).toBe(true);
      expect(response.body.code).toBe(ERROR_CODES.unauthenticated);
    });

    it('refuses a token that is not one of ours', async () => {
      const responses = await Promise.all([
        app.http.get(AUTH_PATHS.session).set('Authorization', 'Bearer nonsense').expect(401),
        app.http.get(AUTH_PATHS.session).set('Authorization', 'Basic nonsense').expect(401),
        app.http.get(AUTH_PATHS.session).set('Authorization', 'Bearer').expect(401),
      ]);

      for (const response of responses) {
        expect(response.body.code).toBe(ERROR_CODES.unauthenticated);
      }
    });

    it('refuses a session that has expired, and says that is why', async () => {
      const session = await signUp();
      await factories.expireSessions(session.user.id);

      const response = await app.http
        .get(AUTH_PATHS.session)
        .set('Authorization', `Bearer ${session.token}`)
        .expect(401);

      // Distinct from `unauthenticated` so the frontend can say "your session ended"
      // rather than dropping the user at sign-in with no explanation.
      expect(response.body.code).toBe(ERROR_CODES.sessionExpired);
      expect(response.body.message).toMatch(/expired|sign in/i);
    });

    it('protects endpoints by default rather than one at a time', async () => {
      // Navigation belongs to no module and nobody remembered to guard it. It is guarded.
      const anonymous = await app.http.get(NAVIGATION_PATH).expect(401);
      expect(anonymous.body.code).toBe(ERROR_CODES.unauthenticated);

      const session = await signUp();
      const response = await app.http
        .get(NAVIGATION_PATH)
        .set('Authorization', `Bearer ${session.token}`)
        .expect(200);

      // Assembled from manifests: identity declared this entry, nothing central listed it.
      expect(response.body.entries).toContainEqual(
        expect.objectContaining({ module: 'identity', path: '/' }),
      );
    });

    it('still answers an unknown route with the one error shape', async () => {
      const response = await app.http.get('/api/does-not-exist').expect(404);

      expect(isApiError(response.body)).toBe(true);
      expect(response.body.code).toBe('not_found');
    });
  });

  describe('signing out', () => {
    it('ends the session', async () => {
      const session = await signUp();

      await app.http
        .post(AUTH_PATHS.signOut)
        .set('Authorization', `Bearer ${session.token}`)
        .expect(204);

      const response = await app.http
        .get(AUTH_PATHS.session)
        .set('Authorization', `Bearer ${session.token}`)
        .expect(401);

      expect(response.body.code).toBe(ERROR_CODES.unauthenticated);
    });

    it('ends only the session that signed out', async () => {
      await signUp();
      const first = (
        await app.http
          .post(AUTH_PATHS.signIn)
          .send({ email: signUpBody.email, password: signUpBody.password })
          .expect(200)
      ).body as AuthenticatedSession;
      const second = (
        await app.http
          .post(AUTH_PATHS.signIn)
          .send({ email: signUpBody.email, password: signUpBody.password })
          .expect(200)
      ).body as AuthenticatedSession;

      await app.http
        .post(AUTH_PATHS.signOut)
        .set('Authorization', `Bearer ${first.token}`)
        .expect(204);

      // Signing out of one browser must not sign you out of the other.
      await app.http
        .get(AUTH_PATHS.session)
        .set('Authorization', `Bearer ${second.token}`)
        .expect(200);
    });

    it('cannot be called without a session', async () => {
      await app.http.post(AUTH_PATHS.signOut).expect(401);
    });
  });
});
