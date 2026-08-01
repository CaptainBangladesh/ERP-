/**
 * Navigation as it crosses the network.
 *
 * Entries are declared by module manifests on the backend and assembled there, not listed
 * on the frontend. Ticket 07 filters them by the caller's permissions and their company's
 * tier, which is why the decision is the server's: a menu the client assembles is a menu
 * the client can be talked into showing.
 */

export const NAVIGATION_PATH = '/api/navigation';

export interface NavigationEntry {
  /** The module that declared it. Lets a screen group entries without a second lookup. */
  module: string;
  label: string;
  /** A frontend route path, matched against the route table the modules declare. */
  path: string;
  /** Ascending. Ties break on label, so the order never depends on discovery order. */
  order: number;
}

export interface NavigationResponse {
  entries: NavigationEntry[];
}
