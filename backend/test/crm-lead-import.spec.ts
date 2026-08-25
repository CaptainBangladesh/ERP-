import * as XLSX from 'xlsx';
import {
  AUTH_PATHS,
  LEAD_FIELD_PATHS,
  LEAD_IMPORT_ERROR_CODES,
  LEAD_IMPORT_PATHS,
  LEAD_PATHS,
  type AuthenticatedSession,
  type CreateLeadFieldRequest,
  type LeadImportCommitResponse,
  type LeadImportDryRunResponse,
  type LeadImportListResponse,
  type LeadImportSummary,
  type LeadListResponse,
  type SignUpRequest,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

describe('crm lead import', () => {
  let app: TestApp;

  type SupertestRequest = ReturnType<TestApp['http']['get']>;

  interface Tenant {
    session: AuthenticatedSession;
    as: (request: SupertestRequest) => SupertestRequest;
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  async function signUp(overrides: Partial<SignUpRequest> = {}): Promise<Tenant> {
    const response = await app.http
      .post(AUTH_PATHS.signUp)
      .send({
        companyName: 'Northwind Trading',
        name: 'Ada Okafor',
        email: 'ada@northwind.test',
        password: 'correct-horse-battery',
        ...overrides,
      })
      .expect(201);

    const session = response.body as AuthenticatedSession;
    return {
      session,
      as: (req) => req.set('Authorization', `Bearer ${session.token}`),
    };
  }

  it('dry run evaluates CSV rows, writes zero records to database, and reports per-row rejections with line numbers', async () => {
    const tenant = await signUp();

    const csvContent =
      `Name,Email,Organization\n` +
      `Alice Smith,alice@example.com,Acme Corp\n` +
      `Bad Row,invalid-email,Bad Corp\n` +
      `Charlie Brown,charlie@example.com,Peanuts\n`;
    const csvBuffer = Buffer.from(csvContent, 'utf-8');

    const mapping = JSON.stringify({
      Name: 'name',
      Email: 'email',
      Organization: 'organisationName',
    });

    const response = await tenant
      .as(app.http.post(LEAD_IMPORT_PATHS.dryRun))
      .attach('file', csvBuffer, 'leads.csv')
      .field('mapping', mapping)
      .expect(200);

    const result = response.body as LeadImportDryRunResponse;
    expect(result.accepted).toBe(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({
      row: 3,
      field: 'email',
      message: 'Invalid email address format.',
    });

    // Assert zero leads written
    const listRes = await tenant.as(app.http.get(LEAD_PATHS.leads)).expect(200);
    const list = listRes.body as LeadListResponse;
    expect(list.items).toHaveLength(0);
  });

  it('commit writes accepted CSV rows, records LeadImport batch audit record, and isolates rejected rows', async () => {
    const tenant = await signUp();

    const csvContent =
      `Name,Email,Organization\n` +
      `Alice Smith,alice@example.com,Acme Corp\n` +
      `Malformed Row,not-an-email,No Corp\n` +
      `Charlie Brown,charlie@example.com,Peanuts\n`;
    const csvBuffer = Buffer.from(csvContent, 'utf-8');

    const mapping = JSON.stringify({
      Name: 'name',
      Email: 'email',
      Organization: 'organisationName',
    });

    const commitRes = await tenant
      .as(app.http.post(LEAD_IMPORT_PATHS.commit))
      .attach('file', csvBuffer, 'leads.csv')
      .field('mapping', mapping)
      .expect(200);

    const commitResult = commitRes.body as LeadImportCommitResponse;
    expect(commitResult.accepted).toBe(2);
    expect(commitResult.rejected).toHaveLength(1);
    expect(commitResult.importId).toBeDefined();

    // Verify written leads
    const listRes = await tenant.as(app.http.get(LEAD_PATHS.leads)).expect(200);
    const list = listRes.body as LeadListResponse;
    expect(list.items).toHaveLength(2);
    const names = list.items.map((l) => l.name);
    expect(names).toContain('Alice Smith');
    expect(names).toContain('Charlie Brown');

    // Verify LeadImport batch record
    const importRes = await tenant
      .as(app.http.get(LEAD_IMPORT_PATHS.import(commitResult.importId)))
      .expect(200);
    const importRecord = importRes.body as LeadImportSummary;
    expect(importRecord.filename).toBe('leads.csv');
    expect(importRecord.rowCount).toBe(3);
    expect(importRecord.acceptedCount).toBe(2);
    expect(importRecord.importedByUserId).toBe(tenant.session.user.id);
    expect(importRecord.importedByName).toBe(tenant.session.user.name);
  });

  it('parses and imports XLSX spreadsheet fixtures cleanly', async () => {
    const tenant = await signUp();

    const ws = XLSX.utils.aoa_to_sheet([
      ['Full Name', 'Work Email', 'Company Name'],
      ['Diana Prince', 'diana@themyscira.test', 'Amazon Co'],
      ['Bruce Wayne', 'bruce@wayne.test', 'Wayne Enterprises'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const mapping = JSON.stringify({
      'Full Name': 'name',
      'Work Email': 'email',
      'Company Name': 'organisationName',
    });

    const response = await tenant
      .as(app.http.post(LEAD_IMPORT_PATHS.commit))
      .attach('file', xlsxBuffer, 'leads.xlsx')
      .field('mapping', mapping)
      .expect(200);

    const result = response.body as LeadImportCommitResponse;
    expect(result.accepted).toBe(2);
    expect(result.rejected).toHaveLength(0);

    const listRes = await tenant.as(app.http.get(LEAD_PATHS.leads)).expect(200);
    const list = listRes.body as LeadListResponse;
    expect(list.items).toHaveLength(2);
  });

  it('maps custom fields and validates custom field types during import', async () => {
    const tenant = await signUp();

    // Create a custom field (select type)
    await tenant
      .as(app.http.post(LEAD_FIELD_PATHS.leadFields))
      .send({
        label: 'Industry',
        type: 'select',
        options: ['Tech', 'Finance'],
      } satisfies CreateLeadFieldRequest)
      .expect(201);

    const csvContent =
      `Name,Industry\n` +
      `Valid Lead,Tech\n` +
      `Invalid Lead,Healthcare\n`;
    const csvBuffer = Buffer.from(csvContent, 'utf-8');

    const mapping = JSON.stringify({
      Name: 'name',
      Industry: 'industry',
    });

    const response = await tenant
      .as(app.http.post(LEAD_IMPORT_PATHS.dryRun))
      .attach('file', csvBuffer, 'leads.csv')
      .field('mapping', mapping)
      .expect(200);

    const result = response.body as LeadImportDryRunResponse;
    expect(result.accepted).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({
      row: 3,
      field: 'industry',
      message: "Industry: 'Healthcare' is not one of the options.",
    });
  });

  it('refuses non-spreadsheet uploads with clear message before parsing', async () => {
    const tenant = await signUp();

    const txtBuffer = Buffer.from('Just some plain text content', 'utf-8');

    const response = await tenant
      .as(app.http.post(LEAD_IMPORT_PATHS.dryRun))
      .attach('file', txtBuffer, 'document.pdf')
      .field('mapping', '{}')
      .expect(400);

    expect(response.body).toMatchObject({
      code: LEAD_IMPORT_ERROR_CODES.invalidFileType,
      message: 'File must be a CSV or XLSX spreadsheet.',
    });
  });

  it('refuses oversized uploads with clear 413 Payload Too Large message before parsing', async () => {
    const tenant = await signUp();

    // 6MB buffer (> 5MB cap)
    const bigBuffer = Buffer.alloc(6 * 1024 * 1024);

    const response = await tenant
      .as(app.http.post(LEAD_IMPORT_PATHS.dryRun))
      .attach('file', bigBuffer, 'huge.csv')
      .field('mapping', '{}')
      .expect(413);

    expect(response.body).toMatchObject({
      code: LEAD_IMPORT_ERROR_CODES.fileTooLarge,
      message: 'Uploaded file is too large. Maximum allowed size is 5MB.',
    });
  });

  it('enforces tenant isolation for LeadImport records', async () => {
    const companyA = await signUp({ companyName: 'Company A', email: 'userA@test.com' });
    const companyB = await signUp({ companyName: 'Company B', email: 'userB@test.com' });

    const csvContent = `Name\nLead A\n`;
    const csvBuffer = Buffer.from(csvContent, 'utf-8');

    const commitRes = await companyA
      .as(app.http.post(LEAD_IMPORT_PATHS.commit))
      .attach('file', csvBuffer, 'importA.csv')
      .field('mapping', JSON.stringify({ Name: 'name' }))
      .expect(200);

    const importId = (commitRes.body as LeadImportCommitResponse).importId;

    // Company A can read its import
    await companyA
      .as(app.http.get(LEAD_IMPORT_PATHS.import(importId)))
      .expect(200);

    // Company B gets 404
    await companyB
      .as(app.http.get(LEAD_IMPORT_PATHS.import(importId)))
      .expect(404);

    // Company B list does not show Company A's import
    const listResB = await companyB
      .as(app.http.get(LEAD_IMPORT_PATHS.imports))
      .expect(200);
    const listB = listResB.body as LeadImportListResponse;
    expect(listB.items).toHaveLength(0);
  });
});
