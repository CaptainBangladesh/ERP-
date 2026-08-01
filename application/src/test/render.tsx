import { render, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { AppProviders, createQueryClient } from '../providers/AppProviders';

/**
 * Renders a page inside the same providers the real application uses, with a fresh query
 * cache per test so no state leaks between cases.
 *
 * Every later module's screens are tested through this. Assert on rendered output and user
 * interaction — never on hooks or component state.
 */
export function renderPage(ui: ReactElement): RenderResult & { user: ReturnType<typeof userEvent.setup> } {
  const client = createQueryClient();
  const user = userEvent.setup();

  const result = render(<AppProviders client={client}>{ui}</AppProviders>);

  return { ...result, user };
}
