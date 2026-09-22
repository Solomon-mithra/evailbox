# Brand artwork fonts

Inter Regular and SemiBold are used only to generate the static sharing PNG with `npm run generate:brand-assets`. The application itself continues to use the bundled variable WOFF2 font.

The TTF files were downloaded from Google Fonts on 2026-09-21, from the font URLs supplied by [this Inter stylesheet](https://fonts.googleapis.com/css2?family=Inter:wght@400;600). Inter's SIL Open Font License is included at [src/app/fonts/LICENSE.txt](../../src/app/fonts/LICENSE.txt).

The generated artwork is committed in `public/`; no font or image network request is needed to render a shared link.
