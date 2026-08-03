import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  IDENTITY_PATHS,
  PERMISSIONS_PATH,
  type RoleListResponse,
  type RoleSummary,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { RolesPage } from './RolesPage';

/**
 * Managing roles from the user's side.
 *
 * The permission checkboxes come from `GET /api/permissions`, which the server assembles from
 * module manifests — so nothing in this file lists what permissions exist, exactly as nothing
 * in the application does. A test that hard-coded them would be asserting the opposite of the
 * claim the endpoint exists to make.
 */
describe('RolesPage', () => {
  const PAGE_SIZE = 25;

  const PERMISSIONS = [
    'parties:parties:read',
    'parties:parties:write',
    'products:products:read',
    'products:products:write',
  ];

  function role(name: string, permissions: string[] = []): RoleSummary {
    return { id: `role-${name.toLowerCase().replace(/\s+/g, '-')}`, name, permissions };
  }

  function listing(roles: RoleSummary[]): void {
    server.use(
      http.get(IDENTITY_PATHS.roles, () =>
        HttpResponse.json({
          items: roles,
          page: { number: 1, size: PAGE_SIZE, total: roles.length, pages: roles.length ? 1 : 0 },
        } satisfies RoleListResponse),
      ),
      // The permission catalogue the checkbox groups are built from — assembled by the server
      // from module manifests, which is why this test never lists permissions of its own.
      http.get(PERMISSIONS_PATH, () => HttpResponse.json({ permissions: PERMISSIONS })),
    );
  }

  it('lists the roles a company has defined', async () => {
    signedInWith();
    listing([role('Stock clerk', ['products:products:read'])]);

    renderPage(<RolesPage />, { token: 'a-token', path: '/roles' });

    expect(await screen.findByRole('cell', { name: 'Stock clerk' })).toBeInTheDocument();
    expect(screen.getByText('1 permission')).toBeInTheDocument();
  });

  it('guides the first role rather than showing an empty box', async () => {
    signedInWith();
    listing([]);

    renderPage(<RolesPage />, { token: 'a-token', path: '/roles' });

    expect(await screen.findByText(/no roles yet/i)).toBeInTheDocument();
  });

  it('offers the permissions the server declared, grouped by the module that owns them', async () => {
    signedInWith();
    listing([]);

    renderPage(<RolesPage />, { token: 'a-token', path: '/roles' });

    // Nothing here names a permission this test invented: every checkbox is one the server's
    // catalogue answered with, grouped by the prefix each module writes for itself.
    for (const permission of PERMISSIONS) {
      expect(await screen.findByLabelText(permission)).toBeInTheDocument();
    }
    expect(screen.getByText('parties')).toBeInTheDocument();
    expect(screen.getByText('products')).toBeInTheDocument();
  });

  it('creates a role with exactly the permissions ticked', async () => {
    signedInWith();
    listing([]);
    let sent: unknown;
    server.use(
      http.post(IDENTITY_PATHS.roles, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(role('Stock clerk', ['products:products:read']), { status: 201 });
      }),
    );

    const { user } = renderPage(<RolesPage />, { token: 'a-token', path: '/roles' });

    await user.type(await screen.findByLabelText(/^name$/i), 'Stock clerk');
    await user.click(screen.getByLabelText('products:products:read'));
    await user.click(screen.getByRole('button', { name: /create role/i }));

    await waitFor(() =>
      expect(sent).toEqual({ name: 'Stock clerk', permissions: ['products:products:read'] }),
    );
  });

  it('denies a whole module in one click, and grants one the same way', async () => {
    signedInWith();
    listing([]);
    let sent: unknown;
    server.use(
      http.post(IDENTITY_PATHS.roles, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(role('Parties only'), { status: 201 });
      }),
    );

    const { user } = renderPage(<RolesPage />, { token: 'a-token', path: '/roles' });
    await screen.findByLabelText('parties:parties:read');

    // Denying a whole module is not a switch of its own — it is holding none of that module's
    // strings. "Select all" on one group and nothing on the other is exactly that state.
    const partiesGroup = screen.getByText('parties').closest('div')!.parentElement!;
    await user.click(within(partiesGroup).getByRole('button', { name: /select all/i }));

    await user.type(screen.getByLabelText(/^name$/i), 'Parties only');
    await user.click(screen.getByRole('button', { name: /create role/i }));

    await waitFor(() =>
      expect(sent).toEqual({
        name: 'Parties only',
        permissions: ['parties:parties:read', 'parties:parties:write'],
      }),
    );
  });

  it('says why a role in use cannot be deleted rather than failing silently', async () => {
    signedInWith();
    const clerk = role('Stock clerk');
    listing([clerk]);
    server.use(
      http.delete(IDENTITY_PATHS.role(clerk.id), () =>
        HttpResponse.json(
          {
            code: 'role_in_use',
            message: 'That role is assigned to somebody and cannot be deleted. Reassign them first.',
          },
          { status: 409 },
        ),
      ),
    );

    const { user } = renderPage(<RolesPage />, { token: 'a-token', path: '/roles' });
    await user.click(await screen.findByRole('button', { name: /delete/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/assigned to somebody/i);
  });

  it('hides every write control from somebody who may only read roles', async () => {
    signedInWith(['identity:roles:read']);
    listing([role('Stock clerk')]);

    renderPage(<RolesPage />, { token: 'a-token', path: '/roles' });
    await screen.findByRole('cell', { name: 'Stock clerk' });

    expect(screen.queryByRole('button', { name: /create role/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
  });
});
