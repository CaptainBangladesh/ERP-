import { checkConformance } from './pack';
import { conformanceInput } from './read';
import { describeViolation, ConformanceError } from './violation';

/**
 * The build's opinion of the module boundaries.
 *
 * Runs in CI beside `check:modules` and `check:tenancy`, and for the same reason all three
 * are static: a cross-module import, a query against somebody else's table, an undeclared
 * dependency and a hand-rolled list parameter are facts about source text. None of them
 * should need a database, a running application, or a deployment to discover — and none of
 * them should depend on a reviewer having read the same convention for the fortieth time.
 *
 * Editors matter too, and are not enough. A rule that only a language server enforces is a
 * rule that holds for whoever has the right extension installed, which is not a property of
 * the codebase.
 */
export function checkModuleConformance(): void {
  const input = conformanceInput();
  const violations = checkConformance(input);

  if (violations.length > 0) throw new ConformanceError(violations);

  process.stdout.write(
    `Module conformance OK — ${input.modules.length} module(s) and ` +
      `${input.sources.length} source file(s) checked\n`,
  );
}

if (require.main === module) {
  try {
    checkModuleConformance();
  } catch (error) {
    if (error instanceof ConformanceError) {
      process.stderr.write(
        `\nModule conformance violation${error.violations.length === 1 ? '' : 's'}\n\n`,
      );
      for (const violation of error.violations) {
        process.stderr.write(`  ${describeViolation(violation)}\n\n`);
      }
      process.stderr.write(
        `  ${error.violations.length} in total. See docs/modules.md — every rule here is ` +
          `one a module can break silently.\n\n`,
      );
      process.exit(1);
    }
    throw error;
  }
}
