# Metadata, discovery and link previews

evailbox's public homepage has a canonical URL, descriptive title, Open Graph and Twitter large-image metadata, plus WebSite/Organization JSON-LD. Shared copy describes Gmail/Outlook organization for personal and work email. It does not advertise account-free live access. The landing example stays explicitly illustrative; the demo workspace remains labeled separately.

`src/lib/site.ts` is the shared name, description and URL source. **Set `NEXT_PUBLIC_APP_URL` to the actual public origin before building and deploying.** Canonical URLs, image URLs, structured data and the sitemap use that origin. The GitHub repository rename does not create a new application domain. The last configured demo hostname remains `jevinbox.vercel.app` until an operator changes the hosting/domain configuration.

## Public files

| URL                              | Purpose                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/og/evailbox.png`               | 1200 × 630 PNG share preview; local Inter typography and forest/lime branding                      |
| `/favicon.ico`, `/icon.svg`      | Browser/bookmark icons                                                                             |
| `/apple-touch-icon.png`          | 180px Apple touch icon                                                                             |
| `/icon-192.png`, `/icon-512.png` | Application icons referenced by the manifest                                                       |
| `/manifest.webmanifest`          | evailbox identity, colors, scope and `/inbox` launch URL                                           |
| `/robots.txt`                    | Allows public crawling; disallows inbox, tags, accounts, settings, auth, unsubscribe and API paths |
| `/sitemap.xml`                   | Contains only the public homepage                                                                  |
| `/llms.txt`                      | Concise public product context and links for AI readers                                            |
| `/index.md`                      | Markdown product overview, account workflow and data handling                                      |

The exact discovery/asset routes bypass session initialization in `src/proxy.ts`. Tests ensure similar-looking paths do not inherit that bypass. Live app pages still require authentication and keep `noindex, nofollow`; they do not inherit the homepage's canonical link. Vercel preview deployments return a disallow-all robots policy, empty sitemap and noindex homepage. Crawler rules are discovery preferences, not access controls.

The homepage's HTTP `Link` header points to its Markdown overview and `llms.txt`. This follows the [llms.txt proposal](https://llmstxt.org/); it is not a promise of AI citations or search ranking. Share-card fields follow the [Open Graph protocol](https://ogp.me/). The [robots guidance](https://developers.google.com/search/docs/crawling-indexing/robots/intro) explains why authentication and noindex remain separate controls.

## Regenerating the artwork

Run `npm run generate:brand-assets` after changing the artwork in `scripts/generate-brand-assets.tsx` or the shared mark in `public/icon.svg`. Generated PNG/ICO files are committed under `public/`; sharing does not depend on runtime image generation or external font requests. Generator font provenance and license are recorded in [scripts/assets/README.md](../../scripts/assets/README.md).

## Verification and release

On 2026-09-21, 121 tests across 14 files, lint and the demo production build passed. The generated share image was visually inspected. Local production HTTP requests using Twitterbot, Slackbot and Facebook crawler user agents verified metadata in the HTML head, canonical/image URLs, JSON-LD and corrected account-aware copy. Discovery files returned 200 with the expected content types; icon signatures and PNG dimensions were checked. App routes retained noindex and had no homepage canonical.

This is local production-build evidence, not a deployed preview or a platform-cache refresh. After deploying the approved revision, verify the live root URL and its image/discovery routes without cookies. Recheck after changing the public domain and request a fresh scrape in the relevant sharing platform if an earlier preview is cached. Existing Vercel deployment blockers and remaining live acceptance are tracked in [STATUS.md](../phases/STATUS.md).
