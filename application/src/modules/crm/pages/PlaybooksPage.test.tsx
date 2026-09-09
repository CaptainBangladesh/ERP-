import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { PLAYBOOK_PATHS, SCRIPT_PATHS, type ScriptSummary } from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { PlaybooksPage } from './PlaybooksPage';

describe('PlaybooksPage', () => {
  function script(title: string, overrides: Partial<ScriptSummary> = {}): ScriptSummary {
    return {
      id: `id-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title,
      body: 'Hi {{lead.name}}',
      category: 'opener',
      leadStatus: 'new',
      createdByUserId: 'u1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function serveEmpty(): void {
    server.use(
      http.get(SCRIPT_PATHS.scripts, () => HttpResponse.json({ items: [] })),
      http.get(PLAYBOOK_PATHS.playbooks, () => HttpResponse.json({ items: [] })),
    );
  }

  it('refuses access without the authoring permission', async () => {
    signedInWith(['crm:leads:read']);
    renderPage(<PlaybooksPage />, { token: 'a-token', path: '/crm/playbooks' });

    expect(await screen.findByText(/do not have access/i)).toBeInTheDocument();
  });

  it('creates a script from the form', async () => {
    signedInWith('all');
    let sent: Record<string, unknown> | undefined;
    let created = false;

    server.use(
      http.get(SCRIPT_PATHS.scripts, () =>
        HttpResponse.json(created ? { items: [script('Warm opener')] } : { items: [] }),
      ),
      http.get(PLAYBOOK_PATHS.playbooks, () => HttpResponse.json({ items: [] })),
      http.post(SCRIPT_PATHS.scripts, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        created = true;
        return HttpResponse.json(script('Warm opener'), { status: 201 });
      }),
    );

    const { user } = renderPage(<PlaybooksPage />, { token: 'a-token', path: '/crm/playbooks' });

    // The form is a dialog now, not an inline panel — the list is what the section shows first.
    await user.click(await screen.findByRole('button', { name: /new script/i }));

    await user.type(await screen.findByLabelText(/^title$/i), 'Warm opener');
    await user.selectOptions(screen.getByLabelText(/relevant when/i), 'new');
    await user.type(screen.getByLabelText(/script content/i), 'Hi {{lead.name}}');
    await user.click(screen.getByRole('button', { name: /^create script$/i }));

    await waitFor(() =>
      expect(sent).toMatchObject({ title: 'Warm opener', category: 'opener', leadStatus: 'new' }),
    );
    // The new script shows in the list (and again as an option in the step builder's script picker).
    expect((await screen.findAllByText('Warm opener')).length).toBeGreaterThan(0);
  });

  it('builds a playbook with an added step', async () => {
    signedInWith('all');
    let sent: Record<string, unknown> | undefined;
    let created = false;

    server.use(
      http.get(SCRIPT_PATHS.scripts, () => HttpResponse.json({ items: [script('Cold opener')] })),
      http.get(PLAYBOOK_PATHS.playbooks, () =>
        HttpResponse.json(
          created
            ? { items: [{ id: 'p1', name: 'Outreach', description: null, steps: [], createdByUserId: 'u1', createdAt: '', updatedAt: '' }] }
            : { items: [] },
        ),
      ),
      http.post(PLAYBOOK_PATHS.playbooks, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        created = true;
        return HttpResponse.json({ id: 'p1', name: 'Outreach', description: null, steps: [], createdByUserId: 'u1', createdAt: '', updatedAt: '' }, { status: 201 });
      }),
    );

    const { user } = renderPage(<PlaybooksPage />, { token: 'a-token', path: '/crm/playbooks' });

    await user.click(await screen.findByRole('button', { name: /new playbook/i }));

    await user.type(await screen.findByLabelText(/playbook name/i), 'Outreach');
    await user.type(screen.getByLabelText(/rep instruction/i), 'Call and introduce');
    await user.click(screen.getByRole('button', { name: /add step/i }));
    await user.click(screen.getByRole('button', { name: /^create playbook$/i }));

    await waitFor(() => expect((sent?.steps as unknown[]).length).toBe(2));
    expect(sent).toMatchObject({ name: 'Outreach' });
  });
});
