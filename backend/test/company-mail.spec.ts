import {
  AUTH_PATHS,
  IDENTITY_PATHS,
  ERROR_CODES,
  type AuthenticatedSession,
  type CompanyMailSettingsResponse,
  type SignUpRequest,
} from '@erp/shared';
import { StubMailHostVerifier } from '../src/modules/identity/mail-host-verifier';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * A company's own outgoing mail, configured from inside the application.
 *
 * The setting used to live in the server's environment, which meant the person who knows the
 * mailbox password and the person who can edit a file on the server were rarely the same
 * person — and changing it needed a restart. What these tests hold in place is that it can be
 * set from a screen, that it is proved before it is believed, and that the password is not
 * readable by anyone who did not already know it.
 */
describe('company mail settings', () => {
  let app: TestApp;

  const signUpBody: SignUpRequest = {
    companyName: 'Northwind Trading',
    name: 'Ada Okafor',
    email: 'ada@northwind.test',
    password: 'correct-horse-battery',
  };

  const settings = {
    fromAddress: 'sales@northwind.test',
    fromName: 'Northwind Sales',
    host: 'mail.privateemail.com',
    port: 465,
    secure: true,
    username: 'sales@northwind.test',
    password: 'a-real-mailbox-password',
  };

  async function signUp(): Promise<AuthenticatedSession> {
    const response = await app.http.post(AUTH_PATHS.signUp).send(signUpBody).expect(201);
    return response.body as AuthenticatedSession;
  }

  function as(session: AuthenticatedSession) {
    return {
      get: () =>
        app.http.get(IDENTITY_PATHS.companyMail).set('Authorization', `Bearer ${session.token}`),
      patch: () =>
        app.http.patch(IDENTITY_PATHS.companyMail).set('Authorization', `Bearer ${session.token}`),
      delete: () =>
        app.http.delete(IDENTITY_PATHS.companyMail).set('Authorization', `Bearer ${session.token}`),
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  it('starts unconfigured, and says so rather than pretending', async () => {
    const owner = await signUp();

    const response = await as(owner).get().expect(200);
    const body = response.body as CompanyMailSettingsResponse;

    // The screen branches on this to explain that mail is falling back to the server's own
    // configuration — which is a thing somebody should know before wondering where it went.
    expect(body.configured).toBe(false);
    expect(body.fromAddress).toBe('');
  });

  it('saves settings the mail host accepts', async () => {
    const owner = await signUp();

    const response = await as(owner).patch().send(settings).expect(200);
    const body = response.body as CompanyMailSettingsResponse;

    expect(body.configured).toBe(true);
    expect(body.fromAddress).toBe('sales@northwind.test');
    expect(body.host).toBe('mail.privateemail.com');
  });

  it('never hands the password back, and never stores it as typed', async () => {
    const owner = await signUp();
    await as(owner).patch().send(settings).expect(200);

    const response = await as(owner).get().expect(200);
    expect(JSON.stringify(response.body)).not.toContain(settings.password);

    // Encrypted at rest. A database dump is not a mailbox.
    const company = await app.prisma.company.findFirstOrThrow();
    expect(company.mailSmtpPassword).toBeTruthy();
    expect(company.mailSmtpPassword).not.toContain(settings.password);
  });

  it('refuses settings the host rejects, and stores nothing', async () => {
    const owner = await signUp();

    await as(owner)
      .patch()
      .send({ ...settings, password: StubMailHostVerifier.REJECTED_PASSWORD })
      .expect(400);

    // Proved before stored: the alternative is a screen that says mail is configured and
    // invitations that quietly never arrive.
    const response = await as(owner).get().expect(200);
    expect((response.body as CompanyMailSettingsResponse).configured).toBe(false);
  });

  it('keeps the stored password when a later edit omits it', async () => {
    const owner = await signUp();
    await as(owner).patch().send(settings).expect(200);

    const before = await app.prisma.company.findFirstOrThrow();

    // Changing only the sender name. Requiring the password here is how forms train people
    // to paste secrets they did not need to.
    await as(owner)
      .patch()
      .send({ ...settings, password: undefined, fromName: 'Northwind Team' })
      .expect(200);

    const after = await app.prisma.company.findFirstOrThrow();
    expect(after.mailSmtpPassword).toBe(before.mailSmtpPassword);
    expect(after.mailFromName).toBe('Northwind Team');
  });

  it('validates what it is given', async () => {
    const owner = await signUp();

    const response = await as(owner)
      .patch()
      .send({ ...settings, fromAddress: 'not-an-address', host: '', port: 70000 })
      .expect(422);

    expect(response.body.code).toBe(ERROR_CODES.validationFailed);
    expect(Object.keys(response.body.fields).sort()).toEqual(['fromAddress', 'host', 'port']);
  });

  it('can be turned off again, falling back to the server’s own mail', async () => {
    const owner = await signUp();
    await as(owner).patch().send(settings).expect(200);

    const response = await as(owner).delete().expect(200);
    expect((response.body as CompanyMailSettingsResponse).configured).toBe(false);

    const company = await app.prisma.company.findFirstOrThrow();
    expect(company.mailSmtpPassword).toBeNull();
  });

  it('cannot be read or changed without a session', async () => {
    await signUp();

    await app.http.get(IDENTITY_PATHS.companyMail).expect(401);
    await app.http.patch(IDENTITY_PATHS.companyMail).send(settings).expect(401);
  });

  it('keeps one company’s mail settings out of another’s reach', async () => {
    const owner = await signUp();
    await as(owner).patch().send(settings).expect(200);

    const otherResponse = await app.http
      .post(AUTH_PATHS.signUp)
      .send({
        companyName: 'Southwind Ltd',
        name: 'Bo Ferrer',
        email: 'bo@southwind.test',
        password: 'correct-horse-battery',
      })
      .expect(201);

    const other = await as(otherResponse.body as AuthenticatedSession).get().expect(200);

    // A second company sees its own — unset — settings, never the first company's.
    expect((other.body as CompanyMailSettingsResponse).configured).toBe(false);
    expect((other.body as CompanyMailSettingsResponse).fromAddress).toBe('');
  });
});
