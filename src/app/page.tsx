import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Mail,
  Check,
  ChevronDown,
  CircleCheck,
  Layers2,
  LockKeyhole,
  ShieldCheck,
  SlidersHorizontal,
  Unplug,
} from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { LandingExample } from '@/components/landing-example';
import { ProviderLogo } from '@/components/provider-logo';
import { isPublicIndexingEnabled, site, siteUrl } from '@/lib/site';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: site.title,
  description: site.description,
  alternates: { canonical: '/' },
  robots: { index: isPublicIndexingEnabled(), follow: isPublicIndexingEnabled() },
};

const faqs = [
  {
    question: 'How is this different from email filters?',
    answer:
      'You describe the kind of email you care about in ordinary language. evailbox uses AI to evaluate each message against that description, with optional keywords and senders for extra context. You can change a rule and check for matches again whenever your priorities change.',
  },
  {
    question: 'Do I need to switch email apps?',
    answer:
      'No. evailbox gives you a focused view of your Gmail and Outlook inboxes. Your mail stays with your provider, and you can reply in evailbox or open the original message there. Personal and work accounts can live in separate evailbox spaces.',
  },
  {
    question: 'What happens to my email data?',
    answer:
      'evailbox stores email summaries (subject, sender and a short preview) to build your workspace; full message bodies are read from your provider when needed and not stored. A limited email sample and your tag rules are sent to an external AI service for matching. Replies and mailbox actions happen only when you request them. You can disconnect an account to remove its synced data, or delete your evailbox account in Settings.',
  },
  {
    question: 'Will it always get every match right?',
    answer:
      'AI can make mistakes. evailbox shows match probabilities and uncertain results so you can review them. You stay in control of your rules and decisions; evailbox sends replies and applies read or archive actions only when you choose them.',
  },
];

export default function HomePage() {
  const entry = '/inbox';
  const cta = 'Open inbox';
  return (
    <div className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: site.name,
            url: siteUrl().href,
            description: site.description,
            inLanguage: 'en',
            publisher: {
              '@type': 'Organization',
              name: site.name,
              url: siteUrl().href,
              logo: siteUrl('/icon-512.png').href,
            },
          }).replace(/</g, '\\u003c'),
        }}
      />
      <div className={styles.heroBackground}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand} aria-label="evailbox home">
            <BrandMark size={38} />
            evailbox
          </Link>
          <nav className={styles.nav} aria-label="Homepage navigation">
            <a className={styles.textLink} href="#how-it-works">
              How it works
            </a>
            <a className={styles.textLink} href="#your-control">
              Your control
            </a>
            <Link className={styles.textLink} href="/pricing">
              Pricing
            </Link>
            <Link className={styles.navCta} href="/inbox">
              Open inbox <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </nav>
        </header>
        <main id="main-content" tabIndex={-1}>
          <section className={styles.hero} aria-labelledby="hero-title">
            <div className={styles.heroCopy}>
              <h1 id="hero-title">
                Important emails.
                <br />
                <span>Out of the noise.</span>
              </h1>
              <p className={styles.intro}>
                Work, life, and everything in between. Connect Gmail and Outlook, describe what
                matters, and let evailbox bring the right emails into focus.
              </p>
              <div className={styles.heroActions}>
                <Link className={styles.primaryCta} href={entry}>
                  {cta}
                  <ArrowRight size={18} aria-hidden="true" />
                </Link>
                <a className={styles.secondaryCta} href="#how-it-works">
                  See how it works <ArrowDownIcon />
                </a>
              </div>
              <p className={styles.ctaNote}>
                <Check size={14} aria-hidden="true" />
                Your email apps stay. The sorting gets simpler.
              </p>
              <div className={styles.compatibility}>
                <span>Works with</span>
                <span className={styles.provider}>
                  <ProviderLogo provider="GMAIL" size={20} /> Gmail
                </span>
                <span className={styles.provider}>
                  <ProviderLogo provider="OUTLOOK" size={20} /> Outlook
                </span>
              </div>
            </div>
            <div className={styles.heroExample}>
              <LandingExample />
            </div>
          </section>
          <div className={styles.benefits} role="group" aria-label="At a glance">
            <p>
              <Layers2 size={18} aria-hidden="true" />
              <span>
                Your accounts, <strong>one clearer view.</strong>
              </span>
            </p>
            <p>
              <SlidersHorizontal size={18} aria-hidden="true" />
              <span>
                Your priorities, <strong>in your own words.</strong>
              </span>
            </p>
            <p>
              <ShieldCheck size={18} aria-hidden="true" />
              <span>
                Your email, <strong>always in your control.</strong>
              </span>
            </p>
          </div>

          <section id="how-it-works" className={styles.howItWorks} aria-labelledby="how-title">
            <div className={styles.sectionHeading}>
              <p className={styles.sectionLabel}>A little setup. A lot more clarity.</p>
              <h2 id="how-title">
                An inbox that gets
                <br />
                what matters to you.
              </h2>
              <p>
                From a client waiting on feedback to a bill that needs paying. You decide what
                deserves a place at the top.
              </p>
            </div>
            <ol className={styles.steps}>
              <li>
                <span className={styles.stepNumber}>01</span>
                <h3>Connect your accounts.</h3>
                <p>
                  Bring Gmail and Outlook into one place. Keep work and personal email in separate
                  spaces.
                </p>
              </li>
              <li>
                <span className={styles.stepNumber}>02</span>
                <h3>Describe your priorities.</h3>
                <p>
                  Create a tag like “Client requests” or “Life admin.” Tell evailbox what belongs
                  there, in your own words.
                </p>
              </li>
              <li>
                <span className={styles.stepNumber}>03</span>
                <h3>Give the right emails your time.</h3>
                <p>
                  Review matches, see their confidence, mark messages handled, and reply when you’re
                  ready.
                </p>
              </li>
            </ol>
          </section>

          <section id="your-control" className={styles.control} aria-labelledby="control-title">
            <div className={styles.controlCopy}>
              <span className={styles.controlIcon}>
                <LockKeyhole size={22} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <p className={styles.sectionLabel}>A better view. You’re still in charge.</p>
              <h2 id="control-title">
                Your inbox.
                <br />
                Never out of your hands.
              </h2>
              <p>evailbox helps you see what deserves attention. You decide what happens next.</p>
            </div>
            <ul className={styles.controlPoints}>
              <li>
                <ShieldCheck size={21} aria-hidden="true" />
                <div>
                  <h3>You decide what happens.</h3>
                  <p>
                    Read, reply, or archive in evailbox. Each provider action follows your explicit
                    choice; nothing sends itself.
                  </p>
                </div>
              </li>
              <li>
                <Mail size={21} aria-hidden="true" />
                <div>
                  <h3>Your next visit is ready.</h3>
                  <p>
                    New mail is prepared in the background, with recent results saved for a faster
                    return to your inbox.
                  </p>
                </div>
              </li>
              <li>
                <Unplug size={21} aria-hidden="true" />
                <div>
                  <h3>Easy to disconnect.</h3>
                  <p>
                    Remove a connected account and its synced data from evailbox in Settings or
                    Accounts.
                  </p>
                </div>
              </li>
            </ul>
          </section>

          <section className={styles.faq} aria-labelledby="faq-title">
            <div>
              <p className={styles.sectionLabel}>Good to know</p>
              <h2 id="faq-title">
                A few things
                <br />
                you might be wondering.
              </h2>
            </div>
            <div className={styles.questions}>
              {faqs.map(({ question, answer }) => (
                <details key={question}>
                  <summary>
                    {question}
                    <ChevronDown size={18} aria-hidden="true" />
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </section>

          <section className={styles.closing} aria-labelledby="closing-title">
            <div>
              <p className={styles.sectionLabel}>Less searching. More living.</p>
              <h2 id="closing-title">Make room for what matters.</h2>
            </div>
            <div className={styles.closingAction}>
              <Link href={entry} className={styles.primaryCta}>
                {cta}
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <span>
                <CircleCheck size={14} aria-hidden="true" />
                Start with your Gmail or Outlook.
              </span>
            </div>
          </section>
        </main>
      </div>
      <footer className={styles.footer}>
        <div>
          <Link href="/" className={styles.brand} aria-label="evailbox home">
            <BrandMark size={32} />
            evailbox
          </Link>
          <p>Email for the life you’re living.</p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#your-control">Your control</a>
          <Link href="/pricing">Pricing</Link>
          <Link href="/inbox">
            Open inbox <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </nav>
        <span className={styles.copyright}>© {new Date().getFullYear()} evailbox</span>
      </footer>
    </div>
  );
}

function ArrowDownIcon() {
  return <ArrowRight size={15} className={styles.downArrow} aria-hidden="true" />;
}
