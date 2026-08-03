import { Module } from '@nestjs/common';
import {
  assembleModules,
  discoverManifests,
  type ModuleManifest,
} from '../src/platform/modules';
import {
  checkConformance,
  checkModuleConformance,
  conformanceInput,
  ConformanceError,
  describeViolation,
  type ConformanceInput,
  type SourceFile,
  type Violation,
} from '../src/platform/conformance';

/**
 * The conformance pack, exercised the only way a build check can honestly be exercised: by
 * being given something that breaks each rule and asked whether it says so.
 *
 * The ticket's criterion is that "a deliberately violating change is proven to fail CI". A
 * test that only asserted the real repository passes would prove the opposite of what it
 * looks like it proves — a check that returned an empty list unconditionally would pass it.
 * So every rule below is asserted twice: once against a module that breaks it, and once, in
 * the last block, against the modules that actually exist.
 *
 * Like `module-contract.spec.ts` this tests something other than the HTTP boundary, and for
 * the same reason: the deliverable *is* the refusal, and a refusal that stops a build is not
 * observable over HTTP because the application never starts.
 */

@Module({})
class StubNestModule {}

function manifest(name: string, overrides: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    name,
    tier: 'core',
    dependsOn: [],
    nestModule: StubNestModule,
    routes: [`api/${name}`],
    migrations: [],
    models: [],
    permissions: [],
    navigation: [],
    events: { emits: [], consumes: [] },
    ...overrides,
  };
}

/**
 * A repository, as small as the rule under test allows.
 *
 * Every module gets a public surface unless the test says otherwise, so that the one rule
 * being exercised is the one that fires. A fixture that tripped four rules at once would
 * make each assertion a statement about the fixture rather than about the rule.
 */
function repository(
  modules: readonly ModuleManifest[],
  sources: readonly SourceFile[],
  overrides: Partial<ConformanceInput> = {},
): ConformanceInput {
  const surfaces = modules
    .filter(
      (module) =>
        !sources.some((s) => s.path === `backend/src/modules/${module.name}/index.ts`),
    )
    .map((module) => ({
      path: `backend/src/modules/${module.name}/index.ts`,
      text: 'export {};',
    }));

  return {
    modules,
    sources: [...surfaces, ...sources],
    modelOwners: Object.fromEntries(
      modules.flatMap((module) => module.models.map((model) => [model, module.name])),
    ),
    classifiedModels: modules.flatMap((module) => [...module.models]),
    grantsByModel: {},
    ...overrides,
  };
}

function rules(violations: readonly Violation[]): string[] {
  return violations.map((violation) => violation.rule);
}

/** Everything said about one rule, as one string. A rule may have more than one thing to say. */
function message(violations: readonly Violation[], rule: string): string {
  return violations
    .filter((violation) => violation.rule === rule)
    .map((violation) => violation.message)
    .join('\n');
}

describe('the wall between modules', () => {
  const parties = manifest('parties');
  const hrm = manifest('hrm', { tier: 'enterprise' });

  it('refuses an import that reaches past another module’s public surface', () => {
    const violations = checkConformance(
      repository([parties, hrm], [
        {
          path: 'backend/src/modules/hrm/hrm.service.ts',
          text: `import { PartiesService } from '../parties/parties.service';`,
        },
      ]),
    );

    expect(rules(violations)).toEqual(['cross-module-internals']);

    // Both modules named, and the permitted alternative stated — which is most of the value
    // of the rule. "Illegal import" tells somebody they are stuck.
    const said = message(violations, 'cross-module-internals');
    expect(said).toContain("'hrm'");
    expect(said).toContain("'parties'");
    expect(said).toContain('../parties');
  });

  it('allows the public surface itself, once the dependency is declared', () => {
    const importsIt: SourceFile = {
      path: 'backend/src/modules/hrm/hrm.service.ts',
      text: `import { PartyDirectory } from '../parties';`,
    };

    // Undeclared, the import is a lie the module graph would go on telling.
    const undeclared = checkConformance(repository([parties, hrm], [importsIt]));
    expect(rules(undeclared)).toEqual(['undeclared-dependency']);
    expect(message(undeclared, 'undeclared-dependency')).toContain('dependsOn');

    const declared = manifest('hrm', { tier: 'enterprise', dependsOn: ['parties'] });
    expect(checkConformance(repository([parties, declared], [importsIt]))).toEqual([]);
  });

  it('refuses a module querying another module’s tables', () => {
    const owner = manifest('parties', { models: ['Party'] });

    const violations = checkConformance(
      repository([owner, hrm], [
        {
          path: 'backend/src/modules/hrm/hrm.service.ts',
          text: `const rows = await this.prisma.party.findMany();`,
        },
      ]),
    );

    expect(rules(violations)).toEqual(['cross-module-tables']);

    // Naming the alternative matters more here than anywhere: the reason somebody reads a
    // table directly is that they could not see what else to do.
    const said = message(violations, 'cross-module-tables');
    expect(said).toContain("'Party'");
    expect(said).toContain('public surface');
    expect(said).toContain('events');
  });

  it('lets a module query its own tables, whatever they are called', () => {
    const owner = manifest('parties', { models: ['Party', 'PartyRole'] });

    expect(
      checkConformance(
        repository([owner], [
          {
            path: 'backend/src/modules/parties/parties.service.ts',
            text:
              `await this.prisma.party.findMany();\n` +
              `await this.prisma.partyRole.createMany({ data: [] });`,
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('refuses a module reaching inside a platform area, and allows its entry point', () => {
    const reaching = checkConformance(
      repository([parties], [
        {
          path: 'backend/src/modules/parties/parties.service.ts',
          text: `import { createScopedPrisma } from '../../platform/tenancy/tenant-scope';`,
        },
      ]),
    );

    expect(rules(reaching)).toEqual(['platform-internals']);
    expect(message(reaching, 'platform-internals')).toContain('../../platform/tenancy');

    expect(
      checkConformance(
        repository([parties], [
          {
            path: 'backend/src/modules/parties/parties.service.ts',
            text: `import { InjectPrisma } from '../../platform/tenancy';`,
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('refuses the platform importing a module, which is the dependency backwards', () => {
    const violations = checkConformance(
      repository([parties], [
        {
          path: 'backend/src/platform/auth/session.guard.ts',
          text: `import { PartyDirectory } from '../../modules/parties';`,
        },
      ]),
    );

    expect(rules(violations)).toEqual(['platform-imports-module']);
    expect(message(violations, 'platform-imports-module')).toContain('seam');
  });

  it('refuses the backend importing the shared package’s components', () => {
    const violations = checkConformance(
      repository([parties], [
        {
          path: 'backend/src/modules/parties/parties.service.ts',
          text: `import { DataTable } from '@erp/shared/ui';`,
        },
      ]),
    );

    // The two entry points exist so Nest never acquires React. Nothing else enforces it.
    expect(rules(violations)).toEqual(['backend-imports-ui']);
  });

  it('refuses one module’s screens importing another’s', () => {
    const violations = checkConformance(
      repository([parties, hrm], [
        {
          path: 'application/src/modules/hrm/pages/EmployeesPage.tsx',
          text: `import { PartyDetail } from '../../parties/components/PartyDetail';`,
        },
      ]),
    );

    expect(rules(violations)).toEqual(['frontend-cross-module']);
  });
});

describe('the shared package holds primitives', () => {
  const parties = manifest('parties');

  it('refuses a domain concept given an area of its own', () => {
    const violations = checkConformance(
      repository([parties], [{ path: 'packages/src/parties/party.ts', text: '' }]),
    );

    expect(rules(violations)).toEqual(['shared-package-area']);
    expect(message(violations, 'shared-package-area')).toContain('module');
  });

  it('refuses anything under a module’s contract directory that is not the contract', () => {
    const violations = checkConformance(
      repository([parties], [
        { path: 'packages/src/modules/parties/merge-rules.ts', text: '' },
      ]),
    );

    expect(rules(violations)).toEqual(['shared-package-contract']);
    expect(message(violations, 'shared-package-contract')).toContain('Behaviour belongs');
  });

  it('tolerates a contract whose module has been deleted, because deletion must build', () => {
    // The subset rule reaching into this check. `check:conformance` runs ahead of the build
    // in CI, so refusing an orphaned contract would make `rm -r src/modules/parties` a failed
    // build for a reason that has nothing to do with parties.
    expect(
      checkConformance(
        repository([parties], [{ path: 'packages/src/modules/sales/contract.ts', text: '' }]),
      ),
    ).toEqual([]);
  });

  it('refuses a primitive that learns what a module’s vocabulary is', () => {
    const violations = checkConformance(
      repository([parties], [
        {
          path: 'packages/src/http/list.ts',
          text: `import type { PartySummary } from '../modules/parties/contract.js';`,
        },
      ]),
    );

    expect(rules(violations)).toEqual(['shared-primitive-imports-contract']);
    expect(message(violations, 'shared-primitive-imports-contract')).toContain(
      'stopped being a primitive',
    );
  });

  it('allows the package barrel to name every contract, because that is its job', () => {
    expect(
      checkConformance(
        repository([parties], [
          {
            path: 'packages/src/index.ts',
            text: `export * from './modules/parties/contract.js';`,
          },
          { path: 'packages/src/modules/parties/contract.ts', text: '' },
        ]),
      ),
    ).toEqual([]);
  });
});

describe('what every module has to get right', () => {
  const parties = manifest('parties');

  it('refuses a module with no declared public surface', () => {
    const violations = checkConformance({
      ...repository([parties], []),
      sources: [],
    });

    expect(rules(violations)).toEqual(['public-surface']);
    expect(message(violations, 'public-surface')).toContain('export {}');
  });

  it('refuses a module that writes its own company filter', () => {
    const violations = checkConformance(
      repository([parties], [
        {
          path: 'backend/src/modules/parties/parties.service.ts',
          text: `this.prisma.party.findMany({ where: { companyId: this.companyId } });`,
        },
      ]),
    );

    expect(rules(violations)).toEqual(['hand-written-company-filter']);
    expect(message(violations, 'hand-written-company-filter')).toContain('companyApplied');
  });

  it('allows a company named by code that suspends scoping, which is how a tenant begins', () => {
    // Identity's sign-up is the one legitimate case, and it is legitimate precisely because
    // it says so: the suspension is greppable and costs whoever opens it a written reason.
    expect(
      checkConformance(
        repository([manifest('identity')], [
          {
            path: 'backend/src/modules/identity/identity.service.ts',
            text:
              `return this.tenancy.withoutCompanyScope('Sign-up creates the company.', () =>\n` +
              `  tx.user.create({ data: { companyId: created.id } }));`,
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('refuses a module reaching for the unscoped client', () => {
    const violations = checkConformance(
      repository([parties], [
        {
          path: 'backend/src/modules/parties/parties.service.ts',
          text: `constructor(private readonly prisma: PrismaService) {}`,
        },
      ]),
    );

    expect(rules(violations)).toEqual(['unscoped-prisma']);
    expect(message(violations, 'unscoped-prisma')).toContain('@InjectPrisma');
  });

  it('refuses a table nobody classified for tenancy', () => {
    const violations = checkConformance(
      repository([manifest('parties', { models: ['Party'] })], [], { classifiedModels: [] }),
    );

    expect(rules(violations)).toEqual(['model-classified']);
  });

  it('refuses a column restricted by a grant its own module never declares', () => {
    const violations = checkConformance(
      repository([manifest('hrm', { models: ['Employee'] })], [], {
        grantsByModel: { Employee: ['hrm:pay:read'] },
      }),
    );

    expect(rules(violations)).toEqual(['grant-declared']);

    expect(
      checkConformance(
        repository([manifest('hrm', { models: ['Employee'], permissions: ['hrm:pay:read'] })], [], {
          grantsByModel: { Employee: ['hrm:pay:read'] },
        }),
      ),
    ).toEqual([]);
  });

  it('refuses a handler that reads list parameters itself', () => {
    const violations = checkConformance(
      repository([parties], [
        {
          path: 'backend/src/modules/parties/parties.controller.ts',
          text: `async list(@Query('limit') limit: string) {}`,
        },
      ]),
    );

    // Two rules, and both are right: it named a parameter, and the parameter it named is a
    // page size the platform already has a ceiling on.
    expect(rules(violations).sort()).toEqual(['hand-rolled-paging', 'list-parameters']);
  });

  it('refuses a list type that is not the shared envelope', () => {
    const violations = checkConformance(
      repository([parties], [
        {
          path: 'packages/src/modules/parties/contract.ts',
          text: `export type PartyListResponse = { parties: PartySummary[]; total: number };`,
        },
      ]),
    );

    expect(rules(violations)).toContain('list-envelope');
    expect(message(violations, 'list-envelope')).toContain('ListResponse<');
  });

  it('refuses a module that promises a list envelope and never asks the platform for one', () => {
    const violations = checkConformance(
      repository([parties], [
        {
          path: 'packages/src/modules/parties/contract.ts',
          text: `export type PartyListResponse = ListResponse<PartySummary>;`,
        },
        {
          path: 'backend/src/modules/parties/parties.service.ts',
          text: `async listParties() { return { items: [], page: {} }; }`,
        },
      ]),
    );

    expect(rules(violations)).toEqual(['list-envelope']);
  });

  it('refuses a module throwing an error of a shape nothing else in the API returns', () => {
    const violations = checkConformance(
      repository([parties], [
        {
          path: 'backend/src/modules/parties/parties.service.ts',
          text: `throw new NotFoundException('That party does not exist.');`,
        },
      ]),
    );

    expect(rules(violations)).toEqual(['error-shape']);
    expect(message(violations, 'error-shape')).toContain('ApiException');
  });

  it('refuses a handler taking a body with nothing checking it', () => {
    const violations = checkConformance(
      repository([parties], [
        {
          path: 'backend/src/modules/parties/parties.controller.ts',
          text: `async add(@Body() body: CreatePartyRequest) {}`,
        },
      ]),
    );

    expect(rules(violations)).toEqual(['body-validated']);
    expect(message(violations, 'body-validated')).toContain('validated(');

    expect(
      checkConformance(
        repository([parties], [
          {
            path: 'backend/src/modules/parties/parties.controller.ts',
            text: `async add(@Body(validated(CreatePartyBody)) body: Valid<typeof CreatePartyBody>) {}`,
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('refuses a handler with no permission check at all', () => {
    const violations = checkConformance(
      repository([parties], [
        {
          path: 'backend/src/modules/parties/parties.controller.ts',
          text:
            `@Controller('api/parties')\n` +
            `export class PartiesController {\n` +
            `  @Get()\n` +
            `  async list() {}\n` +
            `}\n`,
        },
      ]),
    );

    expect(rules(violations)).toEqual(['permission-declared']);
    expect(message(violations, 'permission-declared')).toContain('@RequirePermission');
  });

  it('accepts each of the three ways a handler may check access', () => {
    const controller = (decorator: string): SourceFile => ({
      path: 'backend/src/modules/parties/parties.controller.ts',
      text:
        `@Controller('api/parties')\n` +
        `export class PartiesController {\n` +
        `  ${decorator}\n` +
        `  @Get()\n` +
        `  async list() {}\n` +
        `}\n`,
    });

    expect(checkConformance(repository([parties], [controller('@Public()')]))).toEqual([]);
    expect(
      checkConformance(
        repository([parties], [controller("@RequirePermission('parties:parties:read')")]),
      ),
    ).toEqual([]);
    expect(
      checkConformance(
        repository([parties], [controller("@NoPermissionRequired('reason')")]),
      ),
    ).toEqual([]);
  });

  /**
   * The two gaps a per-module, per-filename rule would leave.
   *
   * The platform serves endpoints of its own, and they need guarding for exactly the reason a
   * module's do; and a handler in a file nobody thought to call `*.controller.ts` is the case
   * where being unguarded *and* unnoticed coincide. Both are refused by recognising the
   * `@Controller` rather than the path.
   */
  it('refuses an unguarded handler in a platform controller, which belongs to no module', () => {
    const violations = checkConformance(
      repository([parties], [
        {
          path: 'backend/src/platform/reporting/reporting.controller.ts',
          text:
            `@Controller()\n` +
            `export class ReportingController {\n` +
            `  @Get('api/reports')\n` +
            `  reports() {}\n` +
            `}\n`,
        },
      ]),
    );

    expect(rules(violations)).toEqual(['permission-declared']);
    // Nobody's module, so the message names the file instead — and still says what to write.
    expect(message(violations, 'permission-declared')).toContain('reporting.controller.ts');
    expect(message(violations, 'permission-declared')).toContain('@RequirePermission');
  });

  it('refuses an unguarded handler whatever the file is called', () => {
    const violations = checkConformance(
      repository([parties], [
        {
          path: 'backend/src/modules/parties/merge-endpoints.ts',
          text:
            `@Controller('api/parties')\n` +
            `export class MergeEndpoints {\n` +
            `  @Post(':id/merge')\n` +
            `  merge() {}\n` +
            `}\n`,
        },
      ]),
    );

    expect(rules(violations)).toEqual(['permission-declared']);
    expect(message(violations, 'permission-declared')).toContain("'parties'");
  });
});

/**
 * And the modules that actually exist.
 *
 * Per module rather than one assertion over everything, so a failure names the module that
 * broke a rule rather than saying the repository is non-conformant. That is the whole
 * difference between a pack somebody can add a module against and a wall of output.
 */
describe('the modules in this repository', () => {
  const input = conformanceInput();
  const violations = checkConformance(input);
  const names = assembleModules(discoverManifests()).manifests.map((m) => m.name);

  it('has modules to check, so nothing below passes vacuously', () => {
    expect(names).toContain('parties');
    expect(names.length).toBeGreaterThan(1);
  });

  it.each(names)('%s passes the conformance pack', (name) => {
    expect(violations.filter((violation) => violation.module === name)).toEqual([]);
  });

  it('has no boundary violation belonging to no module', () => {
    // The shared-package rules and the platform's own import rule are nobody's module.
    expect(violations.filter((violation) => !violation.module)).toEqual([]);
  });

  /**
   * The entry point CI actually runs, rather than the function underneath it.
   *
   * The rules are proven to refuse above; this proves the wire between them and a failed
   * build. `checkModuleConformance` throws `ConformanceError` carrying every violation, and
   * `check.ts` turns that into a printed list and `exit(1)` — so a rule that fires is a build
   * that fails, rather than a list somebody has to remember to look at.
   */
  it('reports through the entry point the build calls, and says where and why', () => {
    expect(() => checkModuleConformance()).not.toThrow();

    const broken = new ConformanceError([
      {
        rule: 'cross-module-tables',
        module: 'hrm',
        path: 'backend/src/modules/hrm/hrm.service.ts',
        line: 12,
        message: "Module 'hrm' queries 'Party', which module 'parties' owns.",
      },
    ]);

    expect(broken.violations).toHaveLength(1);
    expect(describeViolation(broken.violations[0]!)).toContain('hrm.service.ts:12');
    expect(describeViolation(broken.violations[0]!)).toContain('[cross-module-tables]');
  });
});
