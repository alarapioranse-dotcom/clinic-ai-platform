import { AcceptInvitationForm } from './AcceptInvitationForm';

/**
 * /invite#<token> — public (ADR-0023; Owner decision I3). The token is in the
 * URL fragment, so the server never receives it; the form reads it in the
 * browser. Rendered dynamically so the response is sent with no-store
 * caching (Owner decision I2); `Referrer-Policy: no-referrer` for this path
 * is set in next.config.ts.
 *
 * Unlike /login, a visitor who already has a session still sees the form:
 * accepting an invitation never touches the current session.
 */
export const dynamic = 'force-dynamic';

export default function InvitePage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-center text-2xl font-bold">إنشاء حسابك</h1>
        <p className="text-muted mt-2 text-center text-sm">
          اختر كلمة مرور لحسابك في لوحة تحكم العيادة.
        </p>
        <AcceptInvitationForm />
      </div>
    </div>
  );
}
