# evailbox X website-card generation prompts

## Variant 02 revision 4: regular-weight brand label

Input: `evailbox-x-card-02-too-much-to-ask-v3-800x418.png`.

Output: `evailbox-x-card-02-too-much-to-ask-v4-800x418.png`.

Edited with built-in OpenAI image generation and exported at exactly 800 × 418 using Sharp with `fit: 'contain'`. Changes the evailbox label beneath the right icon to regular weight.

```text
Use case: precise-object-edit, text typography refinement.
Edit the supplied evailbox landscape advertisement with exactly ONE tiny change: change the lowercase word "evailbox" directly beneath the central green envelope icon in the lower-right icon row from bold to REGULAR font weight, roughly weight 400. The label should have visibly lighter, slimmer strokes than in the input, retaining a clean sans-serif appearance. Keep the same dark forest-green color, lowercase spelling, approximate font size, baseline, centered alignment directly beneath its icon, and spacing. Do not use a bold or semibold font for this small label.
Preserve EVERYTHING ELSE identically or as closely as possible: the huge bold question on the left, the bold "Nope." sticker lettering and pale-lime paper shape, the tagline "Your inbox. Your rules.", the Gmail/evailbox/Outlook icons, all positions, sizes, shadows, colors and warm ivory background. Do not thin any other text. Add nothing. Remove nothing. Keep the canvas in the exact 800:418 landscape proportion. Return the finished ad only, ideally rendered at 1600 x 836 before export.
```

## Variant 02 revision 3: brand name beneath the right icon

Input: `evailbox-x-card-02-too-much-to-ask-v2-800x418.png`.

Output: `evailbox-x-card-02-too-much-to-ask-v3-800x418.png`.

Edited with built-in OpenAI image generation and exported at exactly 800 × 418 using Sharp with `fit: 'contain'`. Adds the evailbox name below its green icon on the right, retaining the large question and the rest of the composition.

```text
Use case: precise-object-edit / ads-marketing.
Edit the supplied landscape evailbox ad with ONE SMALL CHANGE only:
Add the lowercase brand name "evailbox" centered immediately beneath the central green evailbox envelope icon in the three-icon row on the RIGHT. Spell it exactly e-v-a-i-l-b-o-x. Use a clean medium-bold geometric sans-serif matching the existing campaign, dark forest green, sized for legibility in the final 800 x 418 export (about 20–22 pixels high there). Place the baseline safely above the lower edge, with about 20 pixels of bottom margin at 800 x 418, and leave a small clear gap below the icon. The name should be about the icon's width or modestly wider. It labels only the central green icon, not the whole trio. There is already blank space below that icon; use it.
PRESERVE EVERYTHING ELSE as closely as possible: the large question on the left with the exact three line breaks "Is that" / "too much" / "to ask?", its size and positioning, the warm ivory background, the pale-lime angled "Nope." sticker with peeled corner, the "Your inbox. Your rules." line, and the Gmail, green evailbox, and Outlook icons. Keep their sizes, positions, colors, lighting, textures, and shadows. Do not add a logo or wordmark on the left. Do not add labels beneath Gmail or Outlook. Do not add any other elements or text.
Preserve the same 800:418 landscape aspect ratio, ideally 1600 x 836 render. Return the finished ad image only.
```

## Variant 02 revision: larger question, no left brand lockup

Input: `evailbox-x-card-02-too-much-to-ask-800x418.png`.

Output: `evailbox-x-card-02-too-much-to-ask-v2-800x418.png`.

Edited with built-in OpenAI image generation, then exported at exactly 800 × 418 using Sharp with `fit: 'contain'`. The left logo and wordmark are removed, the question is enlarged, and the right-side sticker, tagline, and three icons remain.

```text
Use case: precise-object-edit / ads-marketing.
Edit this supplied evailbox X website-card image. Preserve the wide landscape 800:418 aspect ratio.
Make ONLY these changes on the LEFT half:
1. Completely remove the bottom-left brand lockup, both the small green envelope icon AND the "evailbox" wordmark. Restore the same warm ivory background in that area.
2. Enlarge and reflow the question to use the left column's full height, including the space freed by removing the lockup. Use the same bold dark forest-green sans-serif typography, with the exact text "Is that too much to ask?" arranged into three balanced lines:
"Is that"
"too much"
"to ask?"
Make the letters substantially larger than in the reference, visually filling the left half from near the top to near the bottom. Keep sensible even line spacing and roughly 6% outer padding. Keep all words fully visible, no crop or overlap. The question should feel bold, generous and dominant.
PRESERVE the entire RIGHT half as closely as possible: the pale-lime tilted "Nope." sticker, peeled corner and shadow, the supporting line "Your inbox. Your rules.", and all THREE icons in the row underneath (Gmail, the central green evailbox envelope, Outlook). In particular, keep the central evailbox icon in the right-hand row; only the left brand lockup is being removed.
Keep the same background, colors, light, typography style, landscape composition, and right-side object positions. Do not add any new text, symbols, logos or UI. Return the finished ad image, not a screenshot or mockup. Target canvas is 1600 x 836 pixels or exactly the same 800:418 proportion.
```

## Original landscape generation

The user-provided X preview displayed a landscape website card and cropped the square source artwork. These are the prompts used with the built-in OpenAI image generation tool to recompose the three concepts for that placement.

Target upload: 800 × 418 PNG, approximately 1.91:1, under 5 MB. Source: [X Image Ads with Website Card specifications](https://business.x.com/en/help/campaign-setup/creative-ad-specifications), checked 2026-09-26.

Each call used the corresponding original square image in this directory as its sole edit reference. After generation, Sharp resampled the full frame to exactly 800 × 418 using `fit: 'contain'`, without cropping. Temporary 394 × 206 previews were used for local visual inspection. These are asset checks, not a test of an uploaded X campaign.

## 01-your-inbox-your-rules

Input: `evailbox-x-ad-01-your-inbox-your-rules.png`

```text
Use case: ads-marketing, layout reformatting of an existing advertisement.
Edit the supplied square evailbox ad into a genuinely HORIZONTAL LANDSCAPE website-card image for X/Twitter. Target canvas proportion is 800:418, approximately 1.914:1 (nearly twice as wide as tall). Render at 1600 x 836 pixels if possible. The existing square image is an edit target / identity and style reference, NOT the final layout.
Preserve the original campaign's warm ivory lightly textured background, dark forest-green #044b39 and lime #cbf39d palette, bold editorial sans-serif type, subtle tactile shadows, and recognizable evailbox, Gmail and Outlook marks. Recompose elements thoughtfully to suit the wide canvas. Do not simply crop the original or place a square poster within a wide frame. No black bars, no duplicated filler, no text clipped at edges, no phone/browser/X interface.
All text and every icon must sit comfortably inside an 8% outer safe margin. Design must remain legible when reduced to a roughly 394 x 206 pixel mobile card. Prefer fewer, bigger elements rather than tiny supporting text. Keep the typography crisp and the evailbox wordmark spelled e-v-a-i-l-b-o-x. This is an evailbox ad, with no OpenAI wordmark or implied endorsement.
Landscape composition 01:
LEFT 48%: small neat evailbox brand lockup near top; below it, oversized left-aligned headline over two lines, EXACT text:
"Your inbox."
"Your rules."
At lower left, small but readable single supporting line "Tell evailbox what matters."
RIGHT 48%: arrange the three substantial sculptural icon tiles as a compact beautiful cluster: Gmail slightly up and left, the larger forest-green evailbox tile forward and center, Outlook slightly up and right. The icons must not touch the outer edge. Retain soft ivory bases behind Gmail and Outlook, and subtle thin connecting curves toward evailbox.
Under this group, use only three short lime tags in a clean row: "Clients", "Life admin", "Read later". Keep these readable at the final 800px width. Their subtlety should not compete with the headline.
The visual weight is balanced horizontally, with generous negative space and no overlap between text and illustrations.
```

## 02-too-much-to-ask

Input: `evailbox-x-ad-02-too-much-to-ask.png`

```text
Use case: ads-marketing, layout reformatting of an existing advertisement.
Edit the supplied square evailbox ad into a genuinely HORIZONTAL LANDSCAPE website-card image for X/Twitter. Target canvas proportion is 800:418, approximately 1.914:1 (nearly twice as wide as tall). Render at 1600 x 836 pixels if possible. The existing square image is an edit target / identity and style reference, NOT the final layout.
Preserve the original campaign's warm ivory lightly textured background, dark forest-green #044b39 and lime #cbf39d palette, bold editorial sans-serif type, subtle tactile shadows, and recognizable evailbox, Gmail and Outlook marks. Recompose elements thoughtfully to suit the wide canvas. Do not simply crop the original or place a square poster within a wide frame. No black bars, no duplicated filler, no text clipped at edges, no phone/browser/X interface.
All text and every icon must sit comfortably inside an 8% outer safe margin. Design must remain legible when reduced to a roughly 394 x 206 pixel mobile card. Prefer fewer, bigger elements rather than tiny supporting text. Keep the typography crisp and the evailbox wordmark spelled e-v-a-i-l-b-o-x. This is an evailbox ad, with no OpenAI wordmark or implied endorsement.
Landscape composition 02, preserve the witty "Nope." paper-sticker idea:
LEFT 48%: set the question in large, strongly weighted forest-green typography over three neat lines:
"Is that too"
"much to"
"ask?"
At lower left, the evailbox icon and the wordmark "evailbox", in a simple compact lockup.
RIGHT 45%: a large pale-lime paper sticker angled about -5 degrees, with the bold word "Nope." and a lightly peeled corner. This sticker is the hero; its entire shadow and corners must fit inside the safe area. Below it, a single readable line "Your inbox. Your rules." Then a compact row of the three supplied icons as shown in the reference: Gmail, the larger evailbox icon, and Outlook. Each icon must be fully visible and crisp.
Keep the question and sticker large enough to read instantly at phone-card size. No other copy. Avoid filling the full height with stacked text; honor the landscape format and outer margins.
```

## 03-chaos-meet-your-rules

Input: `evailbox-x-ad-03-chaos-meet-your-rules.png`

```text
Use case: ads-marketing, layout reformatting of an existing advertisement.
Edit the supplied square evailbox ad into a genuinely HORIZONTAL LANDSCAPE website-card image for X/Twitter. Target canvas proportion is 800:418, approximately 1.914:1 (nearly twice as wide as tall). Render at 1600 x 836 pixels if possible. The existing square image is an edit target / identity and style reference, NOT the final layout.
Preserve the original campaign's warm ivory lightly textured background, dark forest-green #044b39 and lime #cbf39d palette, bold editorial sans-serif type, subtle tactile shadows, and recognizable evailbox, Gmail and Outlook marks. Recompose elements thoughtfully to suit the wide canvas. Do not simply crop the original or place a square poster within a wide frame. No black bars, no duplicated filler, no text clipped at edges, no phone/browser/X interface.
All text and every icon must sit comfortably inside an 8% outer safe margin. Design must remain legible when reduced to a roughly 394 x 206 pixel mobile card. Prefer fewer, bigger elements rather than tiny supporting text. Keep the typography crisp and the evailbox wordmark spelled e-v-a-i-l-b-o-x. This is an evailbox ad, with no OpenAI wordmark or implied endorsement.
Landscape composition 03:
LEFT 42%: small evailbox brand lockup near the top left, then a large left-aligned headline over three lines:
"Chaos,"
"meet your"
"rules."
Below it, small Gmail and Outlook icons. Omit the long footer from the square original for clarity.
RIGHT 52%: recompose the tactile paper-envelope scene entirely inside this half of the canvas. A small messy cluster of cream envelope cards flows toward one large dark-green evailbox tile and then three neat envelope stacks, with delicate green arrows to show organization. Keep the scene compact and clear, with substantial individual objects rather than dozens of tiny envelopes. The neat stacks carry lime tabs with the exact short words "Clients", "Life admin", "Read later". Arrange them neatly within the right third so no tab or envelope is cut off.
This should feel like refined editorial still-life photography paired with excellent typography. Preserve the original tactile paper, green tile, natural directional light and soft shadows. Leave breathable whitespace between the headline and illustration. Do not add any other text.
```
