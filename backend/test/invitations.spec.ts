import {
  AUTH_PATHS,
  ERROR_CODES,
  IDENTITY_ERROR_CODES,
  IDENTITY_PATHS,
  PARTY_PATHS,
  type ApiError,
  type AuthenticatedSession,
  type InvitationDetails,
  type InvitationListResponse,
  type InvitationResponse,
  type RoleResponse,
  type SignUpRequest,
  type UserListResponse,
} from '@erp/shared';
import { DevMailer } from '../src/platform/mail';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * Invitations, over HTTP, against a real database, with the real (fake) mailer.
 *
 * Nothing here reads a token out of the database directly: every one is recovered the way a
 * real recipient would get it, by reading the email `DevMailer` captured instead of sending
 * anywhere — see `platform/mail`. That is what makes this the same claim a real inbox would
 * let a person verify, not a shortcut past it.
 */
describe('invitations', () => {
  let app: TestApp;
  let mailer: DevMailer;

  const PASSWORD = 'correct-horse-battery';

  type SupertestRequest = ReturnType<TestApp['http']['get']>;

  interface Tenant {
    session: AuthenticatedSession;
    as: (request: SupertestRequest) => SupertestRequest;
  }

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

  async function addRole(owner: Tenant, name: string, permissions: string[]): Promise<RoleResponse> {
    const response = await owner
      .as(app.http.post(IDENTITY_PATHS.roles))
      .send({ name, permissions })
      .expect(201);
    return response.body as RoleResponse;
  }

  async function invite(
    owner: Tenant,
    body: Record<string, unknown>,
  ): Promise<InvitationResponse> {
    const response = await owner
      .as(app.http.post(IDENTITY_PATHS.invitations))
      .send(body)
      .expect(201);
    return response.body as InvitationResponse;
  }

  /** The link `DevMailer` captured for this address, with its token pulled out. */
  function linkSentTo(email: string): string {
    const message = [...mailer.sent].reverse().find((sent) => sent.to === email);
    if (!message) throw new Error(`No mail was sent to ${email}`);

    const match = /token=([^\s&]+)/.exec(message.body);
    if (!match?.[1]) throw new Error(`No token found in the mail sent to ${email}`);
    return match[1];
  }

  describe('inviting a colleague', () => {
    it('sends a link, and it works to sign in once accepted', async () => {
      const owner = await signUp();
      await invite(owner, { email: 'kit@northwind.test' });

      const token = linkSentTo('kit@northwind.test');

      const details = await app.http.get(AUTH_PATHS.invitation(token)).expect(200);
      expect(details.body as InvitationDetails).toEqual({
        companyName: 'Northwind Trading',
        email: 'kit@northwind.test',
      });

      const accepted = await app.http
        .post(AUTH_PATHS.acceptInvitation(token))
        .send({
          companyName: 'Northwind Trading',
          name: 'Kit Moreau',
          password: 'a-second-strong-password',
        })
        .expect(201);

      const session = accepted.body as AuthenticatedSession;
      expect(session.user).toEqual({
        id: expect.any(String),
        name: 'Kit Moreau',
        email: 'kit@northwind.test',
        isOwner: false,
      });
      expect(session.company.id).toBe(owner.session.company.id);

      // The token it just used works as a session — signing in was the point of accepting.
      await app.http
        .get(AUTH_PATHS.session)
        .set('Authorization', `Bearer ${session.token}`)
        .expect(200);
    });

    it('lists the invitation as pending, and no longer once accepted', async () => {
      const owner = await signUp();
      await invite(owner, { email: 'kit@northwind.test' });

      const pending = await owner.as(app.http.get(IDENTITY_PATHS.invitations)).expect(200);
      expect((pending.body as InvitationListResponse).items.map((i) => i.email)).toEqual([
        'kit@northwind.test',
      ]);

      const token = linkSentTo('kit@northwind.test');
      await app.http
        .post(AUTH_PATHS.acceptInvitation(token))
        .send({
          companyName: 'Northwind Trading',
          name: 'Kit Moreau',
          password: 'a-second-strong-password',
        })
        .expect(201);

      const stillPending = await owner.as(app.http.get(IDENTITY_PATHS.invitations)).expect(200);
      expect((stillPending.body as InvitationListResponse).items).toEqual([]);

      const colleagues = await owner.as(app.http.get(IDENTITY_PATHS.users)).expect(200);
      expect((colleagues.body as UserListResponse).items.map((u) => u.email)).toContain(
        'kit@northwind.test',
      );
    });

    it('grants the role it offered the moment it is accepted', async () => {
      const owner = await signUp();
      const role = await addRole(owner, 'Reads parties', ['parties:parties:read']);
      await invite(owner, { email: 'kit@northwind.test', roleId: role.id });

      const token = linkSentTo('kit@northwind.test');
      const accepted = await app.http
        .post(AUTH_PATHS.acceptInvitation(token))
        .send({
          companyName: 'Northwind Trading',
          name: 'Kit Moreau',
          password: 'a-second-strong-password',
        })
        .expect(201);

      const session = accepted.body as AuthenticatedSession;
      expect(session.permissions).toEqual(['parties:parties:read']);

      await app.http
        .get(PARTY_PATHS.parties)
        .set('Authorization', `Bearer ${session.token}`)
        .expect(200);
    });

    it('refuses acceptance if companyName does not exist in the database', async () => {
      const owner = await signUp();
      await invite(owner, { email: 'kit@northwind.test' });
      const token = linkSentTo('kit@northwind.test');

      const response = await app.http
        .post(AUTH_PATHS.acceptInvitation(token))
        .send({
          companyName: 'NonExistent Company LLC',
          name: 'Kit Moreau',
          password: 'a-second-strong-password',
        })
        .expect(400);

      expect((response.body as ApiError).code).toBe(IDENTITY_ERROR_CODES.companyDoesNotExist);
    });

    it('refuses acceptance if companyName does not match the inviting company name', async () => {
      const owner = await signUp();
      // Create a second company
      await signUp({ companyName: 'Other Company Ltd', email: 'owner2@other.test' });
      await invite(owner, { email: 'kit@northwind.test' });
      const token = linkSentTo('kit@northwind.test');

      const response = await app.http
        .post(AUTH_PATHS.acceptInvitation(token))
        .send({
          companyName: 'Other Company Ltd',
          name: 'Kit Moreau',
          password: 'a-second-strong-password',
        })
        .expect(400);

      expect((response.body as ApiError).code).toBe(IDENTITY_ERROR_CODES.companyNameMismatch);
    });

    it('refuses to invite an email that already has an account', async () => {
      const owner = await signUp();

      const response = await owner
        .as(app.http.post(IDENTITY_PATHS.invitations))
        .send({ email: owner.session.user.email })
        .expect(409);

      expect((response.body as ApiError).code).toBe(IDENTITY_ERROR_CODES.emailAlreadyRegistered);
    });

    it('refuses a colleague without identity:users:write from inviting anyone', async () => {
      const owner = await signUp();
      const role = await addRole(owner, 'Reads only', ['identity:users:read']);
      const kit = await addColleagueWithRole(owner, role.id);

      const response = await kit
        .as(app.http.post(IDENTITY_PATHS.invitations))
        .send({ email: 'someone-else@northwind.test' })
        .expect(403);

      expect((response.body as ApiError).code).toBe(ERROR_CODES.forbidden);
    });
  });

  describe('an invitation link that is no longer good', () => {
    it('refuses an unknown token identically for the detail read and for accepting', async () => {
      const bogus = '0b6d2b3e-0000-4000-8000-000000000000';

      const details = await app.http.get(AUTH_PATHS.invitation(bogus)).expect(410);
      expect((details.body as ApiError).code).toBe(IDENTITY_ERROR_CODES.invitationInvalid);

      const accept = await app.http
        .post(AUTH_PATHS.acceptInvitation(bogus))
        .send({
          companyName: 'Northwind Trading',
          name: 'Nobody',
          password: 'a-second-strong-password',
        })
        .expect(410);
      expect((accept.body as ApiError).code).toBe(IDENTITY_ERROR_CODES.invitationInvalid);
    });

    it('refuses a token that has already been used', async () => {
      const owner = await signUp();
      await invite(owner, { email: 'kit@northwind.test' });
      const token = linkSentTo('kit@northwind.test');

      await app.http
        .post(AUTH_PATHS.acceptInvitation(token))
        .send({
          companyName: 'Northwind Trading',
          name: 'Kit Moreau',
          password: 'a-second-strong-password',
        })
        .expect(201);

      const reused = await app.http
        .post(AUTH_PATHS.acceptInvitation(token))
        .send({
          companyName: 'Northwind Trading',
          name: 'Somebody Else',
          password: 'another-strong-password',
        })
        .expect(410);
      expect((reused.body as ApiError).code).toBe(IDENTITY_ERROR_CODES.invitationInvalid);
    });
  });

  /** A colleague signed in already holding the named role — for testing endpoints as them. */
  async function addColleagueWithRole(owner: Tenant, roleId: string): Promise<Tenant> {
    const invited = await invite(owner, { email: 'kit@northwind.test', roleId });
    const token = linkSentTo(invited.email);
    const accepted = await app.http
      .post(AUTH_PATHS.acceptInvitation(token))
      .send({
        companyName: 'Northwind Trading',
        name: 'Kit Moreau',
        password: 'a-second-strong-password',
      })
      .expect(201);
    const session = accepted.body as AuthenticatedSession;
    return { session, as: (request) => request.set('Authorization', `Bearer ${session.token}`) };
  }
});
