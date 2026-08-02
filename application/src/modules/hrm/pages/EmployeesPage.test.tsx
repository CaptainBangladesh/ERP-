import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import {
  DEFAULT_CURRENCY,
  ERROR_CODES,
  HRM_PATHS,
  type EmployeeListResponse,
  type EmployeeResponse,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage } from '../../../test/render';
import { EmployeesPage } from './EmployeesPage';

/**
 * The shared conventions, from the other side.
 *
 * The screen under test writes no paging, sorting or filtering code — it holds a `ListQuery`
 * and hands it to the shared table — so what these assert is the platform's behaviour as a
 * user experiences it. Every later module's list screen is this screen with different
 * columns, which is why the assertions are on rendered output and interaction and never on
 * component state.
 *
 * The requests are intercepted at the network boundary and their query strings are captured,
 * because "the table sorted" is only true if the *server* was asked to sort. A table that
 * reordered the twenty-five rows it was holding would pass a weaker test and be wrong.
 */
describe('EmployeesPage', () => {
  const PAGE_SIZE = 25;

  function employee(name: string, salary: string | null = '48000.00'): EmployeeResponse {
    return {
      id: `id-${name}`,
      name,
      confidential: false,
      annualSalary: salary === null ? null : { amount: salary, currency: DEFAULT_CURRENCY },
    };
  }

  /**
   * Answers the employee list, recording every query string it was asked with.
   *
   * `respond` is given the parameters so a test can behave like a real server — returning a
   * different page, or a different order — rather than the same rows whatever was asked.
   */
  function listing(
    respond: (parameters: URLSearchParams) => EmployeeListResponse,
  ): { asked: string[] } {
    const asked: string[] = [];

    server.use(
      http.get(HRM_PATHS.employees, ({ request }) => {
        const url = new URL(request.url);
        asked.push(url.search);
        return HttpResponse.json(respond(url.searchParams));
      }),
    );

    return { asked };
  }

  function page(items: EmployeeResponse[], total = items.length, number = 1) {
    return {
      items,
      page: { number, size: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) },
    };
  }

  /** The data rows, ignoring the header row, as arrays of cell text. */
  function renderedRows(): string[][] {
    const [, ...rows] = screen.getAllByRole('row');
    return rows.map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent ?? ''),
    );
  }

  it('renders the rows the server returned, with money formatted', async () => {
    listing(() => page([employee('Ada Okafor', '48000.10'), employee('Bo Lindqvist')]));

    renderPage(<EmployeesPage />, { path: '/hrm/employees' });

    await screen.findByText('Ada Okafor');
    expect(renderedRows()).toEqual([
      ['Ada Okafor', '£48,000.10', 'No'],
      ['Bo Lindqvist', '£48,000.00', 'No'],
    ]);
  });

  it('shows a dash a screen reader can explain where a salary is withheld', async () => {
    listing(() => page([employee('Ada Okafor', null)]));

    renderPage(<EmployeesPage />, { path: '/hrm/employees' });

    // An empty cell would read as "this person earns nothing", which is a different claim
    // from "you may not see what this person earns".
    expect(await screen.findByText('Not shown')).toBeInTheDocument();
  });

  it('asks the server to sort when a column heading is clicked', async () => {
    const { asked } = listing((parameters) =>
      page(
        parameters.get('sort') === '-name'
          ? [employee('Bo Lindqvist'), employee('Ada Okafor')]
          : [employee('Ada Okafor'), employee('Bo Lindqvist')],
      ),
    );

    const { user } = renderPage(<EmployeesPage />, { path: '/hrm/employees' });
    await screen.findByText('Ada Okafor');

    await user.click(screen.getByRole('button', { name: /name/i }));
    await waitFor(() => expect(asked.at(-1)).toContain('sort=name'));

    // Clicking the column already sorted reverses it rather than sorting it again.
    await user.click(screen.getByRole('button', { name: /name/i }));
    await waitFor(() => expect(asked.at(-1)).toContain('sort=-name'));

    await waitFor(() =>
      expect(renderedRows().map((row) => row[0])).toEqual(['Bo Lindqvist', 'Ada Okafor']),
    );
    expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('searches on the server and goes back to the first page to do it', async () => {
    const { asked } = listing((parameters) =>
      parameters.get('search')
        ? page([employee('Bo Lindqvist')])
        : page([employee('Ada Okafor'), employee('Bo Lindqvist')], 60, 2),
    );

    const { user } = renderPage(<EmployeesPage />, { path: '/hrm/employees' });
    await screen.findByText('Ada Okafor');

    await user.type(screen.getByLabelText(/search by name/i), 'lind');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => expect(asked.at(-1)).toContain('search=lind'));
    // A narrowed list showing page two of the old one would show nothing and look broken.
    expect(asked.at(-1)).not.toContain('page=');
    expect(await screen.findByText('Bo Lindqvist')).toBeInTheDocument();
  });

  it('filters on the server, under the platform`s filter convention', async () => {
    const { asked } = listing((parameters) =>
      parameters.get('filter.createdAt.gte')
        ? page([employee('Bo Lindqvist')])
        : page([employee('Ada Okafor'), employee('Bo Lindqvist')]),
    );

    const { user } = renderPage(<EmployeesPage />, { path: '/hrm/employees' });
    await screen.findByText('Ada Okafor');

    await user.type(screen.getByLabelText(/added since/i), '2026-07-01');

    // `filter.<field>.<operator>`, with the field and the operator the endpoint declared —
    // not a parameter this screen invented.
    await waitFor(() =>
      expect(asked.at(-1)).toContain('filter.createdAt.gte=2026-07-01'),
    );
    expect(await screen.findByText('Bo Lindqvist')).toBeInTheDocument();
    expect(screen.queryByText('Ada Okafor')).not.toBeInTheDocument();
  });

  it('goes back to the empty state, not the no-matches one, when a filter is cleared', async () => {
    const { asked } = listing((parameters) =>
      parameters.get('filter.createdAt.gte') ? page([]) : page([]),
    );

    const { user } = renderPage(<EmployeesPage />, { path: '/hrm/employees' });
    await screen.findByText(/nobody on the payroll yet/i);

    await user.type(screen.getByLabelText(/added since/i), '2026-07-01');
    expect(await screen.findByText(/nothing matches/i)).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/added since/i));

    // A cleared filter left in the query as an empty string would still count as narrowing,
    // and the screen would go on offering "clear your filters" to somebody with none.
    await waitFor(() => expect(asked.at(-1)).toBe(''));
    expect(await screen.findByText(/nobody on the payroll yet/i)).toBeInTheDocument();
  });

  it('pages through the list', async () => {
    const { asked } = listing((parameters) =>
      parameters.get('page') === '2'
        ? page([employee('Zoe Mbeki')], 30, 2)
        : page([employee('Ada Okafor')], 30, 1),
    );

    const { user } = renderPage(<EmployeesPage />, { path: '/hrm/employees' });
    await screen.findByText('Ada Okafor');

    expect(screen.getByText(/page 1 of 2 · 30 rows/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => expect(asked.at(-1)).toContain('page=2'));
    expect(await screen.findByText('Zoe Mbeki')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  describe('the three states', () => {
    it('says it is loading before the answer arrives', async () => {
      server.use(
        http.get(HRM_PATHS.employees, async () => {
          await delay(50);
          return HttpResponse.json(page([employee('Ada Okafor')]));
        }),
      );

      renderPage(<EmployeesPage />, { path: '/hrm/employees' });

      expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
      expect(await screen.findByText('Ada Okafor')).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('guides the first action on a fresh account rather than showing an empty box', async () => {
      listing(() => page([]));

      renderPage(<EmployeesPage />, { path: '/hrm/employees' });

      // Nothing is seeded in this system, so this is the first thing a real user sees.
      expect(await screen.findByText(/nobody on the payroll yet/i)).toBeInTheDocument();
      expect(screen.getByText(/add your first employee/i)).toBeInTheDocument();
    });

    it('tells somebody their search matched nothing rather than that they have nobody', async () => {
      const { asked } = listing((parameters) =>
        parameters.get('search') ? page([]) : page([employee('Ada Okafor')]),
      );

      const { user } = renderPage(<EmployeesPage />, { path: '/hrm/employees' });
      await screen.findByText('Ada Okafor');

      await user.type(screen.getByLabelText(/search by name/i), 'nobody');
      await user.click(screen.getByRole('button', { name: /^search$/i }));

      // "Add your first employee" to somebody with two hundred and a typo is the failure
      // that splitting the empty state in two exists to prevent.
      expect(await screen.findByText(/nothing matches/i)).toBeInTheDocument();
      expect(screen.queryByText(/nobody on the payroll yet/i)).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /clear search and filters/i }));
      await waitFor(() => expect(asked.at(-1)).toBe(''));
      expect(await screen.findByText('Ada Okafor')).toBeInTheDocument();
    });

    it('shows the failure and offers a way to try again', async () => {
      let attempts = 0;
      server.use(
        http.get(HRM_PATHS.employees, () => {
          attempts += 1;
          if (attempts === 1) {
            return HttpResponse.json(
              { code: 'internal_error', message: 'Something went wrong. Please try again.' },
              { status: 500 },
            );
          }
          return HttpResponse.json(page([employee('Ada Okafor')]));
        }),
      );

      const { user } = renderPage(<EmployeesPage />, { path: '/hrm/employees' });

      expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);

      await user.click(screen.getByRole('button', { name: /try again/i }));
      expect(await screen.findByText('Ada Okafor')).toBeInTheDocument();
    });

    it('shows a refused column as a refusal rather than as a broken list', async () => {
      server.use(
        http.get(HRM_PATHS.employees, ({ request }) => {
          if (new URL(request.url).searchParams.get('sort') === 'annualSalary') {
            return HttpResponse.json(
              {
                code: ERROR_CODES.fieldRestricted,
                message: "You do not have access to 'annualSalary'.",
              },
              { status: 403 },
            );
          }
          return HttpResponse.json(page([employee('Ada Okafor', null)]));
        }),
      );

      const { user } = renderPage(<EmployeesPage />, { path: '/hrm/employees' });
      await screen.findByText('Ada Okafor');

      await user.click(screen.getByRole('button', { name: /annual salary/i }));

      // The alternative the platform rejected — silently dropping the clause — would leave
      // the list looking like an answer to a question nobody asked.
      expect(await screen.findByRole('alert')).toHaveTextContent(/annualSalary/);
    });
  });

  describe('adding somebody', () => {
    it('sends the amount as exact text and refreshes the list', async () => {
      let sent: unknown;
      let created = false;

      server.use(
        http.get(HRM_PATHS.employees, () =>
          HttpResponse.json(created ? page([employee('Ada Okafor', '48000.10')]) : page([])),
        ),
        http.post(HRM_PATHS.employees, async ({ request }) => {
          sent = await request.json();
          created = true;
          return HttpResponse.json(employee('Ada Okafor', '48000.10'), { status: 201 });
        }),
      );

      const { user } = renderPage(<EmployeesPage />, { path: '/hrm/employees' });
      await screen.findByText(/nobody on the payroll yet/i);

      await user.type(screen.getByLabelText(/^name$/i), 'Ada Okafor');
      await user.type(screen.getByLabelText(/annual salary/i), '48000.10');
      await user.click(screen.getByRole('button', { name: /add employee/i }));

      // Text, not a number: `48000.10` as a JSON number is a double, and the pennies are
      // gone before the request leaves the browser.
      await waitFor(() =>
        expect(sent).toEqual({ name: 'Ada Okafor', annualSalary: '48000.10' }),
      );
      expect(await screen.findByText('Ada Okafor')).toBeInTheDocument();
    });

    it('refuses a keystroke that could not become an amount', async () => {
      listing(() => page([]));

      const { user } = renderPage(<EmployeesPage />, { path: '/hrm/employees' });
      await screen.findByText(/nobody on the payroll yet/i);

      const salary = screen.getByLabelText(/annual salary/i);
      await user.type(salary, '12a.999');

      // A letter never appears, and neither does a third decimal place — the box cannot
      // hold a value the column could not store.
      expect(salary).toHaveValue('12.99');
    });

    it('puts a server message beside the input it belongs to', async () => {
      listing(() => page([]));
      server.use(
        http.post(HRM_PATHS.employees, () =>
          HttpResponse.json(
            {
              code: ERROR_CODES.validationFailed,
              message: 'Some of the details you entered need attention.',
              fields: { annualSalary: 'A salary cannot be negative.' },
            },
            { status: 422 },
          ),
        ),
      );

      const { user } = renderPage(<EmployeesPage />, { path: '/hrm/employees' });
      await screen.findByText(/nobody on the payroll yet/i);

      await user.type(screen.getByLabelText(/^name$/i), 'Ada Okafor');
      await user.click(screen.getByRole('button', { name: /add employee/i }));

      const salary = await screen.findByLabelText(/annual salary/i);
      expect(salary).toHaveAttribute('aria-invalid', 'true');
      expect(salary).toHaveAccessibleDescription(/cannot be negative/i);
    });
  });
});
