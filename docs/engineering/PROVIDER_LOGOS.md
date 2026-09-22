# Mail provider logos

The landing page and Accounts view (including its embedded version in Settings) use local, unmodified SVG artwork through the shared ProviderLogo component. Each logo is contained within a 20 × 20px box on the landing page and a 28 × 28px box in Accounts, preserving its aspect ratio and original colors. Both logo asset routes are public so they load for signed-out visitors. The images are decorative for screen readers because adjacent text names the provider.

| Asset                       | Source                                                                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/brands/gmail.svg`   | [Google-hosted Gmail SVG](https://www.gstatic.com/images/branding/productlogos/gmail_2026/v2/web/192px.svg), linked from the [Google Workspace Gmail page](https://workspace.google.com/products/gmail/)                      |
| `public/brands/outlook.svg` | [Microsoft Outlook SVG on Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Microsoft_Outlook_Icon_%282025%E2%80%93present%29.svg), attributed to Microsoft and sourced there from Microsoft's Microsoft 365 website |

Retrieved 2026-09-21. Provider marks identify the supported connections; they remain the brands of their respective owners.
