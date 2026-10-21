import { environmentNotice } from '@/config/environment-notice';
import { env } from '@/lib/env';

/**
 * A full-width strip above every page outside production. Renders nothing in
 * production (see `environmentNotice`).
 */
export function EnvironmentNotice() {
  const notice = environmentNotice(env.appEnv);
  if (notice === null) return null;

  return (
    <div role="note" className="bg-marker text-ink px-6 py-2 text-center text-sm font-medium">
      {notice}
    </div>
  );
}
