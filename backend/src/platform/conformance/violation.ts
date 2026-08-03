/**
 * What a module got wrong, said in a way somebody can act on.
 *
 * Every rule in this area answers with these rather than throwing, because the deliverable
 * is the *whole* list. A check that stopped at the first violation would make bringing a
 * module into compliance a sequence of builds, one problem at a time, which is the same
 * mistake the request validator exists not to make.
 */
export interface Violation {
  /** Which rule was broken, kebab-case. Stable, so a test can name one without a message. */
  readonly rule: string;
  /** The module at fault, where the rule belongs to one. */
  readonly module?: string;
  /** Repo-relative, forward slashes. */
  readonly path: string;
  /** 1-based, where the rule found the offence on a particular line. */
  readonly line?: number;
  /**
   * What is wrong and what to do instead — in that order, in prose.
   *
   * A boundary message names *both* modules and the permitted alternative. "Illegal import"
   * tells somebody they are stuck; "parties imports hrm's internals; import from '../hrm',
   * which is its public surface" tells them what to type. At forty modules the difference
   * is most of the value of having the rule at all.
   */
  readonly message: string;
}

export class ConformanceError extends Error {
  constructor(readonly violations: readonly Violation[]) {
    super(`${violations.length} conformance violation(s)`);
    this.name = 'ConformanceError';
  }
}

/** One violation as a line of build output. */
export function describeViolation(violation: Violation): string {
  const where = violation.line ? `${violation.path}:${violation.line}` : violation.path;
  return `${where}  [${violation.rule}]\n    ${violation.message}`;
}
