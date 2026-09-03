import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  CAPTURE_SOURCE_PATHS,
  LEAD_FIELD_PATHS,
  LEAD_GROUP_PATHS,
  LEAD_SOURCE_PATHS,
  type CaptureSourceSummary,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { CaptureSourcesPage } from './CaptureSourcesPage';

describe('CaptureSourcesPage', () => {
  // The editor offers a capture source its defaults — which group, which source, which
  // fields — so it asks for all three the moment it opens, in every test that opens it.
  // Without a baseline those requests go unhandled: the assertions run against a failed
  // fetch, and the rejection arrives after the test that caused it, where vitest can only
  // count it as an unhandled error and fail the run.
  beforeEach(() => {
    server.use(
      http.get(LEAD_GROUP_PATHS.leadGroups, () => HttpResponse.json({ items: [] })),
      http.get(LEAD_FIELD_PATHS.leadFields, () => HttpResponse.json({ items: [] })),
      http.get(LEAD_SOURCE_PATHS.leadSources, () => HttpResponse.json({ items: [] })),
    );
  });

  function source(overrides: Partial<CaptureSourceSummary> = {}): CaptureSourceSummary {
    return {
      id: 'cs-1',
      type: 'webform',
      kind: 'form',
      name: 'Website Contact Form',
      slug: 'cs-1',
      token: 'cs_1234567890abcdef1234567890abcdef',
      enabled: true,
      config: {
        fields: [{ key: 'name', label: 'Name', required: true, order: 1 }],
        submitBehavior: { kind: 'message', text: 'Thank you!' },
      },
      defaultSourceId: undefined,
      defaultGroupId: undefined,
      defaultAssignedToUserId: null,
      submissionCount: 5,
      lastSubmissionAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function listing(items: CaptureSourceSummary[]): void {
    server.use(http.get(CAPTURE_SOURCE_PATHS.sources, () => HttpResponse.json({ items })));
  }

  it('renders empty state when no capture sources exist', async () => {
    signedInWith();
    listing([]);

    renderPage(<CaptureSourcesPage />, { path: '/crm/capture-sources' });

    await waitFor(() => {
      expect(screen.getByText('No Capture Sources Defined')).toBeInTheDocument();
    });
  });

  it('renders defined capture sources list with metrics and tokens', async () => {
    signedInWith();
    listing([source()]);

    renderPage(<CaptureSourcesPage />, { path: '/crm/capture-sources' });

    await waitFor(() => {
      expect(screen.getByText('Website Contact Form')).toBeInTheDocument();
      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText('cs_1234567890abcdef1234567890abcdef')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });

  /**
   * The URL this page hands out has to be the one the API answers on.
   *
   * It was not: the page wrote `/api/crm/capture/<token>` by hand while the public endpoint has
   * always been `/api/public/capture/<token>`, so every Google Form pointed at the copied URL
   * posted into a 404. Nothing surfaced it — the capture endpoint is fire-and-forget, so the
   * form said "thanks" and no lead was ever created. Asserting against the contract constant is
   * what stops the two drifting apart again.
   */
  it('gives a webhook source the URL the capture endpoint actually answers on', async () => {
    signedInWith();
    listing([source({ kind: 'webhook', name: 'Site Survey Form', config: { fieldMapping: {} } })]);

    const { user } = renderPage(<CaptureSourcesPage />, { path: '/crm/capture-sources' });

    await user.click(await screen.findByRole('button', { name: 'View Webhook URL' }));

    const expected = CAPTURE_SOURCE_PATHS.publicSubmit('cs_1234567890abcdef1234567890abcdef');
    const shown = await screen.findByText((_, element) =>
      element?.tagName === 'CODE' && (element.textContent ?? '').endsWith(expected),
    );
    expect(shown).toBeInTheDocument();

    // And the Apps Script it offers posts to that same URL, keyed by each question's title so the
    // answers read plainly on the Survey tab without a mapping per question.
    const script = screen.getByText((_, element) =>
      element?.tagName === 'PRE' && (element.textContent ?? '').includes('onFormSubmit'),
    );
    expect(script.textContent).toContain(expected);
    expect(script.textContent).toContain('payload[item.getItem().getTitle()] = item.getResponse();');
  });

  it('opens modal to create a new capture source', async () => {
    signedInWith();
    listing([]);

    const { user } = renderPage(<CaptureSourcesPage />, { path: '/crm/capture-sources' });

    await waitFor(() => {
      expect(screen.getByText('No Capture Sources Defined')).toBeInTheDocument();
    });

    const createButton = screen.getByRole('button', { name: 'Create Your First Source' });
    await user.click(createButton);

    await waitFor(() => {
      expect(screen.getByText('New Capture Source')).toBeInTheDocument();
    });
  });
});
