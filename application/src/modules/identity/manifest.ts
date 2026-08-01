import { IDENTITY_MODULE } from '@erp/shared';
import type { FrontendModuleManifest } from '../../app/module-manifest';
import { HomePage } from './pages/HomePage';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';

/**
 * Identity's screens, declared.
 *
 * Found by the registry because this file exists at this path — the frontend's counterpart
 * to the backend's directory scan. No route table anywhere lists these.
 *
 * The two public routes are the whole of what an unauthenticated visitor may reach, and
 * they are the two that must be: without them there would be no way to obtain the session
 * everything else requires.
 */
export const manifest: FrontendModuleManifest = {
  name: IDENTITY_MODULE,
  routes: [
    { path: '/', component: HomePage },
    { path: '/sign-in', component: SignInPage, public: true },
    { path: '/sign-up', component: SignUpPage, public: true },
  ],
};
