import { AUTH_SCREEN_PATHS, IDENTITY_MODULE, RECOVERY_SCREEN_PATHS } from '@erp/shared';
import type { FrontendModuleManifest } from '../../app/module-manifest';
import { AcceptInvitationPage } from './pages/AcceptInvitationPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { HomePage } from './pages/HomePage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { CompanyMailPage } from './pages/CompanyMailPage';
import { RolesPage } from './pages/RolesPage';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';
import { TeamPage } from './pages/TeamPage';

/**
 * Identity's screens, declared.
 *
 * Found by the registry because this file exists at this path — the frontend's counterpart
 * to the backend's directory scan. No route table anywhere lists these.
 *
 * Sign-in, sign-up, and now account recovery and invitation acceptance are the whole of what
 * an unauthenticated visitor may reach — every one of them a way to obtain the session
 * everything else requires, or to recover one that was lost.
 */
export const manifest: FrontendModuleManifest = {
  name: IDENTITY_MODULE,
  routes: [
    { path: AUTH_SCREEN_PATHS.dashboard, component: HomePage },
    { path: '/team', component: TeamPage },
    { path: '/roles', component: RolesPage },
    { path: '/company-mail', component: CompanyMailPage },
    // From the shared contract for the same reason the recovery paths below are: the
    // backend redirects a browser to these at the end of a Google sign-in.
    { path: AUTH_SCREEN_PATHS.signIn, component: SignInPage, public: true },
    { path: AUTH_SCREEN_PATHS.signUp, component: SignUpPage, public: true },
    // From the shared contract, because the backend writes these paths into the emails it
    // sends: a rename has to break both workspaces rather than one inbox.
    { path: RECOVERY_SCREEN_PATHS.forgotPassword, component: ForgotPasswordPage, public: true },
    { path: RECOVERY_SCREEN_PATHS.resetPassword, component: ResetPasswordPage, public: true },
    {
      path: RECOVERY_SCREEN_PATHS.acceptInvitation,
      component: AcceptInvitationPage,
      public: true,
    },
  ],
};
