import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { plans } from '@/lib/plans';
import { isPublicIndexingEnabled } from '@/lib/site';
import styles from './pricing.module.css';

export const metadata: Metadata = {
  title: 'Plans & pricing — evailbox',
  description:
    'Starter at $14/month or Heavy at $24/month. Organize, read and reply across your inboxes. No payment required during preview.',
  alternates: { canonical: '/pricing' },
  robots: { index: isPublicIndexingEnabled(), follow: isPublicIndexingEnabled() },
};
const features = [
  'Gmail and Outlook in one place',
  'Separate Personal and Work spaces',
  'AI tags you describe in your own words',
  'Reply, reply-all and saved drafts',
  'Read, archive and organize your mail',
  'Background syncing and a cached inbox',
];
export default function PricingPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          <BrandMark size={34} />
          evailbox
        </Link>
        <nav aria-label="Pricing navigation">
          <Link href="/">How it works</Link>
          <Link href="/inbox">
            Open inbox <ArrowRight size={15} />
          </Link>
        </nav>
      </header>
      <main id="main-content" className={styles.main} tabIndex={-1}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>A little less inbox. A little more day.</span>
          <h1>
            One place for the mail
            <br />
            that matters.
          </h1>
          <p>
            Pick the plan that fits your inbox. Both include the complete reading, organizing and
            replying experience.
          </p>
        </div>
        <div className={styles.preview} role="note">
          <strong>You can try everything during preview.</strong>
          <span>
            No payment required. Monthly allowances are not enforced yet. We’ll ask you to opt in
            before billing begins.
          </span>
        </div>
        <div className={styles.plans}>
          {Object.values(plans).map((plan) => (
            <section
              key={plan.id}
              className={`${styles.card} ${plan.id === 'HEAVY' ? styles.heavy : ''}`}
              aria-labelledby={`plan-${plan.id}`}
            >
              <div className={styles.cardHeading}>
                <h2 id={`plan-${plan.id}`}>{plan.name}</h2>
                {plan.id === 'HEAVY' && <span>For busy inboxes</span>}
              </div>
              <p>{plan.description}</p>
              <div className={styles.price}>
                <strong>${plan.price}</strong>
                <span>per person / month</span>
              </div>
              <p className={styles.allowance}>
                <strong>{plan.monthlyEmails.toLocaleString('en-US')} emails</strong> processed each
                month across your accounts
              </p>
              <Link href={`/settings?plan=${plan.id}`} className={styles.cta}>
                Explore {plan.name}
                <ArrowRight size={17} />
              </Link>
              <ul>
                {features.map((feature) => (
                  <li key={feature}>
                    <Check size={16} aria-hidden="true" />
                    {feature}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <section className={styles.faq} aria-labelledby="pricing-questions">
          <h2 id="pricing-questions">A few things to know</h2>
          <details>
            <summary>What counts toward the monthly allowance?</summary>
            <p>
              An email counts once when it is first classified, across Personal and Work. Opening it
              again or replying does not consume another email. An initial import may count as those
              emails are first processed. Allowances are not enforced during preview.
            </p>
          </details>
          <details>
            <summary>Will I be charged now?</summary>
            <p>
              No. There is no checkout or automatic charge during preview. Choosing a plan saves
              your preference; we’ll ask you to opt in before any paid subscription begins.
            </p>
          </details>
          <details>
            <summary>Can I keep using Gmail or Outlook?</summary>
            <p>
              Yes. Your mail stays with your provider. You can use evailbox alongside it and
              disconnect a mailbox at any time in Accounts.
            </p>
          </details>
          <details>
            <summary>What happens if I go over the allowance?</summary>
            <p>
              For now, nothing is blocked and there are no overage charges. Before paid plans
              launch, we’ll clearly explain the options. Ordinary reading and replying will remain
              available.
            </p>
          </details>
        </section>
        <footer className={styles.footer}>
          <Link href="/">evailbox</Link>
          <span>Your inbox, in order.</span>
          <Link href="/settings">Manage account</Link>
        </footer>
      </main>
    </div>
  );
}
