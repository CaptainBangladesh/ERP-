import {
  AUTH_PATHS,
  IDENTITY_ERROR_CODES,
  type ApiError,
  type AuthenticatedSession,
  type SignUpRequest,
} from '@erp/shared';
import { DevMailer } from '../src/platform/mail';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * Password recovery, over HTTP, against a real database, with the real (fake) mailer.
 *
 * The criteria this file exists to prove: asking for a reset answers identically whether or
 * not the address has an account, the link works exactly once, an expired or reused link is
 * refused, and using it ends every other session the account held.
 */
describe('password reset', () => {
  let app: TestApp;
  let mailer: DevMailer;

  const PASSWORD = 'correct-horse-battery';
  const NEW_PASSWORD = 'a-completely-different-password';

  beforeAll(async () => {
    app = await createTestApp();
    mailer = app.nest.get(DevMailer);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  async function signUp(overrides: Partial<SignUpRequest> = {}): Promise<AuthenticatedSession> {
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
    return response.body as AuthenticatedSession;
  }

  function linkSentTo(email: string): string | undefined {
    const message = [...mailer.sent].reverse().find((sent) => sent.to === email);
    return message ? /token=([^\s&]+)/.exec(message.body)?.[1] : undefined;
  }

  describe('asking for a reset', () => {
    it('answers no content for a known address, and sends a link', async () => {
      await signUp();

      const response = await app.http
        .post(AUTH_PATHS.forgotPassword)
        .send({ email: 'ada@northwind.test' })
        .expect(204);

      expect(response.body).toEqual({});
      expect(linkSentTo('ada@northwind.test')).toEqual(expect.any(String));
    });

    it('answers exactly the same way for an address with no account, and sends nothing', async () => {
      const response = await app.http
        .post(AUTH_PATHS.forgotPassword)
        .send({ email: 'nobody@northwind.test' })
        .expect(204);

      expect(response.body).toEqual({});
      // The form cannot be used to discover who has an account here: the only observable
      // difference would be an email that never arrives, which this asserts directly.
      expect(linkSentTo('nobody@northwind.test')).toBeUndefined();
    });
  });

  describe('using the link', () => {
    it('sets the new password, which then signs in — the old one no longer does', async () => {
      await signUp();
      await app.http.post(AUTH_PATHS.forgotPassword).send({ email: 'ada@northwind.test' }).expect(204);
      const token = linkSentTo('ada@northwind.test')!;

      await app.http
        .post(AUTH_PATHS.resetPassword)
        .send({ token, password: NEW_PASSWORD })
        .expect(204);

      await app.http
        .post(AUTH_PATHS.signIn)
        .send({ email: 'ada@northwind.test', password: PASSWORD })
        .expect(401);

      await app.http
        .post(AUTH_PATHS.signIn)
        .send({ email: 'ada@northwind.test', password: NEW_PASSWORD })
        .expect(200);
    });

    it('ends every session the account held', async () => {
      const first = await signUp();
      const second = (
        await app.http
          .post(AUTH_PATHS.signIn)
          .send({ email: 'ada@northwind.test', password: PASSWORD })
          .expect(200)
      ).body as AuthenticatedSession;

      await app.http.post(AUTH_PATHS.forgotPassword).send({ email: 'ada@northwind.test' }).expect(204);
      const token = linkSentTo('ada@northwind.test')!;
      await app.http.post(AUTH_PATHS.resetPassword).send({ token, password: NEW_PASSWORD }).expect(204);

      await app.http
        .get(AUTH_PATHS.session)
        .set('Authorization', `Bearer ${first.token}`)
        .expect(401);
      await app.http
        .get(AUTH_PATHS.session)
        .set('Authorization', `Bearer ${second.token}`)
        .expect(401);
    });

    it('works once, and refuses being used a second time', async () => {
      await signUp();
      await app.http.post(AUTH_PATHS.forgotPassword).send({ email: 'ada@northwind.test' }).expect(204);
      const token = linkSentTo('ada@northwind.test')!;

      await app.http.post(AUTH_PATHS.resetPassword).send({ token, password: NEW_PASSWORD }).expect(204);

      const reused = await app.http
        .post(AUTH_PATHS.resetPassword)
        .send({ token, password: 'yet-another-password' })
        .expect(410);
      expect((reused.body as ApiError).code).toBe(IDENTITY_ERROR_CODES.resetTokenInvalid);
    });

    it('refuses an expired link', async () => {
      await signUp();
      await app.http.post(AUTH_PATHS.forgotPassword).send({ email: 'ada@northwind.test' }).expect(204);
      const token = linkSentTo('ada@northwind.test')!;

      // There is no endpoint for this and there should not be — the harness back-dates the
      // row directly, the same way `factories.expireSessions` does for a session.
      await app.prisma.passwordReset.updateMany({
        where: { id: token },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const response = await app.http
        .post(AUTH_PATHS.resetPassword)
        .send({ token, password: NEW_PASSWORD })
        .expect(410);
      expect((response.body as ApiError).code).toBe(IDENTITY_ERROR_CODES.resetTokenInvalid);
    });

    it('refuses an unknown token', async () => {
      const response = await app.http
        .post(AUTH_PATHS.resetPassword)
        .send({ token: '0b6d2b3e-0000-4000-8000-000000000000', password: NEW_PASSWORD })
        .expect(410);
      expect((response.body as ApiError).code).toBe(IDENTITY_ERROR_CODES.resetTokenInvalid);
    });
  });
});
