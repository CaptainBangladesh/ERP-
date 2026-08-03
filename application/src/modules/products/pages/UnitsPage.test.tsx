import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  ERROR_CODES,
  UNIT_PATHS,
  type UnitGroupsResponse,
  type UnitListResponse,
  type UnitSummary,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage } from '../../../test/render';
import { UnitsPage } from './UnitsPage';

/**
 * Units of measure from the user's side.
 *
 * The screen a company reaches before it can have a catalogue at all, because nothing here is
 * seeded. Its empty state is therefore the first screen of a real first session, and it says
 * so rather than showing an empty box.
 *
 * The ratio field is the piece of behaviour worth testing rather than describing: it only
 * appears once a group is chosen, because a ratio says how many of the *group's* base unit one
 * of these is and a unit belonging to no group has nothing to be a ratio of. The server
 * refuses that combination; the form declines to offer it.
 */
describe('UnitsPage', () => {
  const PAGE_SIZE = 25;

  function unit(code: string, overrides: Partial<UnitSummary> = {}): UnitSummary {
    return {
      id: `unit-${code.toLowerCase()}`,
      code,
      name: `${code} in full`,
      status: 'active',
      groupId: null,
      groupName: null,
      ratio: '1',
      ...overrides,
    };
  }

  function units(items: UnitSummary[]): UnitListResponse {
    return {
      items,
      page: { number: 1, size: PAGE_SIZE, total: items.length, pages: Math.ceil(items.length / PAGE_SIZE) },
    };
  }

  function listing(items: UnitSummary[], groups: UnitGroupsResponse['groups'] = []): void {
    server.use(
      http.get(UNIT_PATHS.groups, () => HttpResponse.json({ groups } satisfies UnitGroupsResponse)),
      http.get(UNIT_PATHS.units, () => HttpResponse.json(units(items))),
    );
  }

  describe('the list', () => {
    it('shows what this business measures things in, and how they convert', async () => {
      const gram = unit('g', { groupId: 'group-weight', groupName: 'Weight', ratio: '1' });
      const kilogram = unit('kg', { groupId: 'group-weight', groupName: 'Weight', ratio: '1000' });

      listing(
        [gram, kilogram, unit('each')],
        [{ id: 'group-weight', name: 'Weight', units: [gram, kilogram] }],
      );

      renderPage(<UnitsPage />, { path: '/units' });

      await screen.findByRole('cell', { name: 'g in full' });
      const rows = screen.getAllByRole('row');
      expect(
        rows.slice(1).map((row) =>
          within(row)
            .getAllByRole('cell')
            .slice(0, 3)
            .map((cell) => cell.textContent),
        ),
      ).toEqual([
        ['g', 'g in full', 'Weight · ×1'],
        ['kg', 'kg in full', 'Weight · ×1000'],
        // A unit in no group converts to nothing, which is a perfectly ordinary state — an
        // "each" is not a failure to fill something in.
        ['each', 'each in full', '—'],
      ]);
    });

    it('states the group relationship in words, because that is what a reader needs', async () => {
      const gram = unit('g', { groupId: 'group-weight', groupName: 'Weight', ratio: '1' });
      const kilogram = unit('kg', { groupId: 'group-weight', groupName: 'Weight', ratio: '1000' });

      listing([gram, kilogram], [{ id: 'group-weight', name: 'Weight', units: [gram, kilogram] }]);

      renderPage(<UnitsPage />, { path: '/units' });

      const groups = within(await screen.findByRole('region', { name: /groups/i }));
      // One sentence rather than four columns: what a reader needs here is the relationship —
      // a gram is one, a kilogram is a thousand of them — which a table states less clearly.
      expect((await groups.findByRole('listitem')).textContent).toBe('Weight: g (×1), kg (×1000)');
    });

    it('deactivates a unit from its row, and says why when the server refuses', async () => {
      let sent: unknown;
      listing([unit('kg')]);
      server.use(
        http.patch(UNIT_PATHS.unit('unit-kg'), async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(
            {
              code: 'unit_in_use',
              message: '3 products are measured in this unit.',
            },
            { status: 409 },
          );
        }),
      );

      const { user } = renderPage(<UnitsPage />, { path: '/units' });

      await user.click(await screen.findByRole('button', { name: /deactivate kg/i }));

      expect(sent).toEqual({ status: 'inactive' });
      // The refusal is a whole-screen message rather than one beside the control, because the
      // control is in a table row and a message under one row is a message somebody scrolls
      // past.
      expect(await screen.findByText(/3 products are measured/i)).toBeInTheDocument();
    });
  });

  describe('the states a fresh account passes through', () => {
    it('says there are no units yet, rather than showing an empty box', async () => {
      listing([]);

      renderPage(<UnitsPage />, { path: '/units' });

      // Nothing is seeded in this system, so this is the first thing a real user sees on the
      // screen they have to visit first.
      expect(await screen.findByText(/no units yet/i)).toBeInTheDocument();
      // With examples, because "unit of measure" is a phrase somebody can read twice and still
      // not know what is wanted of them.
      expect(screen.getByText(/add the first one using the form above/i)).toHaveTextContent(
        /each/i,
      );
    });

    it('says a company with no groups is not missing anything', async () => {
      listing([unit('each')]);

      renderPage(<UnitsPage />, { path: '/units' });

      expect(await screen.findByText(/no groups yet/i)).toBeInTheDocument();
      expect(screen.getByText(/convert to nothing/i)).toBeInTheDocument();
    });
  });

  describe('adding a unit', () => {
    it('sends the code exactly as it was typed, because kWh is not KWH', async () => {
      let sent: unknown;
      listing([]);
      server.use(
        http.post(UNIT_PATHS.units, async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(unit('kWh'), { status: 201 });
        }),
      );

      const { user } = renderPage(<UnitsPage />, { path: '/units' });
      await screen.findByText(/no units yet/i);

      await user.type(screen.getByLabelText(/^code$/i), 'kWh');
      await user.type(screen.getByLabelText(/^name$/i), 'Kilowatt hour');
      await user.click(screen.getByRole('button', { name: /add unit/i }));

      await waitFor(() => expect(sent).toEqual({ code: 'kWh', name: 'Kilowatt hour' }));
    });

    it('offers a ratio only once a group is chosen, and sends both', async () => {
      let sent: unknown;
      listing([], [{ id: 'group-weight', name: 'Weight', units: [] }]);
      server.use(
        http.post(UNIT_PATHS.units, async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(unit('kg'), { status: 201 });
        }),
      );

      const { user } = renderPage(<UnitsPage />, { path: '/units' });
      await screen.findByRole('button', { name: /add unit/i });

      // A ratio without a group is a number about nothing, so the box is not there to fill in.
      expect(screen.queryByLabelText(/how many of the base unit/i)).toBeNull();

      await user.type(screen.getByLabelText(/^code$/i), 'kg');
      await user.type(screen.getByLabelText(/^name$/i), 'Kilogram');
      await user.selectOptions(screen.getByLabelText(/^group$/i), 'group-weight');
      await user.type(await screen.findByLabelText(/how many of the base unit/i), '1000');

      await user.click(screen.getByRole('button', { name: /add unit/i }));

      // Decimal text rather than a JSON number: a ratio is a definition every quantity is
      // measured against, and a double would round it before anybody used it.
      await waitFor(() =>
        expect(sent).toEqual({
          code: 'kg',
          name: 'Kilogram',
          groupId: 'group-weight',
          ratio: '1000',
        }),
      );
    });

    it('puts a server message beside the input it belongs to', async () => {
      listing([]);
      server.use(
        http.post(UNIT_PATHS.units, () =>
          HttpResponse.json(
            {
              code: ERROR_CODES.validationFailed,
              message: 'Some of the details you entered need attention.',
              fields: { code: 'Use letters, numbers, and % . / - — such as “kg”.' },
            },
            { status: 422 },
          ),
        ),
      );

      const { user } = renderPage(<UnitsPage />, { path: '/units' });
      await screen.findByText(/no units yet/i);

      await user.type(screen.getByLabelText(/^code$/i), '!!');
      await user.click(screen.getByRole('button', { name: /add unit/i }));

      const code = await screen.findByLabelText(/^code$/i);
      expect(code).toHaveAttribute('aria-invalid', 'true');
      expect(code).toHaveAccessibleDescription(/such as/i);
    });
  });

  describe('adding a group', () => {
    it('creates one and shows it, so a unit can then be put in it', async () => {
      let sent: unknown;
      let created = false;
      const weight = { id: 'group-weight', name: 'Weight', units: [] };

      server.use(
        http.get(UNIT_PATHS.units, () => HttpResponse.json(units([]))),
        http.get(UNIT_PATHS.groups, () =>
          HttpResponse.json({ groups: created ? [weight] : [] } satisfies UnitGroupsResponse),
        ),
        http.post(UNIT_PATHS.groups, async ({ request }) => {
          sent = await request.json();
          created = true;
          return HttpResponse.json({ groups: [weight] } satisfies UnitGroupsResponse, {
            status: 201,
          });
        }),
      );

      const { user } = renderPage(<UnitsPage />, { path: '/units' });
      await screen.findByText(/no groups yet/i);

      await user.type(screen.getByLabelText(/add a group/i), 'Weight');
      await user.click(screen.getByRole('button', { name: /add group/i }));

      await waitFor(() => expect(sent).toEqual({ name: 'Weight' }));
      // And the unit form now offers it, which is the whole point of creating one.
      expect(await screen.findByLabelText(/^group$/i)).toBeInTheDocument();
    });
  });
});
