/** The frontend route pattern. Resolved for any concrete `/crm/leads/<id>` by the registry. */
export const CRM_LEAD_WORKSPACE_ROUTE = '/crm/leads/:id';

/** Where the board sends a click on a lead, and what a worklist card links to. */
export function leadWorkspacePath(id: string): string {
  return `/crm/leads/${id}`;
}
