import { ConversationsList } from './ConversationsList';

export default function ConversationsPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="font-display text-2xl font-bold">المحادثات</h1>
      <p className="text-muted mt-2 text-sm">قائمة محادثات عيادتك.</p>
      <ConversationsList />
    </div>
  );
}
