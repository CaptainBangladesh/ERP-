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

export const RECOVERY_TOKEN_PARAM = 'token';

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
  role: (id: string) => `/${IDENTITY_ROUTE}/roles/${id}`,
} as const;

export interface SignUpRequest {
  companyName: string;
  name: string;
  email: string;
  password: string;
}

export interface SignInRequest {
  email: string;
  password: string;
}

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
  companyDoesNotExist: 'company_does_not_exist',
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
