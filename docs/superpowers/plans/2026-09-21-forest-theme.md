# Forest theme implementation plan

**Goal:** Apply the supplied forest, mint, and lime reference to evailbox with a legible, consistent interface for frequent inbox use.

**Architecture:** Keep the existing components and responsive layout. Replace hardcoded neutral colors with semantic CSS tokens in `src/app/globals.css`; load a local variable Inter font in `src/app/layout.tsx`. Preserve all workspace and email behavior.

**Tech stack:** Next.js 16, React 19, CSS, Radix UI, local Inter variable font.

## Design decisions

Use a forest sidebar with a pale lime active item, white reading surfaces, subtle mint backgrounds, and forest primary buttons. A restrained lime gradient in page headings echoes the reference without sitting behind email text. Cyan identifies low-priority tags, mint medium-priority tags, and lime high-priority tags. Labels, icons, and active underlines accompany color. Errors and destructive controls retain red semantics.

Inter provides a consistent interface across platforms. Use relative font sizes: 12px-equivalent metadata, 14px controls/supporting text, 15px email subjects, 16px reading text, 24px dialog headings, and 32px page headings at the default root size. Use regular body weight, medium controls, semibold headings, 1.5–1.75 line heights, tabular numbers, and restrained heading tracking. Keep mobile form inputs at least 16px and common touch targets at least 44px tall.

## Execution

- [x] Commit the existing workspace changes after unit tests and typecheck.
- [x] Replace grayscale colors and consolidate shared palette tokens in `src/app/globals.css`.
- [x] Set typography, navigation, cards, forms, interaction states, and mobile styles in their existing rules.
- [x] Load `src/app/fonts/InterVariable.woff2` with `next/font/local`; include its OFL license.
- [x] Recolor `public/icon.svg` and match toast typography to the theme.
- [x] Check inbox, tags, accounts, settings, sign-in, dialogs, workspace switching, keyboard focus, and narrow screens in the browser.
- [x] Measure foreground/background contrast, check zoom/text spacing, run lint, typecheck, unit tests, and a production build.
- [x] Review the diff and commit the theme separately.

## Evidence and constraints

The exact palette is a visual design choice, not a claim that specific hues improve productivity. Text/background pairs target at least 4.5:1 contrast. Borders essential to identifying controls and focus indicators target 3:1. Larger touch targets reduce precision demands; layout grouping and a restrained type scale make related information easier to scan.

References: [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [target sizing](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), and [text spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html).

Use the demo workspace for browser checks. No external database changes or deployment are required.
