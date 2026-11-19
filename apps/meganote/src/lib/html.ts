/* Minimal HTML sanitizer: keeps only our inline formatting vocabulary. */

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'S', 'STRIKE', 'DEL', 'U', 'CODE', 'BR', 'A', 'SPAN', 'MARK']);
const TONE_CLASSES = new Set([
  'tc-ink', 'tc-terra', 'tc-sage',
  'bg-ink', 'bg-terra', 'bg-sage',
  'bg-ink-soft', 'bg-terra-soft', 'bg-sage-soft',
]);

export function isSafeUrl(raw: string): boolean {
  const url = raw.trim();
  if (!url) return false;
  if (url.startsWith('#') || url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return true;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('/')) return url;
  return `https://${url}`;
}

export function sanitizeInline(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';
  const out = document.createElement('div');
  const walk = (src: Node, dst: Node) => {
    for (const child of Array.from(src.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        dst.appendChild(document.createTextNode(child.textContent ?? ''));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      const tag = el.tagName;
      if (!ALLOWED_TAGS.has(tag)) {
        walk(el, dst); // unwrap disallowed tags, keep their text
        continue;
      }
      if (tag === 'BR') {
        dst.appendChild(document.createElement('br'));
        continue;
      }
      if (tag === 'A') {
        const href = el.getAttribute('href') ?? '';
        if (!isSafeUrl(href)) {
          walk(el, dst);
          continue;
        }
        const a = document.createElement('a');
        a.setAttribute('href', href);
        const pageId = el.getAttribute('data-page-id');
        if (pageId && /^[A-Za-z0-9_-]+$/.test(pageId)) a.setAttribute('data-page-id', pageId);
        if (el.classList.contains('mention')) a.className = 'mention';
        if (href.startsWith('#/p/')) {
          walk(el, a);
        } else {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
          walk(el, a);
        }
        dst.appendChild(a);
        continue;
      }
      if (tag === 'SPAN') {
        const classes = Array.from(el.classList).filter((c) => TONE_CLASSES.has(c));
        if (classes.length === 0) {
          walk(el, dst);
          continue;
        }
        const span = document.createElement('span');
        span.className = classes.join(' ');
        walk(el, span);
        dst.appendChild(span);
        continue;
      }
      const mapped = tag === 'STRONG' ? 'b'
        : tag === 'EM' ? 'i'
        : tag === 'STRIKE' || tag === 'DEL' ? 's'
        : tag.toLowerCase();
      const clean = document.createElement(mapped);
      walk(el, clean);
      dst.appendChild(clean);
    }
  };
  walk(root, out);
  return out.innerHTML;
}

/** Plain text from (possibly formatted) HTML — used for search and text extraction. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return (doc.body.textContent ?? '').replace(/\u00A0/g, ' ').trim();
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Convert a contenteditable DOM selection's inline HTML to safe HTML (used by toolbar). */
export function selectionHtml(range: Range): string {
  const div = document.createElement('div');
  div.appendChild(range.cloneContents());
  return sanitizeInline(div.innerHTML);
}
