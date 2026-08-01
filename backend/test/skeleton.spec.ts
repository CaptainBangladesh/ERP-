import { SKELETON_PROBES_PATH, SKELETON_PROBE_COUNT_PATH, isApiError } from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';
import { createFactories } from './harness/factories';

/**
 * Seam 1 — the HTTP boundary.
 *
 * This is the worked example every later module copies: boot the real app, drive it over
 * HTTP, assert on what a caller observes. No service is mocked and no internal is reached
 * into.
 */
describe('skeleton probe', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  it('reports zero on an empty database', async () => {
    const response = await app.http.get(SKELETON_PROBE_COUNT_PATH).expect(200);

    expect(response.body).toEqual({ count: 0 });
  });

  it('creates a probe and reflects it in the count', async () => {
    const created = await app.http.post(SKELETON_PROBES_PATH).expect(201);

    expect(created.body).toEqual({
      id: expect.any(String),
      createdAt: expect.any(String),
    });

    const response = await app.http.get(SKELETON_PROBE_COUNT_PATH).expect(200);
    expect(response.body).toEqual({ count: 1 });
  });

  it('counts every probe created', async () => {
    await app.http.post(SKELETON_PROBES_PATH).expect(201);
    await app.http.post(SKELETON_PROBES_PATH).expect(201);
    await app.http.post(SKELETON_PROBES_PATH).expect(201);

    const response = await app.http.get(SKELETON_PROBE_COUNT_PATH).expect(200);
    expect(response.body).toEqual({ count: 3 });
  });

  it('starts each test from an empty database', async () => {
    // Guards the harness itself. If reset ever stops working, the whole suite becomes
    // order-dependent and the failures are baffling — so it is asserted directly.
    const response = await app.http.get(SKELETON_PROBE_COUNT_PATH).expect(200);

    expect(response.body).toEqual({ count: 0 });
  });

  it('arranges state through factories without going via the API', async () => {
    const factories = createFactories(app.prisma);

    await factories.skeletonProbe(5);

    const response = await app.http.get(SKELETON_PROBE_COUNT_PATH).expect(200);
    expect(response.body).toEqual({ count: 5 });
  });

  it('returns the one error shape for an unknown route', async () => {
    const response = await app.http.get('/api/does-not-exist').expect(404);

    expect(isApiError(response.body)).toBe(true);
    expect(response.body.code).toBe('not_found');
    expect(typeof response.body.message).toBe('string');
  });
});
