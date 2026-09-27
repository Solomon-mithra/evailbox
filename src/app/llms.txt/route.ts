import { siteUrl } from '@/lib/site';

export function GET() {
  return new Response(
    `# evailbox

> AI email organization for people managing busy personal and work inboxes.

evailbox connects Gmail and Outlook and matches emails against rules written in ordinary language. Personal and Work spaces keep accounts, rules, and mail separate. Matches include probabilities for review; AI can make mistakes.

The product uses accounts and authorized mailbox connections. An explicitly labeled demo may be available with fictional data; it is not an account-free live email service. Email content and rule criteria are sent to an external AI service for matching. evailbox sends replies and marks messages read or archived in the provider account only when the user explicitly chooses that action; it does not delete mail or send anything automatically.

Plans: Starter at $4.99 USD/month (10,000 newly processed emails) and Heavy at $7.99 USD/month (20,000), across all connected accounts. A no-card free trial starts explicitly in Settings and lasts 72 hours with 10,000 emails total, once per account. It ends without a charge. Subscribing separately ends the trial and starts a paid monthly plan immediately, with no additional trial. AI processing pauses at the trial expiry or email allowance; reading and replying remain available. There are no overage charges.

Only public product information is described here. Inbox content, accounts, tags, settings, and APIs are not public reference material.

## Product

- [Product overview](${siteUrl('/index.md').href}): Public capabilities, account workflow, and data handling in Markdown.
- [Homepage](${siteUrl().href}): Product introduction and illustrative Personal/Work examples.
`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
