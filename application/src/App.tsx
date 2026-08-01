import { AppProviders } from './providers/AppProviders';
import { AppRoutes } from './app/AppRoutes';

/**
 * The application: providers, then whatever screen the modules declared for this path.
 *
 * There is no route table here and there will not be one. Modules declare their own
 * screens; the registry finds them.
 */
export function App() {
  return (
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  );
}
