/**
 * Starts the built server, from wherever the build actually put it.
 *
 * `nest build` emits to `dist/main.js` under the `tsc` builder and to `dist/src/main.js`
 * under the `swc` one, because SWC mirrors the project root rather than honouring
 * `rootDir`. Switching builders is a one-line change in `nest-cli.json`, and it silently
 * moved the entry point — every deploy afterwards died with `MODULE_NOT_FOUND` and an empty
 * `requireStack`, which names neither the file it wanted nor the reason it was missing. The
 * running server stayed on the last build that worked, so the symptom was not "deploys are
 * failing" but "my changes are not taking effect", which is a much longer thing to notice.
 *
 * So the path is resolved rather than assumed, and a build that produced neither says which
 * paths it looked in.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const candidates = [join(backendRoot, "dist", "main.js"), join(backendRoot, "dist", "src", "main.js")];

const entry = candidates.find((candidate) => existsSync(candidate));

if (!entry) {
  console.error(
    'No built server found. Looked for:\n' +
      candidates.map((candidate) => `  ${candidate}`).join('\n') +
      '\n\nRun `npm run build --workspace backend` first.',
  );
  process.exit(1);
}

await import(pathToFileURL(entry).href);
