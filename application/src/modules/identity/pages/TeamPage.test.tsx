import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  IDENTITY_PATHS,
  type InvitationListResponse,
  type InvitationSummary,
  type RoleListResponse,
  type RoleSummary,
  type UserListResponse,
  type UserSummary,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { TeamPage } from './TeamPage';

/** Inviting colleagues and assigning them roles, from the user's side. */
describe('TeamPage', () => {
  const PAGE_SIZE = 25;

  const clerk: RoleSummary = {
    id: 'role-clerk',
    name: 'Stock clerk',
    permissions: ['products:products:read'],
  };

  function user(name: string, overrides: Partial<UserSummary> = {}): UserSummary {
    return {
      id: `user-${name.toLowerCase().replace(/\s+/g, '-')}`,
      name,
      email: `${name.split(' ')[0]!.toLowerCase()}@northwind.test`,
      isOwner: false,
      roles: [],
      ...overrides,
    };
  }

  function team(
    users: UserSummary[],
    roles: RoleSummary[] = [clerk],
    invitations: InvitationSummary[] = [],
  ): void {
    server.use(
      http.get(IDENTITY_PATHS.users, () =>
        HttpResponse.json({
          items: users,
          page: { number: 1, size: PAGE_SIZE, total: users.length, pages: users.length ? 1 : 0 },
        } satisfies UserListResponse),
      ),
      http.get(IDENTITY_PATHS.roles, () =>
        HttpResponse.json({
          items: roles,
          page: { number: 1, size: 100, total: roles.length, pages: roles.length ? 1 : 0 },
        } satisfies RoleListResponse),
      ),
      http.get(IDENTITY_PATHS.invitations, () =>
        HttpResponse.json({
          items: invitations,
          page: {
            number: 1,
            size: 100,
            total: invitations.length,
            pages: invitations.length ? 1 : 0,
          },
        } satisfies InvitationListResponse),
      ),
    );
  }

  it('shows who is in the company and which roles each of them holds', async () => {
    signedInWith();
    team([
      user('Ada Okafor', { isOwner: true }),
      user('Kit Moreau', { roles: [clerk] }),
    ]);

    renderPage(<TeamPage />, { token: 'a-token', path: '/team' });

    expect(await screen.findByRole('cell', { name: /kit moreau/i })).toBeInTheDocument();
    // Named through the control that removes it rather than by its text: "Stock clerk" also
    // appears as an option in the invite form's role dropdown, and the badge is the one this
    // is about.
    expect(
      screen.getByRole('button', { name: /remove stock clerk from kit moreau/i }),
    ).toBeInTheDocument();
    // The owner's access is derived from having created the company, so there are no roles to
    // show and nothing to take away — saying so is clearer than an empty cell.
    expect(screen.getByText(/owner — full access/i)).toBeInTheDocument();
  });

  it('invites a colleague with a starting role', async () => {
    signedInWith();
    team([user('Ada Okafor', { isOwner: true })]);
    let sent: unknown;
    server.use(
      http.post(IDENTITY_PATHS.invitations, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    const { user: person } = renderPage(<TeamPage />, { token: 'a-token', path: '/team' });

    await person.type(await screen.findByLabelText(/email address/i), 'kit@northwind.test');
    await person.selectOptions(screen.getByLabelText(/starting role/i), clerk.id);
    await person.click(screen.getByRole('button', { name: /send invitation/i }));

    await waitFor(() =>
      expect(sent).toEqual({ email: 'kit@northwind.test', roleId: clerk.id }),
    );
  });

  it('sends no role when none is chosen, rather than an empty one', async () => {
    signedInWith();
    team([user('Ada Okafor', { isOwner: true })]);
    let sent: unknown;
    server.use(
      http.post(IDENTITY_PATHS.invitations, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    const { user: person } = renderPage(<TeamPage />, { token: 'a-token', path: '/team' });

    await person.type(await screen.findByLabelText(/email address/i), 'kit@northwind.test');
    await person.click(screen.getByRole('button', { name: /send invitation/i }));

    await waitFor(() => expect(sent).toEqual({ email: 'kit@northwind.test' }));
  });

  it('lists invitations still waiting to be accepted', async () => {
    signedInWith();
    team(
      [user('Ada Okafor', { isOwner: true })],
      [clerk],
      [
        {
          id: 'invitation-1',
          email: 'kit@northwind.test',
          expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
    );

    renderPage(<TeamPage />, { token: 'a-token', path: '/team' });

    expect(await screen.findByText(/kit@northwind.test — expires/i)).toBeInTheDocument();
  });

  it('assigns a role to somebody who holds none', async () => {
    signedInWith();
    const kit = user('Kit Moreau');
    team([kit]);
    let sent: unknown;
    server.use(
      http.post(IDENTITY_PATHS.userRoles(kit.id), async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ...kit, roles: [clerk] });
      }),
    );

    const { user: person } = renderPage(<TeamPage />, { token: 'a-token', path: '/team' });

    await person.selectOptions(
      await screen.findByLabelText(/assign a role to kit moreau/i),
      clerk.id,
    );

    await waitFor(() => expect(sent).toEqual({ roleId: clerk.id }));
  });

  it('takes a role away again', async () => {
    signedInWith();
    const kit = user('Kit Moreau', { roles: [clerk] });
    team([kit]);
    let removed = false;
    server.use(
      http.delete(IDENTITY_PATHS.userRole(kit.id, clerk.id), () => {
        removed = true;
        return HttpResponse.json({ ...kit, roles: [] });
      }),
    );

    const { user: person } = renderPage(<TeamPage />, { token: 'a-token', path: '/team' });

    await person.click(
      await screen.findByRole('button', { name: /remove stock clerk from kit moreau/i }),
    );

    await waitFor(() => expect(removed).toBe(true));
  });

  it('hides every write control from somebody who may only read the team', async () => {
    signedInWith(['identity:users:read']);
    team([user('Kit Moreau', { roles: [clerk] })]);

    renderPage(<TeamPage />, { token: 'a-token', path: '/team' });
    await screen.findByRole('cell', { name: 'Kit Moreau' });

    expect(screen.queryByRole('button', { name: /send invitation/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/assign a role/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove stock clerk/i })).not.toBeInTheDocument();
  });
});
