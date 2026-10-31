import { notFound } from 'next/navigation';

/**
 * With one root layout per route group there is no top-level layout to
 * render a 404 for a URL that matches no route. This catch-all sends every
 * such URL to src/app/(staff)/not-found.tsx, inside the staff root layout,
 * which is where the 404 page rendered before the split (in the active
 * staff UI locale). Every real route is more specific than this one, so it
 * only matches URLs nothing else does.
 */
export default function UnmatchedRoute(): never {
  notFound();
}
