import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The one hole in tenant scoping, closed by the build.
 *
 * A Prisma client extension rewrites every query that goes through a model delegate, which
 * is how `where: { companyId }` stops being something forty modules have to remember. Raw
 * SQL does not go through a model delegate. `$queryRaw` and its siblings reach the database
 * without the extension seeing them, so a raw query against a company-owned table returns
 * every company's rows and nothing warns anybody.
 *
 * ADR 0003 chose the extension over row-level security on the explicit condition that this
 * hole be a build failure rather than a rule reviewers police. This is that check. It runs
 * in CI beside the module contract check, needs no database, and no application.
 *
 * The test harness is the one exception, and a narrow one: truncating every table between
 * tests is raw SQL across the whole schema with no company to be scoped to, and it never
 * runs against anything but the test database.
 *
 * If you are reading this because it just failed you: the check is also the trigger written
 * into ADR 0003. A legitimate need for raw SQL against a company-owned table is the signal
 * to bring row-level security forward rather than to widen the exception list.
 */
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SEARCHED = ['src', 'test'];

/** Paths under which raw SQL is allowed, relative to the backend workspace. */
const ALLOWED = ['test/harness'];

const RAW = /\$(queryRaw|executeRaw)(Unsafe)?\b/g;

const offences = [];

for (const root of SEARCHED) {
  for (const file of typescriptFilesIn(resolve(backendRoot, root))) {
    const relativePath = relative(backendRoot, file).split(sep).join('/');
    if (ALLOWED.some((allowed) => relativePath.startsWith(`${allowed}/`))) continue;

    withoutComments(readFileSync(file, 'utf8'))
      .split('\n')
      .forEach((line, index) => {
        for (const match of line.matchAll(RAW)) {
          offences.push({ path: relativePath, line: index + 1, call: match[0] });
        }
      });
  }
}

if (offences.length > 0) {
  process.stderr.write('\nTenant scoping violation\n\n');
  for (const offence of offences) {
    process.stderr.write(`  ${offence.path}:${offence.line}  ${offence.call}\n`);
  }
  process.stderr.write(
    `\n  Raw SQL bypasses the tenancy extension entirely, so a query written this way\n` +
      `  returns every company's rows with nothing to warn you. Express it through a model\n` +
      `  delegate instead — the extension scopes those.\n\n` +
      `  If it genuinely cannot be expressed that way, that is the trigger recorded in\n` +
      `  ADR 0003 for bringing Postgres row-level security forward. Reopen the ADR rather\n` +
      `  than adding a path to the exception list in scripts/check-tenancy.mjs.\n\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `Tenant scoping OK — no raw SQL outside ${ALLOWED.map((path) => `'${path}'`).join(', ')}\n`,
);

/**
 * Comments out of the way, line numbering intact.
 *
 * Without this the check fails on the file that explains it — the extension's own doc
 * comment has to be able to name the thing it cannot see. A rule that forbids discussing
 * itself is a rule people work around by not writing the comment.
 */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

function typescriptFilesIn(root) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    const path = resolve(root, entry);
    if (statSync(path).isDirectory()) return typescriptFilesIn(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}
