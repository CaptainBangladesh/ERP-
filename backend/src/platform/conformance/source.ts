/**
 * Source, as the rules read it.
 *
 * Every rule in this area is a function over text rather than over a type-checked program,
 * and that is a deliberate trade the same one `scripts/check-tenancy.mjs` already makes.
 * A compiler-backed check would be exact and would need the whole program built before it
 * could say anything; these run on nothing, in a moment, in CI, before the tests — which is
 * where a boundary violation should be caught. The cost is that a sufficiently determined
 * alias defeats them. They are a build refusing the ordinary mistake, not a sandbox.
 *
 * Comments are stripped before anything is matched, and that is not tidiness either: these
 * rules have to be *discussable*. `docs/modules.md` names the imports it forbids, and this
 * file's own prose names the calls it looks for. A rule that fails on the sentence explaining
 * it is a rule people work around by not writing the sentence.
 */

export interface SourceFile {
  /** Repo-relative, forward slashes: `backend/src/modules/hrm/hrm.service.ts`. */
  readonly path: string;
  readonly text: string;
}

/** One module specifier, and where it was written. */
export interface SourceImport {
  readonly specifier: string;
  /** 1-based. */
  readonly line: number;
}

/**
 * Block and line comments blanked out, line numbering intact.
 *
 * Whitespace of the same length replaces each comment rather than nothing at all, so that
 * every offence a rule reports still points at the line it is really on.
 */
export function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

/**
 * Every module specifier a file names — `import`, `export … from`, dynamic `import()` and
 * `require()` alike.
 *
 * All four, because a rule that only understood static imports would be a rule with a
 * documented way around it.
 *
 * The statement forms are anchored to the start of a line and stopped at the first
 * semicolon, and that precision is not fussiness — it is what lets these rules describe
 * themselves. A bare search for `from '…'` matches the sentence *"what they share comes from
 * '@erp/shared/ui'"* inside a violation message, so the check that forbids the import fails
 * on the file that explains it. Same trap as the comment stripping above, one layer in: a
 * rule that cannot be written about gets written about somewhere the rule cannot see.
 */
const IMPORT_FORMS = [
  /^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm,
  /^[ \t]*import\s*['"]([^'"]+)['"]/gm,
  /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function importsIn(source: SourceFile): SourceImport[] {
  const text = withoutComments(source.text);
  const found = new Map<string, SourceImport>();

  for (const form of IMPORT_FORMS) {
    for (const match of text.matchAll(form)) {
      const specifier = match[1];
      if (!specifier) continue;

      // The static and bare forms can both claim one statement in odd layouts. Keyed so the
      // same import is not reported twice with two different reasons.
      const line = lineOf(text, match.index);
      found.set(`${line}:${specifier}`, { specifier, line });
    }
  }

  return [...found.values()].sort((a, b) => a.line - b.line);
}

/** Every match of a pattern, with the line each was found on. */
export function occurrences(
  source: SourceFile,
  pattern: RegExp,
): Array<{ readonly match: RegExpMatchArray; readonly line: number }> {
  const text = withoutComments(source.text);
  return [...text.matchAll(pattern)].map((match) => ({
    match,
    line: lineOf(text, match.index),
  }));
}

export function lineOf(text: string, index: number | undefined): number {
  if (index === undefined) return 1;
  let line = 1;
  for (let at = 0; at < index; at += 1) if (text[at] === '\n') line += 1;
  return line;
}

/**
 * Where a relative specifier lands, as a repo-relative path without its extension.
 *
 * Package specifiers — `@erp/shared`, `@nestjs/common` — are not paths and answer
 * `undefined`; the rules that care about those match on the specifier itself.
 */
export function resolveImport(fromPath: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;

  const segments = fromPath.split('/').slice(0, -1);

  for (const segment of specifier.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }

  return segments.join('/').replace(/\.(ts|tsx|js|jsx)$/, '');
}

/** The module a file belongs to, if it is inside one. */
export function moduleOf(path: string, root: string): string | undefined {
  if (!path.startsWith(root)) return undefined;
  const [name] = path.slice(root.length).split('/');
  return name || undefined;
}
