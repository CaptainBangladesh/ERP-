import { Module } from '@nestjs/common';
import type { ModuleTier } from '@erp/shared';
import {
  assembleModules,
  ModuleContractError,
  type ModuleManifest,
} from '../src/platform/modules';

/**
 * Ticket 14 — the foundation audit, as tests rather than as prose.
 *
 * The audit's question is whether the module contract is ready for the *other* thirty-nine
 * modules or merely finished for inventory. That question has an executable form: take the
 * shapes the roadmap actually contains — Sales and Purchase over Parties, Products and
 * Inventory; Accounting as a sink every module writes to; HRM and payroll; Manufacturing;
 * E-commerce; industry add-ons — declare them as manifests, and hand them to the same
 * `assembleModules` the build runs.
 *
 * **Nothing here is a module.** These manifests declare no Nest module worth booting, no
 * tables and no routes anybody serves. They are the roadmap written in the one language the
 * contract can be asked a question in, and they exist so that the audit's conclusions are
 * checked by CI rather than believed. A conclusion recorded only in an ADR is a conclusion
 * that stops being true quietly.
 *
 * Two of these tests assert a **refusal that is a finding**, not a feature: the sink problem
 * in ADR 0009. They are written the way they are — asserting today's behaviour, with the
 * finding named in a comment — so that whichever ticket fixes it has a failing test telling
 * it exactly what changed. See `docs/adr/0009-foundation-audit-against-the-module-roadmap.md`
 * and issues 15 and 16.
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

/** The Core modules that exist today, as the roadmap's later modules will find them. */
const identity = manifest('identity');
const parties = manifest('parties', { dependsOn: ['identity'] });
const products = manifest('products', { dependsOn: ['parties'] });
const inventory = manifest('inventory', {
  dependsOn: ['products'],
  events: { emits: ['inventory.movement.recorded'], consumes: [] },
});

/** The shape stubs' tiers, which are the two the roadmap's other modules have to live with. */
const hrm = manifest('hrm', {
  tier: 'enterprise' as ModuleTier,
  events: { emits: ['hrm.pay-run.calculated'], consumes: [] },
});

const FOUNDATION = [identity, parties, products, inventory, hrm];

describe('the roadmap, assembled', () => {
  describe('modules that depend on what exists', () => {
    it('orders Sales and Purchase behind Parties, Products and Inventory', () => {
      // The ordinary case, and the one the roadmap has most of. Both read the address book
      // and the catalogue, both move stock, and neither is reached by anything below it —
      // so the graph is a widening fan rather than anything the assembler has to think about.
      const sales = manifest('sales', { dependsOn: ['parties', 'products', 'inventory'] });
      const purchase = manifest('purchase', { dependsOn: ['parties', 'products', 'inventory'] });

      const assembled = assembleModules([...FOUNDATION, sales, purchase]);

      // `hrm` is second rather than last because it depends on nothing, so it is ready in the
      // first round alongside `identity` and the tie breaks on tier and then name. Dependency
      // order is a partial order, and the assembler's total order over it is arbitrary by
      // design — what matters is that everything appears after what it depends on.
      expect(assembled.manifests.map((m) => m.name)).toEqual([
        'identity',
        'hrm',
        'parties',
        'products',
        'inventory',
        'purchase',
        'sales',
      ]);
    });

    it('lets Manufacturing sit above Inventory without Inventory learning it exists', () => {
      // Manufacturing consumes and produces stock, which in graph terms is nothing new: it
      // depends on inventory, inventory depends on nothing of its. The tier direction is the
      // part worth asserting — an Enterprise module reaching down into Core is exactly what
      // the rule permits, and the converse is what it is for.
      const manufacturing = manifest('manufacturing', {
        tier: 'enterprise' as ModuleTier,
        dependsOn: ['products', 'inventory'],
      });

      expect(
        assembleModules([...FOUNDATION, manufacturing]).manifests.map((m) => m.name),
      ).toContain('manufacturing');

      // And the direction that must never be available: inventory could not come to depend on
      // the module built on top of it, however convenient a work-order lookup looked one day.
      expect(() =>
        assembleModules([
          ...FOUNDATION.filter((m) => m.name !== 'inventory'),
          { ...inventory, dependsOn: ['products', 'manufacturing'] },
          manufacturing,
        ]),
      ).toThrow(/inventory.*core.*manufacturing.*enterprise/is);
    });

    it('lets an industry add-on extend a Core module from the Custom tier', () => {
      // What `warranties` already proves in the running application, restated as the general
      // case: an add-on depends on what it extends, is never depended upon, and its absence
      // is a tier band rather than a code path.
      const fieldService = manifest('field-service', {
        tier: 'custom' as ModuleTier,
        dependsOn: ['parties', 'products', 'inventory'],
      });

      const assembled = assembleModules([...FOUNDATION, fieldService]);
      expect(assembled.manifests.at(-1)?.name).toBe('field-service');

      // The property that makes it optional rather than merely last: take it away and
      // everything it extended still assembles, untouched.
      expect(assembleModules(FOUNDATION).manifests.map((m) => m.name)).not.toContain(
        'field-service',
      );
    });
  });

  describe('Accounting, the sink every module writes to', () => {
    /**
     * Accounting as the roadmap describes it: it listens, and nothing listens to it.
     *
     * `dependsOn` has to name every emitter, because `checkEventsAreDeclared` refuses a
     * consumed event that no *declared dependency* emits. That single rule is what the three
     * tests below are pulling on from three directions.
     */
    const accounting = (tier: ModuleTier, emitters: string[]): ModuleManifest =>
      manifest('accounting', {
        tier,
        dependsOn: emitters,
        events: {
          emits: [],
          consumes: ['inventory.movement.recorded', 'hrm.pay-run.calculated'],
        },
      });

    it('assembles once it is at the tier of the highest module it listens to', () => {
      // Enterprise, because it listens to hrm and hrm is Enterprise. Not a choice anybody
      // made about Accounting — a consequence of what it happens to listen to.
      const assembled = assembleModules([
        ...FOUNDATION,
        accounting('enterprise', ['inventory', 'hrm']),
      ]);

      expect(assembled.events.consumed).toEqual([
        'hrm.pay-run.calculated',
        'inventory.movement.recorded',
      ]);
      expect(assembled.manifests.map((m) => m.name)).toContain('accounting');
    });

    /**
     * FINDING 1, first consequence (ADR 0009, issue 15) — listening to a module drags its
     * tier along.
     *
     * A Core-tier company runs Inventory, Sales and Purchase, all of which emit things a
     * ledger wants. Accounting cannot be Core while it also listens to payroll, so the
     * company that has the most ordinary possible need for a general ledger cannot have one.
     * Nothing about a *listener* requires this: an event carries its own payload and the
     * listener injects nothing.
     */
    it('refuses to be Core while listening to an Enterprise module — the sink tier problem', () => {
      expect(() => assembleModules([...FOUNDATION, accounting('core', ['inventory', 'hrm'])])).toThrow(
        /accounting.*core.*hrm.*enterprise/is,
      );
    });

    /**
     * FINDING 1, second consequence (ADR 0009, issue 15) — the deletion test fails in the
     * sink's direction.
     *
     * The spec's deletion test is that excluding any business module leaves the application
     * building and booting. It holds for every module *below* the one removed, and it is the
     * property the whole module contract exists to preserve. It does not hold for a listener:
     * remove inventory and Accounting — which only ever listened — refuses to assemble,
     * naming a module it never called a method on.
     *
     * This is asserted as it behaves today rather than as it ought to. Issue 15 is what
     * changes it, and this test is what tells issue 15 it worked.
     */
    it('takes the sink down with any source removed — the deletion test in reverse', () => {
      const withoutInventory = FOUNDATION.filter((m) => m.name !== 'inventory');

      expect(() =>
        assembleModules([...withoutInventory, accounting('enterprise', ['inventory', 'hrm'])]),
      ).toThrow(ModuleContractError);
      expect(() =>
        assembleModules([...withoutInventory, accounting('enterprise', ['inventory', 'hrm'])]),
      ).toThrow(/accounting.*depends on.*inventory.*not present/is);
    });

    it('cannot drop the emitter from dependsOn to escape either, which is the rule working', () => {
      // Worth asserting so that the finding is not mistaken for a hole somebody could just
      // route around: declaring the consumption without the dependency is refused, and rightly
      // — an undeclared edge makes the graph describe something other than the code. The two
      // refusals together are what make this a contract change rather than a convention.
      expect(() =>
        assembleModules([...FOUNDATION, accounting('enterprise', ['hrm'])]),
      ).toThrow(/accounting.*inventory\.movement\.recorded/is);
    });
  });

  describe('what the contract already gets right for shapes nothing has built yet', () => {
    it('keeps the graph acyclic when a module both reads from and announces to another', () => {
      // E-commerce is the roadmap's most tangled module: it reads the catalogue and stock,
      // places orders through Sales, and wants Inventory to hear about a reservation. The
      // temptation is a dependency in both directions, and the assembler names the cycle
      // rather than resolving it — which is the moment somebody chooses an event instead.
      const sales = manifest('sales', { dependsOn: ['parties', 'products', 'inventory'] });
      const ecommerce = manifest('ecommerce', {
        dependsOn: ['products', 'inventory', 'sales'],
        events: { emits: ['ecommerce.order.placed'], consumes: [] },
      });

      expect(
        assembleModules([...FOUNDATION, sales, ecommerce]).manifests.map((m) => m.name),
      ).toContain('ecommerce');

      // The same graph with the back-edge somebody would eventually be tempted to add — a
      // storefront reservation that inventory wants to read directly. All three modules are
      // Core here, so the tier rule has nothing to say and the cycle check is what refuses it,
      // naming every module on the loop rather than only the import that closed it.
      expect(() =>
        assembleModules([
          ...FOUNDATION.filter((m) => m.name !== 'inventory'),
          { ...inventory, dependsOn: ['products', 'ecommerce'] },
          sales,
          ecommerce,
        ]),
      ).toThrow(/cycle.*(inventory|ecommerce)/is);
    });

    it('keeps every module’s permissions in its own namespace, at forty modules as at six', () => {
      // The property that makes "no central permission list" survive the roadmap: two modules
      // cannot collide, because neither can name the other's namespace at all.
      const payroll = manifest('payroll', {
        tier: 'enterprise' as ModuleTier,
        dependsOn: ['hrm'],
        permissions: ['payroll:runs:write'],
      });

      expect(assembleModules([...FOUNDATION, payroll]).permissions).toContain(
        'payroll:runs:write',
      );

      expect(() =>
        assembleModules([
          ...FOUNDATION,
          manifest('payroll', {
            tier: 'enterprise' as ModuleTier,
            permissions: ['hrm:pay:read'],
          }),
        ]),
      ).toThrow(/payroll.*hrm:pay:read/is);
    });

    it('refuses two modules claiming one table, which is what makes the boundary rule mean anything', () => {
      // Sales and Purchase both want an "order". The failure this refuses is not two tables
      // called the same thing — it is one table two modules both believe they own, which
      // makes the cross-module table rule answer differently depending on read order.
      const sales = manifest('sales', { dependsOn: ['parties'], models: ['Order'] });
      const purchase = manifest('purchase', { dependsOn: ['parties'], models: ['Order'] });

      expect(() => assembleModules([...FOUNDATION, sales, purchase])).toThrow(
        /'Order' is claimed by both 'purchase' and 'sales'/is,
      );
    });
  });
});
