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
        company: { id: expect.any(String), name: 'Northwind Trading', tier: 'core' },
        user: {
          id: expect.any(String),
          name: 'Ada Okafor',
          email: 'ada@northwind.test',
          isOwner: true,
        },
        // The owner's access is derived from having created the company, unconditionally —
        // not from a role, so there is nothing to assign and nothing that could lock them out.
        permissions: 'all',
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
        .send({
          ...signUpBody,
          intent: 'account',
          companyName: 'Northwind Trading',
          email: 'b@northwind.test',
        })
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

  /**
   * The two things "sign up" can mean, and the opposite rules they place on one field.
   *
   * Both require the company's name. Opening one requires the name to be free; joining one
   * requires it to exist. Neither is inferred from the other's failure — asking is what
   * stops somebody who works at Northwind from silently founding a second Northwind.
   */
  describe('the two ways to sign up', () => {
    it('opens a company under a name nobody has taken', async () => {
      const session = await signUp({ intent: 'company' });

      expect(session.company.name).toBe('Northwind Trading');
      expect(session.user.isOwner).toBe(true);
      expect(session.permissions).toBe('all');
    });

    it('refuses to open a second company under a name that exists', async () => {
      await signUp({ intent: 'company' });

      const response = await app.http
        .post(AUTH_PATHS.signUp)
        .send({ ...signUpBody, intent: 'company', email: 'someone.else@northwind.test' })
        .expect(409);

      expect(response.body.code).toBe(IDENTITY_ERROR_CODES.companyAlreadyExists);
      // Beside the input the person can act on, and it names the other option.
      expect(response.body.fields?.companyName).toMatch(/already exists/i);

      expect(await app.prisma.company.count()).toBe(1);
    });

    it('refuses a name that differs only in casing, because that is the same company', async () => {
      await signUp({ intent: 'company' });

      const response = await app.http
        .post(AUTH_PATHS.signUp)
        .send({
          ...signUpBody,
          intent: 'company',
          companyName: 'northwind TRADING',
          email: 'someone.else@northwind.test',
        })
        .expect(409);

      expect(response.body.code).toBe(IDENTITY_ERROR_CODES.companyAlreadyExists);
    });

    it('puts somebody who works for a company inside the one that already exists', async () => {
      const owner = await signUp({ intent: 'company' });

      const joined = await signUp({
        intent: 'account',
        name: 'Bo Ferrer',
        email: 'bo@northwind.test',
      });

      expect(joined.company.id).toBe(owner.company.id);
      // Joining is not owning, and it grants nothing until somebody assigns a role.
      expect(joined.user.isOwner).toBe(false);
      expect(joined.permissions).toEqual([]);
    });

    it('matches the company to join whatever the casing', async () => {
      const owner = await signUp({ intent: 'company' });

      const joined = await signUp({
        intent: 'account',
        companyName: '  northwind trading  ',
        email: 'bo@northwind.test',
      });

      expect(joined.company.id).toBe(owner.company.id);
    });

    it('refuses to join a company that does not exist, rather than inventing it', async () => {
      const response = await app.http
        .post(AUTH_PATHS.signUp)
        .send({ ...signUpBody, intent: 'account', companyName: 'Nowhere Ltd' })
        .expect(400);

      expect(response.body.code).toBe(IDENTITY_ERROR_CODES.companyDoesNotExist);
      expect(response.body.fields?.companyName).toMatch(/no company is registered/i);

      // Nothing was created on the way to refusing — not the company, not the user.
      expect(await app.prisma.company.count()).toBe(0);
      expect(await app.prisma.user.count()).toBe(0);
    });

    it('requires the company name for both options', async () => {
      for (const intent of ['company', 'account']) {
        const response = await app.http
          .post(AUTH_PATHS.signUp)
          .send({ ...signUpBody, intent, companyName: '   ' })
          .expect(422);

        expect(response.body.fields.companyName).toMatch(/company name/i);
      }
    });

    it('reads a request that names no option as opening a company', async () => {
      // The safer of the two to assume: it joins nothing, so a client that has never heard
      // of the choice cannot walk somebody into a company that is not theirs.
      await signUp();

      const response = await app.http
        .post(AUTH_PATHS.signUp)
        .send({ ...signUpBody, email: 'someone.else@northwind.test' })
        .expect(409);

      expect(response.body.code).toBe(IDENTITY_ERROR_CODES.companyAlreadyExists);
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

  /**
   * Signing in with Google, and signing up with it.
   *
   * Google establishes who somebody is. It says nothing about whether they have an account
   * here, and the two screens want opposite things from an address that is new: sign-in
   * refuses it, sign-up exists to create it. Every test below is about that distinction,
   * because getting it wrong in either direction is silent — an account nobody meant to
   * create, or a stranger adopted into somebody else's.
   */
  describe('google authentication', () => {
    it('signs an existing user straight in, on the strength of their address', async () => {
      const initial = await signUp();

      const response = await app.http
        .post(AUTH_PATHS.googleSignIn)
        .send({ email: signUpBody.email, mode: 'signin' })
        .expect(200);

      const session = response.body as AuthenticatedSession;
      expect(session.user.id).toBe(initial.user.id);
      expect(session.company.id).toBe(initial.company.id);
      // A session, which is what lands them on the dashboard rather than back on the form.
      expect(session.token).toEqual(expect.any(String));
    });

    it('signs in whatever the casing Google reports the address in', async () => {
      const initial = await signUp();

      const response = await app.http
        .post(AUTH_PATHS.googleSignIn)
        .send({ email: 'ADA@Northwind.TEST', mode: 'signin' })
        .expect(200);

      expect((response.body as AuthenticatedSession).user.id).toBe(initial.user.id);
    });

    it('refuses to sign in an address that has no account here, and creates nothing', async () => {
      const response = await app.http
        .post(AUTH_PATHS.googleSignIn)
        .send({ email: 'stranger@example.com', name: 'A Stranger', mode: 'signin' })
        .expect(404);

      expect(response.body.code).toBe(IDENTITY_ERROR_CODES.googleAccountNotRegistered);

      // The point of the test: signing in must never be a way to sign up by accident.
      expect(await app.prisma.user.count()).toBe(0);
      expect(await app.prisma.company.count()).toBe(0);
    });

    it('reads a request that names no mode as a sign-in', async () => {
      const response = await app.http
        .post(AUTH_PATHS.googleSignIn)
        .send({ email: 'stranger@example.com' })
        .expect(404);

      expect(response.body.code).toBe(IDENTITY_ERROR_CODES.googleAccountNotRegistered);
      expect(await app.prisma.company.count()).toBe(0);
    });

    it('opens a company for somebody signing up with Google', async () => {
      const response = await app.http
        .post(AUTH_PATHS.googleSignIn)
        .send({
          email: 'gowner@example.com',
          name: 'Google Owner',
          mode: 'signup',
          intent: 'company',
          companyName: 'Acme Google Corp',
        })
        .expect(200);

      const session = response.body as AuthenticatedSession;
      expect(session.company.name).toBe('Acme Google Corp');
      expect(session.user.email).toBe('gowner@example.com');
      expect(session.user.name).toBe('Google Owner');
      expect(session.user.isOwner).toBe(true);
      expect(session.permissions).toBe('all');
    });

    it('puts a Google sign-up who works for a company inside the existing one', async () => {
      const owner = await signUp();

      const response = await app.http
        .post(AUTH_PATHS.googleSignIn)
        .send({
          email: 'colleague@northwind.test',
          name: 'Bo Ferrer',
          mode: 'signup',
          intent: 'account',
          companyName: 'Northwind Trading',
        })
        .expect(200);

      const session = response.body as AuthenticatedSession;
      expect(session.company.id).toBe(owner.company.id);
      expect(session.user.isOwner).toBe(false);
      expect(session.permissions).toEqual([]);
    });

    it('applies the same company rules to a Google sign-up as to a typed one', async () => {
      await signUp();

      const taken = await app.http
        .post(AUTH_PATHS.googleSignIn)
        .send({
          email: 'gowner@example.com',
          mode: 'signup',
          intent: 'company',
          companyName: 'Northwind Trading',
        })
        .expect(409);
      expect(taken.body.code).toBe(IDENTITY_ERROR_CODES.companyAlreadyExists);

      const missing = await app.http
        .post(AUTH_PATHS.googleSignIn)
        .send({
          email: 'gjoiner@example.com',
          mode: 'signup',
          intent: 'account',
          companyName: 'Nowhere Ltd',
        })
        .expect(400);
      expect(missing.body.code).toBe(IDENTITY_ERROR_CODES.companyDoesNotExist);

      expect(await app.prisma.company.count()).toBe(1);
    });

    it('requires a company name to sign up with Google, for either option', async () => {
      for (const intent of ['company', 'account']) {
        const response = await app.http
          .post(AUTH_PATHS.googleSignIn)
          .send({ email: `g-${intent}@example.com`, mode: 'signup', intent })
          .expect(400);

        expect(response.body.code).toBe(IDENTITY_ERROR_CODES.companyNameRequired);
        expect(response.body.fields?.companyName).toMatch(/company name/i);
      }

      expect(await app.prisma.company.count()).toBe(0);
    });

    it('refuses a Google sign-up for an address that already has an account', async () => {
      await signUp();

      const response = await app.http
        .post(AUTH_PATHS.googleSignIn)
        .send({
          email: signUpBody.email,
          mode: 'signup',
          intent: 'company',
          companyName: 'Some Other Company',
        })
        .expect(409);

      // Not a second account and not a silent sign-in either: they are told, and the screen
      // turns it into a link to the form they meant.
      expect(response.body.code).toBe(IDENTITY_ERROR_CODES.emailAlreadyRegistered);
      expect(await app.prisma.company.count()).toBe(1);
    });

    it('never leaves a Google account with a password anybody could guess', async () => {
      await app.http
        .post(AUTH_PATHS.googleSignIn)
        .send({
          email: 'gowner@example.com',
          mode: 'signup',
          intent: 'company',
          companyName: 'Acme Google Corp',
        })
        .expect(200);

      // The column is not nullable, so the row carries a hash of *something*. It has to be
      // of something nobody can reproduce, or a Google account becomes reachable by password.
      const user = await app.prisma.user.findUniqueOrThrow({
        where: { email: 'gowner@example.com' },
      });
      expect(user.passwordHash).toMatch(/^scrypt\$/);
      expect(user.passwordHash).not.toContain('google');
    });

    it('validates the email address it is given', async () => {
      const response = await app.http
        .post(AUTH_PATHS.googleSignIn)
        .send({ email: 'invalid-email' })
        .expect(422);

      expect(response.body.code).toBe(ERROR_CODES.validationFailed);
      expect(response.body.fields.email).toMatch(/valid email/i);
    });

    it('redirects to sign-in with error=module_unavailable when Google auth is not configured on the server', async () => {
      const oldClientId = process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_ID;

      try {
        const response = await app.http
          .get(`${AUTH_PATHS.googleLogin}?mode=signin`)
          .expect(302);

        expect(response.headers.location).toContain('/sign-in');
        expect(response.headers.location).toContain('error=module_unavailable');
      } finally {
        if (oldClientId) process.env.GOOGLE_CLIENT_ID = oldClientId;
      }
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
