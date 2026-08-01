import { useSession } from '../../../session/SessionProvider';

/**
 * Where a signed-in user lands.
 *
 * It shows who you are and which company you are in, and nothing else, because nothing else
 * exists yet — no products, no locations, no stock. That is the honest state of an
 * unseeded system, and saying so is better than a dashboard of zeroes implying features
 * that are not there.
 */
export function HomePage() {
  const { session } = useSession();
  if (!session) return null;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Welcome, {session.user.name}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          You are signed in to {session.company.name}
          {session.user.isOwner ? ', which you own.' : '.'}
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-medium text-slate-900">Nothing here yet</h2>
        <p className="mt-1 text-sm text-slate-600">
          This company has no data because nothing is created for you. Products, locations
          and stock arrive as later modules, and everything in them will be something
          somebody typed.
        </p>
      </section>
    </div>
  );
}
