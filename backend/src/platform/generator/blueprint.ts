import type { ModuleManifest } from '../modules';
import { namesOf, type ModuleNames } from './module-name';
import type { ModuleRequest } from './refusals';
import * as templates from './templates';

/**
 * A new module, as text, before anything is written.
 *
 * Pure — it takes a request and answers with files and edits, opening nothing. That is the
 * same split the conformance pack makes for the same reason: the interesting part becomes a
 * function a test can call, so "a generated module passes the pack" is a test that runs in
 * milliseconds rather than one that shells out, writes eleven files into the working tree and
 * hopes to clean them up afterwards.
 *
 * Two kinds of output, and the distinction is the whole of what the generator is for:
 *
 * - **Files**, which are the module. Nothing central lists them; they are found by the
 *   backend's directory scan and the frontend's glob because they exist at the right paths.
 * - **Patches**, which are the three places the system genuinely cannot derive from a
 *   directory: the Prisma schema, the tenancy classification, and the shared package's
 *   barrel. Each is a file a person would otherwise have to remember, and *forgetting* each
 *   one fails in a different confusing place — a missing table at runtime, a refused boot, a
 *   type that does not resolve. Doing them here is most of the value: it is the part of
 *   adding a module that is not creative.
 */
export interface GeneratedFile {
  /** Repo-relative, forward slashes. */
  readonly path: string;
  readonly text: string;
}

/**
 * An edit to a file that already exists.
 *
 * Anchored rather than positional: the insertion point is described by the text around it, so
 * a patch that no longer knows where to go says so instead of writing the entry somewhere
 * arbitrary. Silently appending a model classification outside its table would produce a file
 * that does not compile, which is recoverable — but the same trick in `schema.prisma` would
 * produce one that does.
 */
export interface GeneratedPatch {
  readonly path: string;
  /** Inserted verbatim. */
  readonly text: string;
  /** Start looking here. Omitted means from the beginning. */
  readonly after?: string;
  /** Insert immediately before this. Omitted means append to the end of the file. */
  readonly before?: string;
  /** What this patch is for, in the CLI's summary and in its failure. */
  readonly describe: string;
}

export interface GeneratedModule {
  readonly names: ModuleNames;
  /**
   * What the module declares about itself, as a value.
   *
   * The manifest minus `nestModule`, because a class cannot be produced by a text generator
   * — the generated `.manifest.ts` names one, and this is the same declaration without it.
   * Its purpose is the test: `assembleModules` can be handed this, with a stub Nest module,
   * to prove that what is about to be written down assembles into an application.
   */
  readonly declaration: Omit<ModuleManifest, 'nestModule'>;
  readonly files: readonly GeneratedFile[];
  readonly patches: readonly GeneratedPatch[];
}

export function planModule(request: ModuleRequest): GeneratedModule {
  const names = namesOf(request.name, request.record);
  const migration = `${request.stamp}_${names.table}`;

  return {
    names,
    declaration: {
      name: names.name,
      tier: request.tier,
      dependsOn: [...request.dependsOn],
      routes: [`api/${names.name}`],
      migrations: [migration],
      models: [names.record],
      permissions: [`${names.name}:${names.name}:read`, `${names.name}:${names.name}:write`],
      navigation: [
        {
          label: sentenceCase(names.words),
          path: `/${names.name}`,
          order: 50,
          permission: `${names.name}:${names.name}:read`,
        },
      ],
      events: { emits: [], consumes: [] },
    },
    files: [
      {
        path: `backend/src/modules/${names.name}/${names.name}.manifest.ts`,
        text: templates.manifestFile(names, request.tier, request.dependsOn, migration),
      },
      {
        path: `backend/src/modules/${names.name}/${names.name}.module.ts`,
        text: templates.nestModuleFile(names),
      },
      {
        path: `backend/src/modules/${names.name}/${names.name}.controller.ts`,
        text: templates.controllerFile(names),
      },
      {
        path: `backend/src/modules/${names.name}/${names.name}.service.ts`,
        text: templates.serviceFile(names),
      },
      { path: `backend/src/modules/${names.name}/schemas.ts`, text: templates.schemasFile(names) },
      {
        path: `backend/src/modules/${names.name}/index.ts`,
        text: templates.publicSurfaceFile(names),
      },
      {
        path: `backend/prisma/migrations/${migration}/migration.sql`,
        text: templates.migrationFile(names),
      },
      { path: `backend/test/${names.name}.spec.ts`, text: templates.backendTestFile(names) },
      {
        path: `packages/src/modules/${names.name}/contract.ts`,
        text: templates.contractFile(names),
      },
      {
        path: `application/src/modules/${names.name}/manifest.ts`,
        text: templates.frontendManifestFile(names),
      },
      {
        path: `application/src/modules/${names.name}/pages/${names.pascal}Page.tsx`,
        text: templates.pageFile(names),
      },
      {
        path: `application/src/modules/${names.name}/pages/${names.pascal}Page.test.tsx`,
        text: templates.pageTestFile(names),
      },
    ],
    patches: [
      {
        path: 'backend/prisma/schema.prisma',
        text: templates.schemaSection(names),
        describe: `the ${names.record} model, in a section of its own`,
      },
      {
        path: 'backend/src/platform/tenancy/company-owned.ts',
        text: templates.tenancyClassification(names),
        after: CLASSIFICATION_TABLE,
        before: '\n};',
        describe: `${names.record} classified as company-owned`,
      },
      {
        path: 'packages/src/index.ts',
        text: templates.sharedBarrelExport(names),
        describe: `${names.name}'s wire contract, exported from '@erp/shared'`,
      },
    ],
  };
}

/** The table a model classification is inserted into. Named here because the patch anchors to it. */
const CLASSIFICATION_TABLE = 'const CLASSIFICATION';

export class PatchError extends Error {
  constructor(patch: GeneratedPatch) {
    super(
      `Could not apply the patch to '${patch.path}' (${patch.describe}): the text it ` +
        `anchors to is not there any more. Nothing has been written. Either restore the ` +
        `anchor, or make the edit by hand — it is ${JSON.stringify(patch.text.trim())} — and ` +
        `teach 'platform/generator/blueprint.ts' where it now goes.`,
    );
    this.name = 'PatchError';
  }
}

/** A patched file's new contents. Throws rather than guessing where the edit belongs. */
export function applyPatch(existing: string, patch: GeneratedPatch): string {
  const from = patch.after ? existing.indexOf(patch.after) : 0;
  if (from < 0) throw new PatchError(patch);

  if (patch.before === undefined) {
    return existing.endsWith('\n') || existing.length === 0
      ? `${existing}${patch.text}`
      : `${existing}\n${patch.text}`;
  }

  const at = existing.indexOf(patch.before, from);
  if (at < 0) throw new PatchError(patch);

  return existing.slice(0, at) + patch.text + existing.slice(at);
}

function sentenceCase(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}
