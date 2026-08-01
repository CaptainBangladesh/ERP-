import type { ComponentType } from 'react';

/**
 * What a module declares to the frontend.
 *
 * The mirror of the backend manifest, and deliberately much smaller. Everything that can be
 * decided on the server is decided there — navigation, permissions, tiers — because those
 * are answers a client must not be trusted to compute. What is left is the one thing the
 * server cannot express: which component renders which path.
 */
export interface FrontendModuleManifest {
  /** Matches the backend module name, which is how a navigation entry finds its screens. */
  readonly name: string;
  readonly routes: readonly FrontendRoute[];
}

export interface FrontendRoute {
  /** Exact match, no parameters yet. Ticket 04's list screens introduce the need. */
  readonly path: string;
  readonly component: ComponentType;
  /**
   * Reachable without a session, and rendered without the signed-in chrome. Rare and
   * explicit, exactly as on the backend: sign-in and sign-up are the whole legitimate use,
   * because they are the screens somebody with no session must reach to get one.
   */
  readonly public?: boolean;
}
