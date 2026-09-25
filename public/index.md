# evailbox

> Important emails. Out of the noise.

evailbox helps people managing busy personal and work inboxes find messages that match their priorities across Gmail and Outlook.

## How it works

1. Sign in to your evailbox account and connect a Gmail or Outlook mailbox.
2. Choose Personal or Work and describe the email you care about in a tag rule. Priority, keyword hints, and sender hints help express your criteria.
3. Review matching emails with probabilities, mark messages handled, and reply, reply all, mark read or archive from evailbox. You can also open the original message in your email provider.

The public homepage includes illustrative examples. Deployments running in demo mode use clearly labeled fictional emails and local browser state; they do not connect to live mail services. The product's live experience requires an account and authorized mailbox connections.

## Your control

- evailbox sends replies and marks messages read or archived in Gmail or Outlook only when you choose that action. Replies are saved as drafts until you press Send. evailbox does not delete mail or send anything automatically.
- Personal and Work spaces keep accounts, email, and rules separate.
- Rules can be edited or deleted. AI can make mistakes; probabilities and uncertain results help you review decisions.
- Disconnecting a mailbox removes its synced application data. Account deletion is available in Settings.

## Email data and AI

evailbox stores email summaries (subject, sender, a short preview and dates) for the workspace. Full message bodies are read from the provider when you open a message or when it is classified, and are not stored. A bounded email sample and tag criteria are sent to an external AI service for matching, so email content leaves the provider for matching.

## Plans

Starter is $14/month for 5,000 newly processed emails; Heavy is $24/month for 10,000. During the preview, billing is off and allowances are not enforced. See [pricing](/pricing).

This page describes the product, not a guarantee of AI accuracy or a record of completed live-integration testing. Private inbox pages and APIs are not public product documentation.

[Visit evailbox](/)
