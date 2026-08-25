import { renderPage, signedInWith } from '../../../test/render';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { LEAD_FIELD_PATHS, LEAD_GROUP_PATHS, LEAD_SOURCE_PATHS } from '@erp/shared';
import { server } from '../../../test/server';
import { SpreadsheetImportModal } from './SpreadsheetImportModal';

describe('SpreadsheetImportModal', () => {
  function setupMocks() {
    server.use(
      http.get(LEAD_FIELD_PATHS.leadFields, () => HttpResponse.json({ items: [] })),
      http.get(LEAD_GROUP_PATHS.leadGroups, () => HttpResponse.json({ items: [] })),
      http.get(LEAD_SOURCE_PATHS.leadSources, () => HttpResponse.json({ items: [] })),
    );
  }

  it('renders modal when open', async () => {
    signedInWith(['crm:leads:write', 'crm:lead-fields:write']);
    setupMocks();

    renderPage(
      <SpreadsheetImportModal isOpen={true} onClose={() => {}} onSuccess={() => {}} />,
      { token: 'a-token' },
    );

    expect(await screen.findByText(/Import Leads from Spreadsheet/i)).toBeInTheDocument();
    expect(screen.getByText(/Click to choose file/i)).toBeInTheDocument();
  });
});
