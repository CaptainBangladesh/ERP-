import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { truncateAllTables } from './database';

export interface TestApp {
  /** Drives the real application over HTTP. This is seam 1 — assert here, not below it. */
  http: TestAgent;
  /** For arranging state and asserting on stored data. Never for exercising behaviour. */
  prisma: PrismaService;
  close: () => Promise<void>;
}

/**
 * Boots the real application against the real test database. Nothing is mocked.
 *
 * Ergonomics matter more here than anywhere else in the codebase: forty-plus modules will
 * copy this pattern, and a harness that makes writing a test tedious produces modules that
 * are not tested. A full test should need three lines.
 *
 * Usage:
 *
 *     let app: TestApp;
 *     beforeAll(async () => { app = await createTestApp(); });
 *     afterAll(async () => { await app.close(); });
 *     beforeEach(async () => { await resetDatabase(app); });
 */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app: INestApplication = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);

  return {
    http: supertest(app.getHttpServer()),
    prisma,
    close: async () => {
      await app.close();
    },
  };
}

/**
 * Returns the database to empty between tests.
 *
 * Empty is the correct starting point, not an inconvenience: the running application seeds
 * nothing, so every test begins in the state a real user's first session begins in.
 */
export async function resetDatabase(app: TestApp): Promise<void> {
  await truncateAllTables(app.prisma);
}
