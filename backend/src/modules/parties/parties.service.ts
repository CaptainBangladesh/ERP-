import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PARTY_ERROR_CODES,
  type PartyKind,
  type PartyListResponse,
  type PartyResponse,
  type PartyRolesResponse,
  type PartyStatus,
  type PartySummary,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { defined } from '../../prisma/columns';
import { FieldException } from '../../http/validation-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { PartyDirectory } from './party-directory';
import {
  AddPartyRoleBody,
  CreatePartyAddressBody,
  CreatePartyBody,
  MergePartiesBody,
  PARTY_LIST,
  UpdatePartyBody,
} from './schemas';

/**
 * One address book, and the rules that keep it one.
 *
 * Three of those rules are the reason this module exists rather than five modules each
 * keeping their own list of people:
 *
 * - **A party holds roles rather than being of a role.** The same record is a customer and a
 *   supplier at once, roles come and go without recreating anything, and no table anywhere
 *   says which roles exist — so Sales introducing `prospect` changes nothing here.
 * - **Nothing is deleted.** Deactivating keeps a three-year-old order intelligible; a delete
 *   would leave it naming an id that resolves to nothing.
 * - **Merging keeps both rows.** The duplicate survives as a pointer, so anything already
 *   referring to it still answers with the party that is real.
 *
 * There is no company filter in this file, as in every module: the platform scopes every
 * query below, so another company's parties are not reachable from here even by trying.
 */
@Injectable()
export class PartiesService implements PartyDirectory {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async createParty(input: Valid<typeof CreatePartyBody>): Promise<PartyResponse> {
    if (input.organisationId) await this.requireOrganisation(input.organisationId);

    const party = await this.prisma.party.create({
      data: companyApplied<Prisma.PartyUncheckedCreateInput>({
        kind: input.kind,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        organisationId: input.kind === 'person' ? input.organisationId ?? null : null,
      }),
    });

    // Written as their own statement rather than nested in the create above: a nested write
    // is executed as part of its parent's query and is not seen by the tenancy extension, so
    // the company would never be applied to the role rows. See docs/tenancy.md.
    if (input.roles?.length) await this.writeRoles(party.id, input.roles);

    return this.partyDetail(party.id);
  }

  async listParties(query: Record<string, unknown>): Promise<PartyListResponse> {
    const slice = listQuery(query, PARTY_LIST);

    const [parties, total] = await Promise.all([
      this.prisma.party.findMany({
        ...slice.findMany<Prisma.PartyFindManyArgs>(),
        include: SUMMARY,
      }),
      this.prisma.party.count(slice.count<Prisma.PartyCountArgs>()),
    ]);

    return slice.respond(parties.map(summarise), total);
  }

  /**
   * One party, with everything a screen showing it needs.
   *
   * Its members are read as their own query rather than through a second `include`. Nesting
   * two levels would fetch every member's roles and organisation as well, which is a lot of
   * rows for a panel that shows names.
   */
  async partyDetail(id: string): Promise<PartyResponse> {
    const party = await this.prisma.party.findFirst({
      where: { id },
      include: { ...SUMMARY, addresses: { orderBy: [{ isPrimary: 'desc' }, { label: 'asc' }] } },
    });
    if (!party) throw partyNotFound();

    const members =
      party.kind === 'organisation'
        ? await this.prisma.party.findMany({
            where: { organisationId: party.id },
            include: SUMMARY,
            orderBy: { name: 'asc' },
          })
        : [];

    return {
      ...summarise(party),
      addresses: party.addresses.map(describeAddress),
      members: members.map(summarise),
    };
  }

  /**
   * Changes a party's details, or deactivates it.
   *
   * Deactivation is a status rather than an endpoint of its own, because it is the same act
   * as any other correction from the caller's point of view and the same write from the
   * database's. What it is emphatically not is a delete: the row stays, so every order,
   * invoice and movement that names it still means something.
   */
  async changeParty(id: string, input: Valid<typeof UpdatePartyBody>): Promise<PartyResponse> {
    const existing = await this.requireEditableParty(id);

    if (input.organisationId) {
      if (existing.kind === 'organisation') throw notAnOrganisation('organisationId');
      await this.requireOrganisation(input.organisationId);
    }

    await this.prisma.party
      .update({
        where: { id },
        data: {
          ...defined('name', input.name),
          ...defined('email', input.email),
          ...defined('phone', input.phone),
          ...defined('status', input.status),
          ...defined('organisationId', input.organisationId),
        },
      })
      .catch(notFound);

    return this.partyDetail(id);
  }

  /**
   * Gives a party a role.
   *
   * Idempotent: asking twice is asking once, because holding a role twice is not a different
   * fact from holding it once and a caller re-running a script should not be told off for it.
   * The unique constraint is what actually enforces that — the check below is only there to
   * make the ordinary case a single statement.
   */
  async addRole(id: string, input: Valid<typeof AddPartyRoleBody>): Promise<PartyResponse> {
    await this.requireEditableParty(id);

    await this.writeRoles(id, [input.role]);
    return this.partyDetail(id);
  }

  /** Takes a role away. Silent about a role the party did not hold — the end state is asked for. */
  async removeRole(id: string, role: string): Promise<PartyResponse> {
    await this.requireEditableParty(id);

    await this.prisma.partyRole.deleteMany({ where: { partyId: id, role } });
    return this.partyDetail(id);
  }

  /**
   * The roles this company has actually used.
   *
   * Read from the roles themselves rather than from a list of permitted ones, because there
   * is no list of permitted ones and there is not going to be. It is what a filter control
   * offers, so the screens are extended by the same act that extends the data: give somebody
   * a role nobody has held before and it appears in the filter.
   */
  async rolesInUse(): Promise<PartyRolesResponse> {
    const rows = await this.prisma.partyRole.findMany({
      distinct: ['role'],
      select: { role: true },
      orderBy: { role: 'asc' },
    });

    return { roles: rows.map((row) => row.role) };
  }

  async addAddress(
    id: string,
    input: Valid<typeof CreatePartyAddressBody>,
  ): Promise<PartyResponse> {
    await this.requireEditableParty(id);

    await this.prisma.$transaction(async (tx) => {
      // At most one primary address, kept so here rather than by a partial unique index:
      // the rule is "the newest claim wins", and a constraint would make the second claim an
      // error the caller has to resolve instead of an instruction they meant.
      if (input.primary) {
        await tx.partyAddress.updateMany({
          where: { partyId: id, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      await tx.partyAddress.create({
        data: companyApplied<Prisma.PartyAddressUncheckedCreateInput>({
          partyId: id,
          label: input.label,
          line1: input.line1,
          line2: input.line2 ?? null,
          city: input.city,
          postcode: input.postcode,
          country: input.country,
          isPrimary: input.primary ?? false,
        }),
      });
    });

    return this.partyDetail(id);
  }

  async removeAddress(id: string, addressId: string): Promise<PartyResponse> {
    await this.requireEditableParty(id);

    const removed = await this.prisma.partyAddress.deleteMany({
      where: { id: addressId, partyId: id },
    });
    if (removed.count === 0) throw addressNotFound();

    return this.partyDetail(id);
  }

  /**
   * Two records, one real-world entity.
   *
   * The duplicate is not deleted. It becomes a party with the status `merged` pointing at
   * the survivor, and everything it carried — roles, addresses, contact details nobody had
   * filled in on the survivor, and any people belonging to it — moves across. That is what
   * "keeping history intact" has to mean in a system where other modules hold party ids: an
   * order placed against the duplicate three years ago still resolves, through
   * `PartyDirectory.party`, to the customer who really placed it.
   *
   * Merge chains are flattened as they are made — anything already pointing at the duplicate
   * is repointed at the survivor — so following a merge is always one hop and can never
   * loop.
   *
   * Kinds must match. A person and an organisation are not two records of one entity; they
   * are an employee and their employer, which is what `organisationId` is for.
   */
  async mergeParties(
    survivorId: string,
    input: Valid<typeof MergePartiesBody>,
  ): Promise<PartyResponse> {
    if (survivorId === input.duplicateId) {
      throw cannotMerge('A party cannot be merged into itself.');
    }

    const [survivor, duplicate] = await Promise.all([
      this.requireEditableParty(survivorId),
      this.requireParty(input.duplicateId),
    ]);

    if (duplicate.mergedIntoId) {
      throw cannotMerge('That party has already been merged into another.');
    }
    if (survivor.kind !== duplicate.kind) {
      throw cannotMerge(
        'A person and an organisation are not the same entity. If one works for the ' +
          'other, set the person’s organisation instead.',
      );
    }

    const [survivorRoles, duplicateRoles] = await Promise.all([
      this.prisma.partyRole.findMany({ where: { partyId: survivor.id } }),
      this.prisma.partyRole.findMany({ where: { partyId: duplicate.id } }),
    ]);

    const held = new Set(survivorRoles.map((row) => row.role));
    const moving = duplicateRoles.filter((row) => !held.has(row.role));

    await this.prisma.$transaction(async (tx) => {
      for (const row of moving) {
        await tx.partyRole.update({ where: { id: row.id }, data: { partyId: survivor.id } });
      }
      // Whatever is left is a role the survivor already holds; a merged party holds none.
      await tx.partyRole.deleteMany({ where: { partyId: duplicate.id } });

      // The survivor's main address stays the main one, so the duplicate's arrive demoted.
      // Repointing them unchanged would leave two rows claiming to be the one used when
      // nothing says otherwise, which is the invariant `addAddress` exists to keep.
      const alreadyPrimary = await tx.partyAddress.count({
        where: { partyId: survivor.id, isPrimary: true },
      });

      await tx.partyAddress.updateMany({
        where: { partyId: duplicate.id },
        data: { partyId: survivor.id, ...(alreadyPrimary > 0 ? { isPrimary: false } : {}) },
      });

      // If the survivor had none, the duplicate may have brought several; keep the first.
      if (alreadyPrimary === 0) {
        const [main, ...rest] = await tx.partyAddress.findMany({
          where: { partyId: survivor.id, isPrimary: true },
          orderBy: { createdAt: 'asc' },
        });

        if (main && rest.length > 0) {
          await tx.partyAddress.updateMany({
            where: { id: { in: rest.map((address) => address.id) } },
            data: { isPrimary: false },
          });
        }
      }

      await tx.party.updateMany({
        where: { organisationId: duplicate.id },
        data: { organisationId: survivor.id },
      });

      // Flattening, so `party()` never follows more than one pointer.
      await tx.party.updateMany({
        where: { mergedIntoId: duplicate.id },
        data: { mergedIntoId: survivor.id },
      });

      await tx.party.update({
        where: { id: survivor.id },
        data: {
          // The survivor's own details win. Only what it was missing is taken across —
          // merging should never silently overwrite the record somebody chose to keep.
          email: survivor.email ?? duplicate.email,
          phone: survivor.phone ?? duplicate.phone,
          organisationId: survivor.organisationId ?? duplicate.organisationId,
        },
      });

      await tx.party.update({
        where: { id: duplicate.id },
        data: { status: 'merged', mergedIntoId: survivor.id, organisationId: null },
      });
    });

    return this.partyDetail(survivor.id);
  }

  // ─── PartyDirectory: what other modules may ask ───────────────────────────────────

  async party(id: string): Promise<PartySummary | undefined> {
    const [found] = await this.resolve([id]);
    return found;
  }

  async parties(ids: readonly string[]): Promise<PartySummary[]> {
    return this.resolve(ids);
  }

  /**
   * Parties by id, with merges followed, in the order asked for.
   *
   * One function behind both `party` and `parties`, because following a merge is not an
   * optional extra of the single read: a contract that resolved a merged id one way when
   * asked for one party and another way when asked for two would be a contract with a
   * coin-flip in it, and the consumer would find out on the day somebody merged a customer.
   *
   * The order is the caller's, which is nearly always the order of the rows they are about
   * to render, and never the order the database found them in. Ids this company does not
   * know are left out rather than answered as gaps.
   */
  private async resolve(ids: readonly string[]): Promise<PartySummary[]> {
    if (ids.length === 0) return [];

    const found = await this.prisma.party.findMany({
      where: { id: { in: [...ids] } },
      include: SUMMARY,
    });

    // One further read for whatever turned out to be a duplicate. A merge is flattened when
    // it is made, so one hop is always enough and this cannot recurse.
    const survivorIds = found.flatMap((party) =>
      party.mergedIntoId ? [party.mergedIntoId] : [],
    );

    const survivors =
      survivorIds.length === 0
        ? []
        : await this.prisma.party.findMany({
            where: { id: { in: survivorIds } },
            include: SUMMARY,
          });

    const byId = new Map([...found, ...survivors].map((party) => [party.id, party]));

    return ids.flatMap((id) => {
      const party = byId.get(id);
      if (!party) return [];

      // Answering with the merged record if the survivor is somehow gone beats answering
      // with nothing: the caller asked who this id is, and this id was somebody.
      const survivor = party.mergedIntoId ? byId.get(party.mergedIntoId) : undefined;
      return [summarise(survivor ?? party)];
    });
  }

  async withRole(role: string): Promise<PartySummary[]> {
    const parties = await this.prisma.party.findMany({
      where: { status: 'active', roles: { some: { role } } },
      include: SUMMARY,
      orderBy: { name: 'asc' },
    });

    return parties.map(summarise);
  }

  // ─── internals ────────────────────────────────────────────────────────────────────

  private async requireParty(id: string) {
    const party = await this.prisma.party.findFirst({ where: { id } });
    if (!party) throw partyNotFound();
    return party;
  }

  /**
   * The party, if it is still the record to edit.
   *
   * One function rather than the pair of lines repeated at the top of every write, because
   * the pair of lines is one idea — "this id resolves, and it resolves to the real record"
   * — and the copy that gets forgotten is the one nobody notices. A merged party is not
   * editable: it is kept so that older history resolves, and writing to it would be writing
   * to a record whose readers have all been redirected elsewhere.
   */
  private async requireEditableParty(id: string) {
    const party = await this.requireParty(id);
    if (party.mergedIntoId) throw partyMerged(party.mergedIntoId);
    return party;
  }

  private async requireOrganisation(id: string): Promise<void> {
    const organisation = await this.prisma.party.findFirst({ where: { id } });
    // The same answer for "no such party" and "that party is a person", because both mean
    // the caller cannot use this id here and neither is worth two error codes.
    if (!organisation || organisation.kind !== 'organisation') {
      throw notAnOrganisation('organisationId');
    }
  }

  /**
   * Roles a party may already hold, written without complaining about it.
   *
   * `createMany` with `skipDuplicates` rather than a read followed by a write: the unique
   * constraint is the only thing that can settle a race between two people adding the same
   * role at the same moment, and asking first would just move the race earlier.
   */
  private async writeRoles(partyId: string, roles: readonly string[]): Promise<void> {
    await this.prisma.partyRole.createMany({
      data: roles.map((role) =>
        companyApplied<Prisma.PartyRoleUncheckedCreateInput>({ partyId, role }),
      ),
      skipDuplicates: true,
    });
  }
}

/**
 * Everything a `PartySummary` needs beyond the party's own columns.
 *
 * A nested `select` on the organisation rather than the whole row, which is the form the
 * tenancy extension permits through a relation: it names the one column it wants and reaches
 * nothing restricted. Nothing on `Party` is restricted today, and writing it this way means
 * that stays true if something ever is. See docs/tenancy.md.
 */
const SUMMARY = {
  roles: { orderBy: { role: 'asc' } },
  organisation: { select: { name: true } },
} satisfies Prisma.PartyInclude;

/**
 * A party as every read here fetches it. Derived from the schema rather than written out
 * again, so a renamed column is a type error here instead of a field that quietly stops
 * being sent.
 */
type PartyRow = Prisma.PartyGetPayload<{ include: typeof SUMMARY }>;

function summarise(party: PartyRow): PartySummary {
  return {
    id: party.id,
    // The column is text rather than a Postgres enum — see schema.prisma — so the wire type
    // is asserted here, at the one boundary where the two representations meet.
    kind: party.kind as PartyKind,
    name: party.name,
    email: party.email,
    phone: party.phone,
    status: party.status as PartyStatus,
    roles: party.roles.map((row) => row.role),
    organisationId: party.organisationId,
    organisationName: party.organisation?.name ?? null,
    mergedIntoId: party.mergedIntoId,
  };
}

function describeAddress(address: {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  postcode: string;
  country: string;
  isPrimary: boolean;
}) {
  return {
    id: address.id,
    label: address.label,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    postcode: address.postcode,
    country: address.country,
    primary: address.isPrimary,
  };
}

/**
 * Prisma's "no row matched", as a 404 — and the same 404 a party in another company gets,
 * deliberately. Telling a caller that an id is real but not theirs would turn the endpoint
 * into a way of counting somebody else's customers.
 */
function notFound(cause: unknown): never {
  if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2025') {
    throw partyNotFound();
  }
  throw cause;
}

function partyNotFound(): ApiException {
  return new ApiException(
    PARTY_ERROR_CODES.partyNotFound,
    'That party does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

function notAnOrganisation(field: string): FieldException {
  return new FieldException(
    PARTY_ERROR_CODES.notAnOrganisation,
    'People belong to organisations, and only to organisations.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    { [field]: 'Choose an organisation.' },
  );
}

function cannotMerge(message: string): ApiException {
  return new ApiException(PARTY_ERROR_CODES.cannotMerge, message, HttpStatus.CONFLICT);
}

function partyMerged(survivorId: string): ApiException {
  return new ApiException(
    PARTY_ERROR_CODES.partyMerged,
    `That party was merged into another and is no longer the record to edit (${survivorId}).`,
    HttpStatus.CONFLICT,
  );
}

function addressNotFound(): ApiException {
  return new ApiException(
    PARTY_ERROR_CODES.addressNotFound,
    'That address does not exist.',
    HttpStatus.NOT_FOUND,
  );
}
