import Link from 'next/link';
import type { InboxProcessing } from '@/types';
import { INITIAL_IMPORT_LIMIT } from '@/lib/providers/sync-policy';

export function InboxProgress({ processing }: { processing?: InboxProcessing }) {
  const accounts =
    processing?.accounts?.filter((account) => account.initialSync && account.importing) ?? [];
  const aiOff = processing?.aiConfigured === false && processing.remaining > 0;
  if (!accounts.length && !aiOff) return null;

  return (
    <div className="inbox-progress" aria-live="polite">
      {accounts.map((account) => {
        const percent = Math.min(100, Math.max(0, (account.imported / INITIAL_IMPORT_LIMIT) * 100));
        return (
          <div className="inbox-progress-account" key={account.id}>
            <span
              className="inbox-progress-ring"
              role="progressbar"
              aria-label={`Initial import from ${account.email}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-valuetext={`${account.imported} emails imported; up to ${INITIAL_IMPORT_LIMIT} initial emails`}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle className="inbox-progress-track" cx="10" cy="10" r="8" />
                <circle
                  className="inbox-progress-value"
                  cx="10"
                  cy="10"
                  r="8"
                  pathLength="100"
                  strokeDasharray="100"
                  strokeDashoffset={100 - percent}
                />
              </svg>
            </span>
            <span className="inbox-progress-count">{`${account.imported} ${account.imported === 1 ? 'email' : 'emails'}`}</span>
            <span className="inbox-progress-divider" aria-hidden="true">
              ·
            </span>
            <span className="inbox-progress-address" title={account.email}>
              {account.email}
            </span>
          </div>
        );
      })}
      {aiOff && (
        <p className="inbox-progress-note">
          Tags are off until you add an AI key.{' '}
          <Link className="text-link" href="/settings?setup=ai">
            Add key in Settings
          </Link>
        </p>
      )}
    </div>
  );
}
