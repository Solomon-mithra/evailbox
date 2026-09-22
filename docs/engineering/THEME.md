# Forest, mint, and lime theme

The supplied palette is adapted to an inbox used frequently throughout the day. Forest green anchors navigation and primary actions. White email surfaces protect reading contrast. Lime marks the active page and high-priority groups; mint and cyan support medium- and low-priority tags. Priority labels, icons, and tab underlines accompany color. Errors and destructive actions retain red semantics.

The main implementation lives in `src/app/globals.css`. Theme tokens are shared by navigation, inbox rows, settings, dialogs, forms, sign-in, and notifications. `src/app/layout.tsx` loads a local variable Inter font with `next/font/local` and a swap fallback. No runtime font request goes to a third party.

## Typography and interaction choices

| Before                                                      | After                                                                          | Reason                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Platform-dependent system typography and 9–11px detail text | Local Inter; metadata at least 12px; reading text 15–16px                      | Consistent metrics and less reliance on very small text |
| Many unrelated grayscale literals                           | Shared semantic color tokens                                                   | Consistent contrast and state treatments across routes  |
| 28px page headings and compressed secondary text            | 32px desktop / 28px phone headings, 24px dialog headings, 14px supporting text | Clear hierarchy through size, spacing, and weight       |
| Fixed font sizes                                            | Relative font sizes, a 100% root, and wrapping filters                         | Honors user text sizing and avoids clipped controls     |
| Smaller mobile controls                                     | 44px primary/mobile controls and 16px mobile form text                         | Lower pointer precision demands and readable inputs     |
| Gray focus treatment                                        | Forest focus rings on light surfaces; lime rings on the dark sidebar           | Visible keyboard position against both backgrounds      |

Body text uses regular weight and 1.5–1.75 line height. Controls use medium weight; headings use semibold. Dates and counts retain tabular numerals. Heading tracking is slightly tighter; paragraph spacing and grouping separate reading content from controls. Reduced-motion preferences disable motion, including press scaling.

The palette and font family are design choices, not claims that particular colors or fonts cause higher productivity. The measurable constraints are contrast, readable sizing, flexible layout, visible state, and input target size.

## Measured contrast

Ratios use WCAG relative luminance calculations. Bright emerald and blue are palette accents; small white text is not placed on them.

| Pair                                                     |   Ratio |
| -------------------------------------------------------- | ------: |
| Teal reading text / white                                | 13.51:1 |
| Secondary text / canvas                                  |  5.52:1 |
| White / forest primary button                            | 10.14:1 |
| Forest / lime active navigation                          |  8.14:1 |
| Olive / lime high-priority badge                         |  8.06:1 |
| Sidebar secondary text / forest                          |  6.66:1 |
| Secondary text / darkest possible heading gradient color |  4.66:1 |
| Control border / canvas                                  |  3.20:1 |
| Control border / white                                   |  3.37:1 |

References: [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [minimum target sizing](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), and [text spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html).

## Verification — 2026-09-21

- All 82 tests pass; ESLint and the production build (including TypeScript) pass.
- Browser review covers inbox, email detail, tags, tag creation form, accounts, settings, sign-in, workspace selection, and notification styling.
- Automated axe-core 4.13.0 checks found no WCAG A/AA violations in the tested desktop inbox, mobile routes, and tag dialog. Gradient backgrounds require manual checks; the relevant color endpoints were checked separately. This is a scoped check, not a full accessibility certification.
- Layout checked at 320, 390, 768, 1024, and 1440 CSS pixels. The narrow inbox does not cause horizontal document scrolling. Tablet form/search/filter controls compute to 16px.
- Inbox reviewed with 200% root text size and WCAG text-spacing overrides. Filters wrap and the sidebar avoids horizontal scrolling.
- Verified search by keyboard shortcut, actual filtered results, arrow-key tab navigation, dialog Escape/focus restoration, and Personal/Work switching on mobile.
- Independent source review identified a tablet font-size specificity gap, corrected and verified in the browser.

Production previews: [desktop](theme/desktop.png) and [mobile](theme/mobile.png). Both use synthetic demo mail.

Font source: [Inter variable WOFF2](https://github.com/rsms/inter/blob/master/docs/font-files/InterVariable.woff2). The upstream SIL Open Font License is included in `src/app/fonts/LICENSE.txt`.

## Tags page refinement

Each tag card now leads with its name, priority, and actual matching rule. It has one full-card link to its emails, workspace-wide match counts, and a separate visible **Edit rule** button. Deletion stays in the secondary menu, with confirmation and focus returning to the menu button on cancellation. No-match cards say **No matches yet**; unavailable counts are not represented as zero.

The page uses **Check for matches** consistently, and a short contextual hint replaces the large generic advice panel. Keyword previews are bounded, sender counts are visible, and cards collapse to one column when the available content width is too narrow.

Verified full-card navigation, independent edit/menu controls, deletion cancellation and focus restoration, zero matches, long names/rules/keywords, sender counts, and the check-for-matches action. A temporary demo tag used for these checks was removed. Desktop and mobile axe checks reported no violations in the tested states; 320–1440px layouts, 200% text size, and text-spacing overrides did not introduce card or document overflow. All 82 tests, lint, typecheck, and the production build passed.

Updated previews: [tags on desktop](theme/tags-desktop.png) and [tags on mobile](theme/tags-mobile.png).

## evailbox landing page and identity

The public homepage at `/` introduces evailbox to people managing busy personal and work inboxes. The dashboard now lives at `/inbox`. The landing page leads with “Important emails. Out of the noise.” and demonstrates the core workflow: a rule written in ordinary language produces relevant email matches. Visitors can switch the illustrative example between Personal and Work. The primary action is **Open inbox**.

| Before                                                   | After                                                         | Why                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Root opened the application directly                     | Public homepage at `/`, application at `/inbox`               | Explain the product before asking a new visitor to use it                                     |
| Generic inbox preview                                    | Interactive rule-to-matches example                           | Show what makes the product useful across work and personal mail                              |
| Previous product name and layered icon                   | Lowercase evailbox wordmark and shared envelope mark          | Consistent identity across navigation, sign-in, metadata, favicon, notifications, and digests |
| Changing a tab could animate through low-contrast colors | Immediate example selection with visible keyboard focus       | Preserve contrast during keyboard and pointer changes                                         |
| Enlarged text could overflow the narrow example          | Wrapping selectors, flexible text, and relative avatar sizing | Preserve content and controls at 200% text size                                               |

The page uses the existing Inter font and forest/lime tokens, 16–17px introduction text, 12px minimum example metadata, visible selection and focus, and 44–52px primary targets. Supporting text against the strongest hero gradient endpoint measures 4.99:1, the secondary headline 5.16:1 against the base background, and primary button text 10.14:1. Company-style presentation uses actual product capabilities, explicit example labeling, and practical mailbox/AI explanations, without invented customer counts, endorsements, or performance claims.

Navigation, authentication callbacks, reset destinations, digest links, push notifications, and the service-worker fallback point to `/inbox`. Previously delivered `/?email=…&workspace=…` links redirect with their parameters preserved. In live mode, `/` bypasses authentication; `/inbox` and existing application routes remain protected. The homepage is indexable while application metadata retains noindex.

Browser storage moves to evailbox keys with a compatibility reader for the previous keys. Existing rules, workspace choice, and demo edits are preserved. Only known generated demo-email sentences and classification explanations receive a copy update; user-written rules stay unchanged. Technical Jev model identifiers and historical repository/deployment URLs retain their actual values.

Validation: 100 tests, lint, production build with TypeScript, and production HTTP checks passed. Checks cover public/private routing, refreshed auth cookies, delivered links, legacy redirects, demo migration, blocked storage writes, and preservation of custom rules. Browser review exercised Personal/Work example switching by pointer and keyboard, 320–1440px layouts, 200% text, and text-spacing overrides. The checked mobile landing state had no automated axe A/AA violations; gradient contrast was checked separately. Browser control was returned to the user before the final copy-only change, so final copy and routes were verified against production HTML rather than through a further browser pass.
