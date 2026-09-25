import 'server-only';
import sanitizeHtml from 'sanitize-html';
import type { MessageContent } from './providers/content';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  );
const length = /^(?:0|\d+(?:\.\d+)?(?:px|pt|em|rem|%))$/i;
const color = /^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\))$/i;
const absoluteLink = (value: string) => /^(?:https?:\/\/|mailto:|tel:)/i.test(value);

export function messageHeaders(images: boolean): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:${images ? ' https:' : ''}; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox`,
  };
}

export function messageDocument(message: MessageContent, images = false, fallback = false): string {
  const content =
    message.format === 'text'
      ? `<div class="plain-text">${escape(message.content)}</div>`
      : sanitizeHtml(message.content, {
          allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'center', 'font'],
          nonTextTags: ['script', 'style', 'textarea', 'option', 'head', 'title'],
          allowedAttributes: {
            '*': ['style', 'dir', 'lang', 'align'],
            a: ['href', 'title', 'target', 'rel'],
            img: ['src', 'alt', 'title', 'width', 'height'],
            table: ['width', 'cellpadding', 'cellspacing', 'border', 'bgcolor', 'role'],
            td: ['width', 'height', 'colspan', 'rowspan', 'valign', 'bgcolor'],
            th: ['width', 'height', 'colspan', 'rowspan', 'valign', 'scope'],
            font: ['color', 'face', 'size'],
          },
          allowedSchemes: ['https', 'http', 'mailto', 'tel'],
          allowProtocolRelative: false,
          allowedStyles: {
            '*': {
              color: [color],
              'background-color': [color],
              'font-size': [length],
              'font-family': [/^[\w\s,'"-]+$/],
              'font-weight': [/^(?:normal|bold|[1-9]00)$/],
              'font-style': [/^(?:normal|italic)$/],
              'text-align': [/^(?:left|right|center|justify)$/],
              'text-decoration': [/^(?:none|underline|line-through)$/],
              'line-height': [length, /^\d+(?:\.\d+)?$/],
              width: [length],
              'max-width': [length],
              height: [length],
              padding: [/^\d+(?:px|pt|em|rem|%)(?:\s+\d+(?:px|pt|em|rem|%)){0,3}$/],
              'padding-top': [length],
              'padding-bottom': [length],
              'padding-left': [length],
              'padding-right': [length],
              'border-collapse': [/^(?:collapse|separate)$/],
              'table-layout': [/^(?:auto|fixed)$/],
              display: [/^(?:none|block|inline|inline-block|table|table-row|table-cell)$/],
              'vertical-align': [/^(?:top|middle|bottom|baseline)$/],
            },
          },
          transformTags: {
            table: (_tag, attributes) => {
              // Large, image-sliced newsletters otherwise force horizontal scrolling.
              if (Number(attributes.width) > 800) {
                attributes.width = '100%';
                attributes.style = `${attributes.style ?? ''};width:100%;table-layout:fixed`;
              }
              return { tagName: 'table', attribs: attributes };
            },
            a: (_tag, attributes) => {
              if (!absoluteLink(attributes.href ?? '')) delete attributes.href;
              return {
                tagName: 'a',
                attribs: { ...attributes, target: '_blank', rel: 'noopener noreferrer' },
              };
            },
            img: (_tag, attributes) => {
              if (!images || !/^https:\/\//i.test(attributes.src ?? '')) delete attributes.src;
              return { tagName: 'img', attribs: attributes };
            },
          },
        });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Email message</title><style>
    :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:24px;color:#1f2937;background:white;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-wrap:anywhere}
    .message{max-width:800px;margin:auto}img{max-width:100%!important;height:auto!important}table{max-width:100%!important}a{color:#086b57}pre{white-space:pre-wrap}blockquote{margin-left:12px;padding-left:16px;border-left:2px solid #d9e3df}.plain-text{white-space:pre-wrap}.notice{padding:12px 16px;background:#f6f7f5;border:1px solid #d9e3df;border-radius:8px;margin-bottom:20px;font:14px/1.5 sans-serif}
    @media(max-width:600px){body{padding:16px}}
    </style></head><body>${fallback ? '<div class="notice" role="status">The full message couldn’t load. This is the saved text or preview. Close and reopen to retry, or use “Open & reply” to read the original.</div>' : ''}<main class="message">${content}</main></body></html>`;
}
