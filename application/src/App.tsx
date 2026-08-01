import { AppProviders } from './providers/AppProviders';
import { SkeletonPage } from './pages/SkeletonPage';

/**
 * Ticket 02 introduces sign-in and real navigation; ticket 07 filters that navigation by
 * permission and tier. For now there is one page.
 */
export function App() {
  return (
    <AppProviders>
      <SkeletonPage />
    </AppProviders>
  );
}
