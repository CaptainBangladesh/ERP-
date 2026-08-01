import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The repo is CommonJS by default, so Node and bundlers treat a bare `.js` file as CJS.
 * This marker tells them the ESM build really is ESM.
 *
 * Without it the frontend's production build fails — and only the production build, because
 * Vite's dev server and Vitest paper over the mismatch with interop. That is the worst kind
 * of failure: invisible until you ship.
 */
const here = dirname(fileURLToPath(import.meta.url));
const esmDir = resolve(here, '../dist/esm');

mkdirSync(esmDir, { recursive: true });
writeFileSync(resolve(esmDir, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
