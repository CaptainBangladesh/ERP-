import type { ListResponse } from '../../http/list.js';
import type { Session } from '../../session/principal.js';

/**
 * The identity module's wire contract: its paths, its request bodies, its responses, and
 * the codes it refuses with.
 *
 * Wire shapes and the constants both sides must agree on — no rules, no tables, no screens.
 * The behaviour behind these types lives entirely in `backend/src/modules/identity`.
 *
 * What a *signed-in caller* is does not live here: that is `session/principal.ts`, because
 * every module sees a caller and only this one knows how to authenticate.
 */

export const IDENTITY_MODULE = 'identity';

/** No leading slash — Nest composes controller prefixes. */
export const AUTH_ROUTE = 'api/auth';

/**
 * The other half of identity's surface: colleagues, their roles, and role definitions. Kept
 * apart from `AUTH_ROUTE` because everything there is reachable with no session at all (or is
 * establishing one); everything here requires being signed in already.
 */
export const IDENTITY_ROUTE = 'api/identity';

export const AUTH_PATHS = {
  signUp: `/${AUTH_ROUTE}/sign-up`,
  signIn: `/${AUTH_ROUTE}/sign-in`,
  googleSignIn: `/${AUTH_ROUTE}/google`,
  /**
   * Where the browser is *sent* to begin Google sign-in. A full navigation, not a fetch:
   * the server answers with a redirect to accounts.google.com, which is what keeps the
   * client id and the registered redirect URI in one place — the backend's environment —
   * instead of being repeated in a bundle that ships to every visitor.
   */
  googleLogin: `/${AUTH_ROUTE}/google/login`,
  /**
   * Where Google returns the browser to, with the one-time code. Registered in the Google
   * project as an authorised redirect URI — it is an address Google must know, not one the
   * application ever links to.
   */
  googleCallback: `/${AUTH_ROUTE}/google/callback`,
  signOut: `/${AUTH_ROUTE}/sign-out`,
  /** Who the bearer of this token is. The frontend calls it to restore a stored session. */
  session: `/${AUTH_ROUTE}/session`,
  /** Always answers the same way whether or not the address has an account. See below. */
  forgotPassword: `/${AUTH_ROUTE}/forgot-password`,
  resetPassword: `/${AUTH_ROUTE}/reset-password`,
  /** Read before rendering the accept form, so an expired link fails before anyone types. */
  invitation: (token: string) => `/${AUTH_ROUTE}/invitations/${token}`,
  acceptInvitation: (token: string) => `/${AUTH_ROUTE}/invitations/${token}/accept`,
} as const;

/**
 * The screens that are reachable without a session — the ones an email links somebody to, and
 * the two forms that lead to one.
 *
 * Here rather than spelled out in the mail the backend sends *and again* in the frontend's
 * route table, for the same reason every other path in this file is shared: a rename has to be
 * a type error in both workspaces rather than a dead link in somebody's inbox. These are
 * frontend routes, hence the leading slash and no `api/`.
 *
 * `RECOVERY_LINKS` builds the addressed form — the same path with the token the recipient
 * arrived with — so the query parameter's name is written once too.
 */
export const RECOVERY_SCREEN_PATHS = {
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  acceptInvitation: '/accept-invitation',
} as const;

/**
 * The three screens the Google round trip can land somebody on.
 *
 * Shared for the same reason the recovery paths are: the backend builds these URLs. It is the
 * callback from Google that decides whether the browser comes back to the dashboard with a
 * session or to one of the two forms with a message, so a rename has to be a type error in
 * both workspaces rather than a redirect into a 404.
 */
export const AUTH_SCREEN_PATHS = {
  signIn: '/sign-in',
  signUp: '/sign-up',
  /** Where a session lands. The dashboard is simply the application's root screen. */
  dashboard: '/',
} as const;

export const RECOVERY_TOKEN_PARAM = 'token';

/**
 * How a session reaches the browser at the end of the Google round trip.
 *
 * On the URL because there is nowhere else: the tab that started the flow was navigated away
 * to accounts.google.com and back, so nothing in it survived. The application reads this
 * parameter once on load, stores the token, and strips it from the address bar — see
 * `SessionProvider`.
 */
export const SESSION_TOKEN_PARAM = 'session_token';

export const RECOVERY_LINKS = {
  resetPassword: (token: string) =>
    `${RECOVERY_SCREEN_PATHS.resetPassword}?${RECOVERY_TOKEN_PARAM}=${token}`,
  acceptInvitation: (token: string) =>
    `${RECOVERY_SCREEN_PATHS.acceptInvitation}?${RECOVERY_TOKEN_PARAM}=${token}`,
} as const;

export const IDENTITY_PATHS = {
  users: `/${IDENTITY_ROUTE}/users`,
  userRoles: (userId: string) => `/${IDENTITY_ROUTE}/users/${userId}/roles`,
  userRole: (userId: string, roleId: string) =>
    `/${IDENTITY_ROUTE}/users/${userId}/roles/${roleId}`,
  invitations: `/${IDENTITY_ROUTE}/invitations`,
  roles: `/${IDENTITY_ROUTE}/roles`,
  /**
   * The company's own outgoing mail — how invitations and password resets leave.
   *
   * Settings rather than environment variables, so whoever runs the company can fix a wrong
   * password from a screen instead of asking somebody to edit a file on the server and
   * restart it.
   */
  companyMail: `/${IDENTITY_ROUTE}/company/mail`,
  role: (id: string) => `/${IDENTITY_ROUTE}/roles/${id}`,
} as const;

/**
 * Which of the two things somebody is doing on the sign-up screen.
 *
 * `company` opens a new company and makes them its owner; `account` puts them inside a
 * company that already exists. The company's name is required either way, and it is the
 * same field in both cases — what differs is the question asked of it: for `company` the
 * name must be free, and for `account` it must already be taken. One field, two rules, so
 * nobody can create a second "Northwind Trading" by choosing the wrong tab.
 */
export const SIGN_UP_INTENTS = ['company', 'account'] as const;

export type SignUpIntent = (typeof SIGN_UP_INTENTS)[number];

/**
 * Whether a Google request is establishing a session for somebody who already has an
 * account, or creating one.
 *
 * Sent explicitly rather than inferred from whether the email is known, because the two
 * want opposite outcomes for the same input: an unknown address is a failure on sign-in
 * ("you have no account yet") and the whole point on sign-up. A server that guessed would
 * silently create an account for anybody who mistyped which screen they were on.
 */
export const GOOGLE_AUTH_MODES = ['signin', 'signup'] as const;

export type GoogleAuthMode = (typeof GOOGLE_AUTH_MODES)[number];

export interface SignUpRequest {
  companyName: string;
  name: string;
  email: string;
  password: string;
  /** Absent means `company`, which is the safer of the two: it never joins anything. */
  intent?: SignUpIntent;
}

export interface SignInRequest {
  email: string;
  password: string;
}

export interface GoogleSignInRequest {
  email: string;
  name?: string;
  /** Required when `mode` is `signup`, for either intent. Ignored on sign-in. */
  companyName?: string;
  /** Absent means `signin` — the mode that never creates anything. */
  mode?: GoogleAuthMode;
  intent?: SignUpIntent;
}

/**
 * What the browser carries back from the Google round trip, on the query string of whichever
 * screen it lands on.
 *
 * The round trip leaves the application entirely, so nothing survives it but the URL: the
 * refusal that ended it is a `IDENTITY_ERROR_CODES` value under `error`, and `intent` and
 * `companyName` come back so the sign-up form can be repopulated with what the user had
 * chosen and typed before they were sent to Google.
 */
export const GOOGLE_AUTH_RETURN_PARAMS = {
  error: 'error',
  intent: 'intent',
  companyName: 'companyName',
} as const;

/** Sign-up and sign-in hand back the token that authenticates later calls. */
export interface AuthenticatedSession extends Session {
  token: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
}

/** What the accept-invitation screen shows before anybody has typed anything. */
export interface InvitationDetails {
  companyName: string;
  email: string;
}

export interface AcceptInvitationRequest {
  companyName: string;
  name: string;
  password: string;
}

/**
 * A company's outgoing mail settings, as a screen sees them.
 *
 * No password, and there is no route that returns one: it is stored encrypted and can only be
 * replaced, never read back. `configured` is what the screen branches on — whether this
 * company sends its own mail or falls back to the deployment's.
 */
export interface CompanyMailSettingsResponse {
  configured: boolean;
  fromAddress: string;
  fromName: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
}

export interface UpdateCompanyMailSettingsRequest {
  fromAddress: string;
  fromName?: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  /**
   * Omitted means "keep the password already stored", so changing the sender's name does not
   * require typing a password again — a form that demands one for an unrelated edit is a form
   * people end up pasting secrets into.
   */
  password?: string;
}

/**
 * The fields a caller may sort, filter or search the colleague list by.
 */
export const USER_FIELDS = {
  name: 'name',
  email: 'email',
  createdAt: 'createdAt',
} as const;

export interface RoleSummary {
  id: string;
  name: string;
  /** Every permission this role grants, `<module>:<resource>:<action>`. */
  permissions: string[];
}

export type RoleResponse = RoleSummary;

export type RoleListResponse = ListResponse<RoleSummary>;

export const ROLE_FIELDS = {
  name: 'name',
  createdAt: 'createdAt',
} as const;

export interface CreateRoleRequest {
  name: string;
  permissions: string[];
}

/** A change. Every field optional — absent means "do not touch it". */
export interface UpdateRoleRequest {
  name?: string;
  permissions?: string[];
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  /** Derived from having created the company, exactly as on the session. */
  isOwner: boolean;
  /** Every role this person holds. Their permissions are the union of all of them. */
  roles: RoleSummary[];
}

export type UserResponse = UserSummary;

export type UserListResponse = ListResponse<UserSummary>;

export interface AssignRoleRequest {
  roleId: string;
}

export interface InviteColleagueRequest {
  email: string;
  /** Granted the moment the invitation is accepted. Further roles are added afterwards. */
  roleId?: string;
}

export interface InvitationSummary {
  id: string;
  email: string;
  roleId?: string;
  expiresAt: string;
  createdAt: string;
}

export type InvitationResponse = InvitationSummary;

export type InvitationListResponse = ListResponse<InvitationSummary>;

export const INVITATION_FIELDS = {
  email: 'email',
  createdAt: 'createdAt',
} as const;

/**
 * The refusals only this module can produce, so a screen can branch on them without the
 * shared package accumulating one module's vocabulary.
 *
 * The codes every module shares — `unauthenticated`, `session_expired`, `validation_failed`,
 * `forbidden`, `module_unavailable` — are in `http/error.ts`, because the platform raises them
 * on behalf of modules that do not exist yet.
 *
 * `invitationInvalid` and `resetTokenInvalid` each cover an unknown, expired *and* already-used
 * token with one message. Telling them apart would not help anyone: the action is the same in
 * every case — ask whoever invited you for another link, or request a fresh reset — and there
 * is no secret in a token's status the way there is in whether an email address has an account.
 */
export const IDENTITY_ERROR_CODES = {
  invalidCredentials: 'invalid_credentials',
  emailAlreadyRegistered: 'email_already_registered',
  invitationInvalid: 'invitation_invalid',
  companyNameMismatch: 'company_name_mismatch',
  /** Joining a company by a name nothing is registered under. */
  companyDoesNotExist: 'company_does_not_exist',
  /** Opening a company under a name somebody already registered. */
  companyAlreadyExists: 'company_already_exists',
  /** Signing up — either intent — without saying which company. */
  companyNameRequired: 'company_name_required',
  /**
   * Google said who they are and this system has never seen them. Only sign-in raises it:
   * it is the answer to "continue with Google" from somebody who has not signed up yet,
   * and the screen turns it into a link to the sign-up form rather than an error to fix.
   */
  googleAccountNotRegistered: 'google_account_not_registered',
  /**
   * The Google round trip itself did not complete — the code would not exchange, or Google
   * would not say who the user is. Distinct from every refusal above, which are decisions
   * this system made about somebody it had successfully identified.
   */
  googleAuthFailed: 'google_auth_failed',
  /** The mail host refused the company's outgoing-mail settings, so they were not saved. */
  companyMailRejected: 'company_mail_rejected',
  companyMailPasswordRequired: 'company_mail_password_required',
  /** The company's own mail account refused a message. Nothing was sent. */
  companyMailSendFailed: 'company_mail_send_failed',
  resetTokenInvalid: 'reset_token_invalid',
  roleNotFound: 'role_not_found',
  /** A role still assigned to somebody cannot be deleted — reassign them first. */
  roleInUse: 'role_in_use',
  userNotFound: 'user_not_found',
} as const;

/**
 * Shared because the form's hint and the server's rule must be the same number. The rule
 * itself is enforced only on the server.
 */
export const PASSWORD_MIN_LENGTH = 12;
