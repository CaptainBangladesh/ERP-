import { Module } from '@nestjs/common';
import { HRM_PAY_GRANT, type ModuleTier } from '@erp/shared';
import {
  assembleModules,
  discoverManifests,
  ModuleContractError,
  type ModuleManifest,
} from '../src/platform/modules';
import { restrictedGrants } from '../src/platform/tenancy/company-owned';

/**
 * The module contract, exercised directly.
 *
 * This is the one place the suite tests something other than the HTTP boundary, and it is
 * deliberate: the assembler's deliverable *is* its refusals. "A dependency cycle fails the
 * build with a message naming the problem" is not observable over HTTP — the application
 * never starts — so the only seam that can assert it is the assembler's own surface. It is
 * a pure function over declarations, not a service or a repository, so nothing here binds
 * to internal structure that ticket 05 or 06 might move.
 *
 * Everything else about identity is tested over HTTP in `identity.spec.ts`.
 */

@Module({})
class StubNestModule {}

function manifest(
  name: string,
  overrides: Partial<ModuleManifest> = {},
): ModuleManifest {
  return {
    name,
    tier: 'core',
    dependsOn: [],
    nestModule: StubNestModule,
    routes: [`api/${name}`],
    migrations: [],
    permissions: [],
    navigation: [],
    events: { emits: [], consumes: [] },
    ...overrides,
  };
}

describe('module assembly', () => {
  it('assembles an application from nothing but manifests', () => {
    const assembled = assembleModules([
      manifest('identity', {
        permissions: ['identity:users:read'],
        navigation: [{ label: 'Home', path: '/', order: 10 }],
      }),
    ]);

    expect(assembled.manifests.map((m) => m.name)).toEqual(['identity']);
    expect(assembled.nestModules).toEqual([StubNestModule]);
    expect(assembled.permissions).toEqual(['identity:users:read']);
    expect(assembled.navigation).toEqual([
      { module: 'identity', label: 'Home', path: '/', order: 10 },
    ]);
  });

  it('boots with any subset of modules, so long as the subset is dependency-closed', () => {
    const identity = manifest('identity');
    const products = manifest('products', { dependsOn: ['identity'] });
    const inventory = manifest('inventory', { dependsOn: ['products'] });

    // The deletion test: removing a business module leaves the foundation assembling.
    expect(assembleModules([identity, products]).manifests.map((m) => m.name)).toEqual([
      'identity',
      'products',
    ]);
    expect(assembleModules([identity]).manifests.map((m) => m.name)).toEqual(['identity']);
    expect(assembleModules([]).manifests).toEqual([]);

    // Removing something depended upon is the case that must not pass silently.
    expect(() => assembleModules([identity, inventory])).toThrow(ModuleContractError);
  });

  it('orders modules by dependency, and identically whatever order they were discovered in', () => {
    const identity = manifest('identity');
    const products = manifest('products', { dependsOn: ['identity'] });
    const parties = manifest('parties', { dependsOn: ['identity'] });
    const inventory = manifest('inventory', { dependsOn: ['products', 'parties'] });

    const expected = ['identity', 'parties', 'products', 'inventory'];

    // Filesystem discovery order is not guaranteed across machines, so the assembled order
    // must not depend on it. Independent siblings break ties on name.
    expect(
      assembleModules([inventory, products, identity, parties]).manifests.map((m) => m.name),
    ).toEqual(expected);
    expect(
      assembleModules([identity, products, parties, inventory]).manifests.map((m) => m.name),
    ).toEqual(expected);
  });

  it('names the missing module when a dependency is absent', () => {
    expect(() => assembleModules([manifest('inventory', { dependsOn: ['products'] })])).toThrow(
      /inventory.*depends on.*products.*not present/is,
    );
  });

  it('names every module in the cycle when modules depend on each other', () => {
    const a = manifest('alpha', { dependsOn: ['beta'] });
    const b = manifest('beta', { dependsOn: ['gamma'] });
    const c = manifest('gamma', { dependsOn: ['alpha'] });

    // Without the names, a cycle among forty modules is a needle in a haystack.
    expect(() => assembleModules([a, b, c])).toThrow(/cycle/i);
    expect(() => assembleModules([a, b, c])).toThrow(/alpha.*beta.*gamma/is);
  });

  it('refuses a Core module that depends on a higher tier', () => {
    const addOn = manifest('field-service', { tier: 'custom' as ModuleTier });
    const core = manifest('identity', { dependsOn: ['field-service'] });

    expect(() => assembleModules([core, addOn])).toThrow(
      /identity.*core.*field-service.*custom/is,
    );
  });

  it('allows a higher tier to depend on a lower one', () => {
    const core = manifest('identity');
    const addOn = manifest('field-service', {
      tier: 'custom' as ModuleTier,
      dependsOn: ['identity'],
    });

    expect(assembleModules([core, addOn]).manifests.map((m) => m.name)).toEqual([
      'identity',
      'field-service',
    ]);
  });

  it('refuses two modules claiming the same route', () => {
    const a = manifest('alpha', { routes: ['api/things'] });
    const b = manifest('beta', { routes: ['api/things'] });

    expect(() => assembleModules([a, b])).toThrow(/api\/things.*alpha.*beta/is);
  });

  it('refuses two modules declaring the same name', () => {
    expect(() => assembleModules([manifest('identity'), manifest('identity')])).toThrow(
      /identity.*declared twice/is,
    );
  });

  it('refuses a permission that is not prefixed by its own module', () => {
    // The prefix is what makes permissions addable without a central list: a module can
    // only ever introduce permissions in its own namespace, so two modules cannot collide.
    expect(() =>
      assembleModules([manifest('identity', { permissions: ['inventory:stock:read'] })]),
    ).toThrow(/identity.*inventory:stock:read/is);

    expect(() =>
      assembleModules([manifest('identity', { permissions: ['identity:users'] })]),
    ).toThrow(/module:resource:action/is);
  });

  it('refuses a navigation entry guarded by a permission the module never declared', () => {
    expect(() =>
      assembleModules([
        manifest('identity', {
          navigation: [{ label: 'Users', path: '/users', order: 1, permission: 'identity:users:read' }],
        }),
      ]),
    ).toThrow(/identity:users:read/);
  });

  it('sorts navigation by order and then label, never by discovery order', () => {
    const a = manifest('alpha', { navigation: [{ label: 'Zebra', path: '/z', order: 1 }] });
    const b = manifest('beta', {
      navigation: [
        { label: 'Apple', path: '/a', order: 1 },
        { label: 'Home', path: '/', order: 0 },
      ],
    });

    expect(assembleModules([a, b]).navigation.map((e) => e.label)).toEqual([
      'Home',
      'Apple',
      'Zebra',
    ]);
  });

  it('refuses a module consuming an event no module it depends on emits', () => {
    const identity = manifest('identity', { events: { emits: ['identity.company.created'], consumes: [] } });
    const listener = manifest('welcome', {
      dependsOn: ['identity'],
      events: { emits: [], consumes: ['identity.company.created'] },
    });

    expect(assembleModules([identity, listener]).events.consumed).toEqual([
      'identity.company.created',
    ]);

    const undeclared = manifest('welcome', {
      events: { emits: [], consumes: ['identity.company.created'] },
    });
    // Consuming without declaring the dependency is how the module graph starts lying.
    expect(() => assembleModules([identity, undeclared])).toThrow(
      /welcome.*identity\.company\.created/is,
    );
  });
});

describe('migration assembly', () => {
  it('orders migrations by the module graph', () => {
    const identity = manifest('identity', { migrations: ['20260801000000_identity'] });
    const products = manifest('products', {
      dependsOn: ['identity'],
      migrations: ['20260802000000_products', '20260803000000_products_cost'],
    });

    expect(assembleModules([products, identity]).migrations).toEqual([
      '20260801000000_identity',
      '20260802000000_products',
      '20260803000000_products_cost',
    ]);
  });

  it('refuses a migration timestamped before one it depends on', () => {
    // Prisma applies migrations in name order, so a module whose migration sorts ahead of
    // its dependency's would try to reference a table that does not exist yet. Catching it
    // here turns a deploy-time failure into a build-time one.
    const identity = manifest('identity', { migrations: ['20260805000000_identity'] });
    const products = manifest('products', {
      dependsOn: ['identity'],
      migrations: ['20260801000000_products'],
    });

    expect(() => assembleModules([identity, products])).toThrow(
      /20260801000000_products.*20260805000000_identity/is,
    );
  });

  it('refuses two modules claiming the same migration', () => {
    const a = manifest('alpha', { migrations: ['20260801000000_shared'] });
    const b = manifest('beta', { migrations: ['20260801000000_shared'] });

    expect(() => assembleModules([a, b])).toThrow(/20260801000000_shared.*alpha.*beta/is);
  });
});

/**
 * The two declarations that have to agree, and are written in different files by different
 * people for different reasons.
 *
 * A restricted column names a grant; a module names its permissions. Neither imports the
 * other — the platform has no business importing a module, and a module has no business
 * knowing which columns the platform restricts — so the only thing keeping them in step is
 * this. Without it, renaming a permission leaves a column restricted by a grant nobody can
 * hold, and the field becomes invisible to everybody including the people who need it. That
 * failure is silent, which is what earns it a test.
 */
describe('restricted fields and the permissions that read them', () => {
  it('restricts fields only by grants some module actually declares', () => {
    const declared = new Set(
      assembleModules(discoverManifests()).permissions,
    );

    for (const grant of restrictedGrants()) {
      expect([grant, declared.has(grant)]).toEqual([grant, true]);
    }
  });

  it('has something to check', () => {
    // The stub's sensitive field is the whole reason the restriction mechanism exists. If
    // this is ever empty, the test above is passing vacuously.
    expect(restrictedGrants()).toContain(HRM_PAY_GRANT);
  });
});
