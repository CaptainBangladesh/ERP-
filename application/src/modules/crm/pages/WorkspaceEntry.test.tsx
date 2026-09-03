import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { LEAD_PATHS, type LeadListResponse, type LeadSummary } from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { WorkspaceEntry } from './WorkspaceEntry';

describe('WorkspaceEntry', () => {
  function lead(name: string): LeadSummary {
    return {
      id: `id-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name,
      organisationName: null,
      email: null,
      phone: null,
      status: 'new',
      source: 'inbound',
      assignedToUserId: null,
      assigneeUserIds: [],
      partyId: null,
      groupId: null,
      sourceId: null,
      customValues: {},
      sourceName: null,
      groupName: null,
    };
  }

  function leads(items: LeadSummary[]): LeadListResponse {
    return { items, page: { number: 1, size: 100, total: items.length, pages: 1 } };
  }

  beforeEach(() => {
    window.localStorage.clear();
    signedInWith('all');
  });

  it('opens the workspace on the first lead', async () => {
    server.use(
      http.get(LEAD_PATHS.leads, () =>
        HttpResponse.json(leads([lead('Priya Kapoor'), lead('Marcus Bell')])),
      ),
    );

    renderPage(<WorkspaceEntry />, { token: 'a-token', path: '/crm/workspace' });

    // It is a doorway: it hands off to the first lead's own route rather than rendering a screen.
    await waitFor(() => expect(window.location.pathname).toBe('/crm/leads/id-priya-kapoor'));
  });

  it('says so and points at the board when there are no leads', async () => {
    server.use(http.get(LEAD_PATHS.leads, () => HttpResponse.json(leads([]))));

    renderPage(<WorkspaceEntry />, { token: 'a-token', path: '/crm/workspace' });

    expect(await screen.findByText('No leads to work yet.')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/crm/workspace');
  });
});
