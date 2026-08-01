/**
 * The authentication seam.
 *
 * The platform guards every endpoint; a module supplies the `SessionAuthority` that says
 * who a caller is. Modules import from here — never the other way round.
 */
export { Public, IS_PUBLIC } from './public.decorator';
export { unauthenticated } from './unauthenticated';
export { SessionAuthority } from './session-authority';
export { SessionGuard } from './session.guard';
export { CurrentSession, SESSION_REQUEST_KEY, type RequestSession } from './session-context';
