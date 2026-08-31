import { config } from 'dotenv';
import { resolve } from 'node:path';

/**
 * Loads the backend's environment before anything else imports it.
 *
 * Resolved relative to this file rather than the process working directory, so the API
 * behaves identically whether it is started from the repo root, from the backend workspace,
 * by the Nest CLI, or by a process manager. Depending on cwd means the app works when you
 * run it one way and fails silently when you run it another.
 *
 * Must be the first import in `main.ts`: PrismaClient reads DATABASE_URL when it is
 * constructed, which happens while Nest is building the module graph.
 */
const backendRoot = resolve(__dirname, '..');

config({ path: resolve(process.cwd(), '.env'), quiet: true });
config({ path: resolve(process.cwd(), 'backend/.env'), quiet: true });
config({ path: resolve(backendRoot, '.env'), quiet: true });
config({ path: resolve(backendRoot, '../.env'), quiet: true });

export const BACKEND_ROOT = backendRoot;
