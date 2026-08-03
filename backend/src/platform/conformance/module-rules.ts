import type { ModuleManifest } from '../modules';
import { BACKEND_MODULES, SHARED_SOURCE } from './boundaries';
import { moduleOf, occurrences, withoutComments, type SourceFile } from './source';
import type { Violation } from './violation';

/**
 * What every module has to get right, asserted rather than reviewed.
 *
 * The point of a pack rather than a checklist: adding a module means passing this, and the
 * fortieth module gets the same reading the second one did. A convention that is only
 * written down is a convention that holds for as long as whoever wrote it is still reviewing
 * pull requests.
 *
 * Every rule here is a property somebody could plausibly get wrong *and* whose failure is
 * quiet. A hand-rolled `?limit=` compiles and breaks the shared table. A handler that forgets
 * `validated(…)` accepts anything. A module that writes its own company filter works, until
 * the day it forgets one. None of those produces an error at the point of the mistake, which
 * is exactly what earns them a place here rather than a sentence in docs/modules.md.
 */

export interface ModuleConformanceInput {
  readonly manifest: ModuleManifest;
  /** The module's own backend sources, repo-relative. */
  readonly sources: readonly SourceFile[];
  /** The module's wire contract in the shared package, if it has one. */
  readonly contract?: SourceFile;
  /** Models classified in `platform/tenancy/company-owned.ts`. */
  readonly classifiedModels: ReadonlySet<string>;
  /** The grants restricting each model, from the same file. */
  readonly grantsByModel: Readonly<Record<string, readonly string[]>>;
}

export function checkModule(input: ModuleConformanceInput): Violation[] {
  return [
    ...publicSurface(input),
    ...companyScoping(input),
    ...permissionGrants(input),
    ...listShape(input),
    ...errorShape(input),
    ...validatedBodies(input),
  ];
}

/**
 * A module says what it offers, or it offers nothing.
 *
 * The file is the declaration, and an empty one is a real answer — identity and hrm both give
 * it. What matters is that the answer exists somewhere a reader can find, rather than being
 * whatever the first cross-module import happened to reach for.
 */
function publicSurface({ manifest, sources }: ModuleConformanceInput): Violation[] {
  const path = `${BACKEND_MODULES}${manifest.name}/index.ts`;
  if (sources.some((source) => source.path === path)) return [];

  return [
    {
      rule: 'public-surface',
      module: manifest.name,
      path,
      message:
        `Module '${manifest.name}' declares no public surface. Add '${path}' exporting what ` +
        `other modules may use — or 'export {}' with a sentence saying it offers nothing, ` +
        `which is what identity and hrm do. Everything else in the directory is internal, ` +
        `and without this file there is nothing for that to be measured against.`,
    },
  ];
}

/**
 * Company scoping is the platform's, and stays that way.
 *
 * Two things a module could do to take it back, both of which look reasonable in isolation:
 * inject the unscoped client, or write the filter by hand. The first is the more dangerous —
 * `PrismaService` is a working client with every company's rows in it — and the container
 * deliberately offers no token for it, so naming it at all is somebody reaching around the
 * design.
 *
 * A module *may* name `companyId` in a file that suspends scoping, because a module that
 * establishes the tenant necessarily writes one. Identity is the only such file today; the
 * suspension is greppable and costs whoever opens it a written reason, which is the check
 * that actually applies there.
 */
function companyScoping({
  manifest,
  sources,
  classifiedModels,
}: ModuleConformanceInput): Violation[] {
  const violations: Violation[] = [];

  for (const model of manifest.models) {
    if (classifiedModels.has(model)) continue;
    violations.push({
      rule: 'model-classified',
      module: manifest.name,
      path: 'backend/src/platform/tenancy/company-owned.ts',
      message:
        `Module '${manifest.name}' owns model '${model}', which is not classified in ` +
        `company-owned.ts. Say whether its rows belong to a company — and if they do not, ` +
        `say why in a sentence. An unclassified table is the one a query leaks through. ` +
        `See docs/tenancy.md.`,
    });
  }

  for (const source of sources) {
    const text = withoutComments(source.text);

    if (/\bPrismaService\b/.test(text)) {
      violations.push({
        rule: 'unscoped-prisma',
        module: manifest.name,
        path: source.path,
        line: occurrences(source, /\bPrismaService\b/g)[0]?.line,
        message:
          `Module '${manifest.name}' names 'PrismaService', which is the unscoped client — ` +
          `it sees every company's rows. Inject the scoped one with '@InjectPrisma()' and a ` +
          `'ScopedPrisma' type; there is deliberately no container token that would give a ` +
          `module the other.`,
      });
    }

    if (/\bcompanyId\b/.test(text) && !/\bwithoutCompanyScope\b/.test(text)) {
      violations.push({
        rule: 'hand-written-company-filter',
        module: manifest.name,
        path: source.path,
        line: occurrences(source, /\bcompanyId\b/g)[0]?.line,
        message:
          `Module '${manifest.name}' writes 'companyId' itself. Scoping is applied to every ` +
          `query by the platform, so a module that wrote the filter would be a module that ` +
          `could forget it: drop the clause for a read, and use ` +
          `'companyApplied<Prisma.…UncheckedCreateInput>({ … })' for a write, which states ` +
          `that the platform supplies the company without supplying it. The exception is ` +
          `code that suspends scoping in order to establish the tenant, and that is ` +
          `identity's alone. See docs/tenancy.md.`,
      });
    }
  }

  return violations;
}

/**
 * A restricted column names a grant; a module names its permissions. The two are written in
 * different files by different people for different reasons, and nothing but this keeps them
 * in step.
 *
 * Without it, renaming a permission leaves a column restricted by a grant nobody can hold —
 * and the field becomes invisible to everybody, including the people whose job it is to read
 * it. That failure is silent, which is what earns it a rule rather than a convention.
 */
function permissionGrants({ manifest, grantsByModel }: ModuleConformanceInput): Violation[] {
  const declared = new Set(manifest.permissions);
  const violations: Violation[] = [];

  for (const model of manifest.models) {
    for (const grant of grantsByModel[model] ?? []) {
      if (declared.has(grant)) continue;

      violations.push({
        rule: 'grant-declared',
        module: manifest.name,
        path: `${BACKEND_MODULES}${manifest.name}/${manifest.name}.manifest.ts`,
        message:
          `'${model}' is restricted by the grant '${grant}', which module ` +
          `'${manifest.name}' does not declare as a permission. Add it to the manifest, or ` +
          `the column is restricted by something nobody can ever hold and is therefore ` +
          `invisible to everyone.`,
      });
    }
  }

  return violations;
}

/**
 * One list shape, everywhere — ticket 04's first handover to this pack.
 *
 * A module declares a `ListSpec` and calls `listQuery`; the paging, sorting, filtering and
 * searching are the platform's. A module that hand-rolled a `?limit=` would compile, would
 * pass its own tests, and would break the shared table the moment somebody pointed it at the
 * endpoint — the screen and the server would each be doing something coherent and different.
 */
function listShape({ manifest, sources, contract }: ModuleConformanceInput): Violation[] {
  const violations: Violation[] = [];

  for (const source of sources) {
    for (const { line } of occurrences(source, /@Query\(\s*['"]/g)) {
      violations.push({
        rule: 'list-parameters',
        module: manifest.name,
        path: source.path,
        line,
        message:
          `Module '${manifest.name}' reads a named query parameter. List parameters are the ` +
          `platform's convention — 'page', 'pageSize', 'sort', 'search' and 'filter.<field>' ` +
          `— so a handler takes '@Query() query: Record<string, unknown>' whole and hands it ` +
          `to 'listQuery(query, SPEC)'. A controller with an opinion about them is a module ` +
          `inventing its own.`,
      });
    }

    for (const { match, line } of occurrences(source, /\b(skip|take|limit|offset)\s*:/g)) {
      violations.push({
        rule: 'hand-rolled-paging',
        module: manifest.name,
        path: source.path,
        line,
        message:
          `Module '${manifest.name}' writes its own '${match[1]}'. Paging comes from ` +
          `'listQuery(query, SPEC).findMany()', which also applies the ceiling on page size ` +
          `and the identifier tiebreak that stops a row appearing on two pages. See ` +
          `docs/api-conventions.md.`,
      });
    }
  }

  const envelopes = contract ? listTypes(contract) : [];

  for (const { name, definition, line } of envelopes) {
    if (definition.startsWith('ListResponse<')) continue;

    violations.push({
      rule: 'list-envelope',
      module: manifest.name,
      path: contract?.path ?? SHARED_SOURCE,
      line,
      message:
        `'${name}' is not the shared list envelope. Every list endpoint in every module ` +
        `answers 'ListResponse<T>' — items and a page — which is what lets one table ` +
        `component serve forty modules. Declare it as 'ListResponse<${name.replace(
          /ListResponse$/,
          '',
        )}Response>'.`,
    });
  }

  if (envelopes.length > 0 && !sources.some((s) => /\blistQuery\s*\(/.test(withoutComments(s.text)))) {
    violations.push({
      rule: 'list-envelope',
      module: manifest.name,
      path: `${BACKEND_MODULES}${manifest.name}/${manifest.name}.service.ts`,
      message:
        `Module '${manifest.name}' promises a list envelope in its contract but never calls ` +
        `'listQuery'. The envelope is the visible half of the convention; the parameters ` +
        `are the other half, and a list that returns the right shape without accepting the ` +
        `right questions is a list the shared table cannot drive.`,
    });
  }

  return violations;
}

const LIST_TYPE = /export\s+type\s+(\w*ListResponse)\s*=\s*([^;]+);/g;

function listTypes(
  contract: SourceFile,
): Array<{ name: string; definition: string; line: number }> {
  return occurrences(contract, LIST_TYPE).map(({ match, line }) => ({
    name: match[1] ?? '',
    definition: (match[2] ?? '').trim(),
    line,
  }));
}

/**
 * One error shape, and a module never writes a response itself.
 *
 * Nest's own exceptions carry a body of their own shape. Thrown from a module they would
 * reach a client as something with a `statusCode` and a `message` array, beside forty other
 * endpoints answering `{ code, message }` — and a client that branches on `code` would find
 * it missing exactly where a module improvised. `ApiException` names the module's own stable
 * code; `FieldException` carries the fields at fault.
 */
function errorShape({ manifest, sources }: ModuleConformanceInput): Violation[] {
  const violations: Violation[] = [];

  for (const source of sources) {
    for (const { match, line } of occurrences(source, NEST_EXCEPTION)) {
      violations.push({
        rule: 'error-shape',
        module: manifest.name,
        path: source.path,
        line,
        message:
          `Module '${manifest.name}' throws '${match[1]}', which answers with Nest's error ` +
          `body rather than this API's. Throw 'ApiException(CODE, message, status)' with a ` +
          `code from '${manifest.name}''s own contract, or 'FieldException' where the ` +
          `failure belongs to particular inputs. Clients branch on 'code' and never on the ` +
          `message. See docs/api-conventions.md.`,
      });
    }

    for (const { line } of occurrences(source, /@Res\s*\(/g)) {
      violations.push({
        rule: 'error-shape',
        module: manifest.name,
        path: source.path,
        line,
        message:
          `Module '${manifest.name}' takes the response object. A handler returns a value ` +
          `and throws to refuse; writing the response directly bypasses ` +
          `'ApiExceptionFilter', which is the one place every failure is given its shape.`,
      });
    }
  }

  return violations;
}

const NEST_EXCEPTION =
  /\bnew\s+(HttpException|BadRequestException|UnauthorizedException|ForbiddenException|NotFoundException|ConflictException|UnprocessableEntityException|InternalServerErrorException)\b/g;

/**
 * Every handler taking a body declares its validator — ticket 04's second handover.
 *
 * `@Body(validated(Schema))` is per-parameter rather than a global pipe, and the reason is
 * structural: a global pipe has to be told what to validate against by decorating a DTO
 * class, and this codebase has no DTO classes. Request shapes are interfaces in the shared
 * contract, which both workspaces bind to and which do not survive to runtime. So a handler
 * that forgets the pipe gets an unchecked body and no warning — the same bargain '@Public()'
 * strikes, and it wants the same treatment: visible, and checked by something.
 */
function validatedBodies({ manifest, sources }: ModuleConformanceInput): Violation[] {
  const violations: Violation[] = [];

  for (const source of sources) {
    for (const { match, line } of occurrences(source, /@Body\(\s*([^)]*)/g)) {
      if ((match[1] ?? '').trim().startsWith('validated(')) continue;

      violations.push({
        rule: 'body-validated',
        module: manifest.name,
        path: source.path,
        line,
        message:
          `Module '${manifest.name}' takes a request body without a validator. Write ` +
          `'@Body(validated(CreateThingBody)) body: Valid<typeof CreateThingBody>' and ` +
          `declare the schema beside the module's list spec. There is no global pipe to ` +
          `fall back on: the request shapes are interfaces and nothing about them survives ` +
          `to runtime, so an undeclared body is an unchecked one.`,
      });
    }
  }

  return violations;
}

const CONTROLLER_DECORATOR = /^\s*@Controller\(/m;
const HTTP_VERB_DECORATOR = /^\s*@(Get|Post|Put|Patch|Delete)\(/;
const DECORATOR_LINE = /^\s*@/;
const ACCESS_DECORATOR = /^\s*@(Public|RequirePermission|NoPermissionRequired)\(/;

/**
 * Every endpoint checks a permission, one way or another — ticket 07's handover from the
 * placeholder `TenancyGuard` used to carry alone.
 *
 * A handler is guarded by default, the same posture as everything else here: `@Public()` for
 * the handful that need no session at all, `@RequirePermission(...)` for the ordinary case,
 * and `@NoPermissionRequired(...)` for the rare handler that needs a session and nothing more
 * specific — reading your own session, signing out, reading a menu that filters itself. A
 * handler with none of the three is the quietest possible mistake: it works today, for an
 * owner who holds everything, and refuses nothing the day somebody assigns a caller a role
 * that does not include it.
 *
 * This runs over **every** backend source declaring a `@Controller`, not only the ones inside
 * a module and not only the ones named `*.controller.ts`. Two gaps close with that: the
 * platform serves endpoints of its own (navigation, the permission catalogue), and a module
 * handler in a differently-named file would otherwise be unguarded *and* invisible here — the
 * exact combination this rule exists to make impossible.
 *
 * Decorators are grouped by the contiguous run of lines immediately above the method they
 * belong to, because that is what a decorator *is* — not matched by one regex across the whole
 * file, which could not tell one handler's decorators from another's. Every controller in this
 * repository is laid out with one decorator per line directly above its method, which is what
 * makes a line-by-line grouping exact rather than a heuristic.
 */
export function checkPermissionsDeclared(sources: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];

  for (const source of sources) {
    if (!source.path.startsWith('backend/')) continue;

    const text = withoutComments(source.text);
    if (!CONTROLLER_DECORATOR.test(text)) continue;

    const owner = moduleOf(source.path, BACKEND_MODULES);
    const who = owner ? `Module '${owner}'` : `'${source.path}'`;
    const lines = text.split('\n');

    let groupStart: number | undefined;
    let hasHttpVerb = false;
    let hasAccessDecorator = false;

    const flush = (): void => {
      if (hasHttpVerb && !hasAccessDecorator && groupStart !== undefined) {
        violations.push({
          rule: 'permission-declared',
          module: owner,
          path: source.path,
          line: groupStart,
          message:
            `${who} has a handler with none of '@Public()', '@RequirePermission(...)' or ` +
            `'@NoPermissionRequired(...)'. Every endpoint checks a permission one of those ` +
            `three ways; a handler with none of them refuses nothing today and refuses ` +
            `nothing tomorrow, however a caller's role changes.`,
        });
      }
      groupStart = undefined;
      hasHttpVerb = false;
      hasAccessDecorator = false;
    };

    for (const [index, line] of lines.entries()) {
      if (DECORATOR_LINE.test(line)) {
        if (groupStart === undefined) groupStart = index + 1;
        if (HTTP_VERB_DECORATOR.test(line)) hasHttpVerb = true;
        if (ACCESS_DECORATOR.test(line)) hasAccessDecorator = true;
      } else if (line.trim().length > 0) {
        flush();
      }
    }
    flush();
  }

  return violations;
}

/** The sources belonging to one module, from the whole backend tree. */
export function sourcesOf(
  name: string,
  sources: readonly SourceFile[],
): SourceFile[] {
  return sources.filter((source) => moduleOf(source.path, BACKEND_MODULES) === name);
}
