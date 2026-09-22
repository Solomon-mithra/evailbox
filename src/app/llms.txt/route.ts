import { siteUrl } from '@/lib/site';

export function GET() {
  return new Response(
    `# evailbox

> AI email organization for people managing busy personal and work inboxes.

evailbox connects Gmail and Outlook and matches emails against rules written in ordinary language. Personal and Work spaces keep accounts, rules, and mail separate. Matches include probabilities for review; AI can make mistakes.

The product uses accounts and read-only mailbox connections. An explicitly labeled demo may be available with fictional data; it is not an account-free live email service. Email content and rule criteria are sent to an external AI service for matching. evailbox does not send, archive, or delete mail in the provider account.

Only public product information is described here. Inbox content, accounts, tags, settings, and APIs are not public reference material.

## Product

- [Product overview](${siteUrl('/index.md').href}): Public capabilities, account workflow, and data handling in Markdown.
- [Homepage](${siteUrl().href}): Product introduction and illustrative Personal/Work examples.
`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
