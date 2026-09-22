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
