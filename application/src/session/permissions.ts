import type { Session } from '@erp/shared';

/**
 * Whether the signed-in caller holds a permission.
 *
 * The server checks again on every request — this exists purely to decide what to render, the
 * same posture navigation already takes: hiding a button is a courtesy to somebody who cannot
 * use it, never the reason they cannot.
 */
export function hasPermission(session: Session | null, permission: string): boolean {
  if (!session) return false;
  return session.permissions === 'all' || session.permissions.includes(permission);
}
