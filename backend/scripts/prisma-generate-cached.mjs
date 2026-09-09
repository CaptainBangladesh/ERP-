import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');

const schemaPath = path.join(backendDir, 'prisma', 'schema.prisma');
if (!fs.existsSync(schemaPath)) {
  console.warn('[prisma-cached] schema.prisma not found, skipping.');
  process.exit(0);
}

const cacheDir = path.join(backendDir, 'node_modules', '.cache');
const hashFilePath = path.join(cacheDir, 'prisma-schema.sha256');

// Check potential client locations (backend/node_modules or monorepo root node_modules)
const clientPaths = [
  path.join(backendDir, 'node_modules', '.prisma', 'client', 'index.js'),
  path.join(backendDir, '..', 'node_modules', '.prisma', 'client', 'index.js'),
];
const clientExists = clientPaths.some((p) => fs.existsSync(p));

const currentSchemaContent = fs.readFileSync(schemaPath);
const currentHash = crypto.createHash('sha256').update(currentSchemaContent).digest('hex');

let cachedHash = null;
if (fs.existsSync(hashFilePath)) {
  try {
    cachedHash = fs.readFileSync(hashFilePath, 'utf8').trim();
  } catch {
    cachedHash = null;
  }
}

if (cachedHash === currentHash && clientExists) {
  console.log('[prisma-cached] Prisma schema unchanged and client exists; skipping generate.');
  process.exit(0);
}

console.log('[prisma-cached] Prisma schema modified or client missing; running prisma generate...');
try {
  execSync('npx prisma generate', {
    cwd: backendDir,
    stdio: 'inherit',
    env: process.env,
  });

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(hashFilePath, currentHash, 'utf8');
} catch (err) {
  if (clientExists) {
    console.warn(
      '[prisma-cached] Warning: prisma generate encountered an issue (possibly Windows DLL file lock), but client is already present. Proceeding with existing client.',
    );
  } else {
    console.error('[prisma-cached] Failed to generate prisma client:', err);
    process.exit(1);
  }
}
