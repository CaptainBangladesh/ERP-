import { MARKETING_MODULE } from '@erp/shared';
import type { FrontendModuleManifest } from '../../app/module-manifest';
import { MarketingPage } from './pages/MarketingPage';

/**
 * Which component renders which path — the one thing the server cannot decide.
 *
 * Found by the registry because this file exists at this path; no route table anywhere lists
 * it. The path matches the navigation entry the backend manifest declares, which is how a
 * menu entry finds a screen.
 */
export const manifest: FrontendModuleManifest = {
  name: MARKETING_MODULE,
  routes: [
    /**
     * One entry per destination, because a tab is now a real address.
     *
     * `routeFor` matches exact paths, so every id in `MarketingPage`'s `TABS` needs a line here
     * or a linked tab is a 404 on a cold load. `records` is listed although its tab is deleted:
     * 13.2e removes the destination from the strip, not the URL.
     */
    { path: '/marketing', component: MarketingPage },
    { path: '/marketing/calendar', component: MarketingPage },
    { path: '/marketing/publishing', component: MarketingPage },
    { path: '/marketing/inbox', component: MarketingPage },
    { path: '/marketing/campaigns', component: MarketingPage },
    { path: '/marketing/leadgen', component: MarketingPage },
    { path: '/marketing/analytics', component: MarketingPage },
    { path: '/marketing/vault', component: MarketingPage },
    { path: '/marketing/queue', component: MarketingPage },
    { path: '/marketing/records', component: MarketingPage },
  ],
};
