import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { AUTH_PATHS, ERROR_CODES, NAVIGATION_PATH } from '@erp/shared';
import { ApplicationModule } from '../src/platform/modules';
import { configureApp } from '../src/app.config';

/**
 * The deletion test, performed rather than asserted about.
 *
 * The spec's rule is that excluding any business module must leave the application building
 * and booting: if deleting inventory breaks the foundation, the foundation depends on
 * inventory. Checking that against the assembler alone would only prove a function returns
 * an empty array. This boots a real Nest application with no modules at all — the extreme
 * case — and drives it over HTTP.
 *
 * It also covers the one behaviour that only exists when identity is absent: with nothing
 * bound to `SessionAuthority`, the guard has no way to tell who anyone is, and refusing is
 * the only safe reading.
 */
describe('an application with no modules', () => {
  let app: INestApplication;
  let http: ReturnType<typeof supertest>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ApplicationModule.from([])],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = supertest(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  it('boots, and still serves the platform', async () => {
    // Getting a considered refusal rather than a connection error is the whole point:
    // the application started.
    const response = await http.get(NAVIGATION_PATH).expect(401);

    expect(response.body.code).toBe(ERROR_CODES.unauthenticated);
  });

  it('has no way to authenticate anyone, so it lets nobody in', async () => {
    const response = await http
      .get(NAVIGATION_PATH)
      .set('Authorization', 'Bearer any-token-at-all')
      .expect(401);

    expect(response.body.code).toBe(ERROR_CODES.unauthenticated);
  });

  it('offers none of the absent module\'s routes', async () => {
    // Identity's endpoints are gone with identity, rather than lingering as broken ones.
    await http.post(AUTH_PATHS.signIn).send({}).expect(404);
  });
});
