# Maintained documentation

Updated 2026-09-26. Source code, installed package docs, Prisma schema and committed migrations are authoritative for behavior. Environment values and dashboard state are deployment-specific; never infer activation from a checked-in document alone.

| Document                                          | Purpose                                                   |
| ------------------------------------------------- | --------------------------------------------------------- |
| [Status](STATUS.md)                               | Dated evidence and remaining activation work              |
| [PRD](prd/PRD.md)                                 | Current product scope and acceptance                      |
| [Engineering](engineering/ENGINEERING.md)         | Architecture, durability and privacy boundaries           |
| [Stack](engineering/TECH_STACK.md)                | Dependencies and design decisions                         |
| [Environment](engineering/ENVIRONMENT.md)         | Variable names, optional integrations and secret handling |
| [Runbook](engineering/RUNBOOK.md)                 | Deployment, incidents and burst measurements              |
| [Service setup](engineering/SERVICE_SETUP.md)     | Inngest, Supabase and provider activation                 |
| [Providers](engineering/PROVIDERS.md)             | OAuth, sync and native Jev protocol                       |
| [Mailbox events](engineering/MAILBOX_EVENTS.md)   | Authenticated callbacks, subscriptions and renewal        |
| [Workspaces](engineering/WORKSPACES.md)           | Personal/Work isolation and storage compatibility         |
| [Theme](engineering/THEME.md)                     | Visual rules and explicitly historical visual checks      |
| [Provider logos](engineering/PROVIDER_LOGOS.md)   | Asset provenance                                          |
| [Sharing](engineering/SHARING.md)                 | Public metadata and preview assets                        |
| [Cost measurement](engineering/COST_WORKSHEET.md) | How to establish actual costs without stale rate claims   |

Completed phase checklists, old implementation plans/specs, duplicated large-inbox guidance and superseded cost reports were removed after consolidating current behavior here. Earlier states remain in Git history. Historical screenshots and dated browser observations are not evidence for the latest deployment.
