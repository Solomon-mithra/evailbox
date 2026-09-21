import { Inbox, AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
export function EmptyState({
  title = 'All clear for now',
  message = 'New emails will appear here after your next sync.',
  action,
}: {
  title?: string;
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Inbox size={26} />
      </span>
      <h3>{title}</h3>
      <p>{message}</p>
      {action}
    </div>
  );
}
export function ErrorState({ retry, message }: { retry: () => void; message?: string }) {
  return (
    <div className="empty-state" role="alert">
      <AlertCircle size={26} />
      <h3>Something didn’t load</h3>
      <p>{message ?? 'Please try again in a moment.'}</p>
      <Button variant="outline" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
