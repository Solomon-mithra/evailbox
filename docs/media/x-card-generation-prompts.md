# evailbox X website-card generation prompts

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
