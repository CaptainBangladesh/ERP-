/**
 * A feed reader that treats the document as hostile, because it is (16e).
 *
 * Feed ingest is XML parsing of an attacker-chosen document, and the default posture of most
 * XML parsers — resolve DTDs, expand entities — is `SYSTEM "file:///etc/passwd"` and the
 * billion-laughs expansion, both of which land inside the worker with no network guard
 * involved. Rather than configure a general parser into safety and hope the next dependency
 * bump keeps it there, this is a small scanner that has no DTD support, no entity mechanism
 * beyond the five predefined names plus numeric references, a node ceiling and a depth
 * ceiling. A document carrying a `<!DOCTYPE` or a `<!ENTITY` is refused outright rather than
 * parsed carefully.
 *
 * It reads RSS 2.0, Atom and JSON Feed, which is what publishers actually serve. Anything else
 * is a `parse_error` (14-17.0d) and leaves the feed's last-success state untouched.
 */

/** Ceilings, so a small document cannot become a large amount of work (16e). */
const MAX_NODES = 20_000;
const MAX_DEPTH = 32;
const MAX_ENTRIES = 200;
const MAX_TEXT_CHARS = 20_000;

export interface ParsedFeedEntry {
  /** Always text. Markup that arrives here is escaped content, never a node (16d). */
  readonly title: string;
  readonly description: string;
  readonly link?: string;
  readonly guid?: string;
  readonly enclosureUrl?: string;
  readonly publishedAt?: Date;
}

export interface ParsedFeed {
  readonly title: string;
  readonly entries: readonly ParsedFeedEntry[];
}

export type FeedParseResult =
  | { readonly ok: true; readonly feed: ParsedFeed }
  | { readonly ok: false };

export function parseFeed(body: Buffer): FeedParseResult {
  // The 2 MB cap is applied by the fetch guard *before* this runs (14-17.0c), so a document
  // that reaches here is already bounded; the ceilings below bound the work over it.
  const text = body.toString('utf8');

  const trimmed = text.replace(/^﻿/, '').trimStart();
  if (trimmed.startsWith('{')) return parseJsonFeed(trimmed);
  return parseXmlFeed(trimmed);
}

/** JSON Feed goes through the platform parser with no reviver — nothing to evaluate (16e). */
function parseJsonFeed(text: string): FeedParseResult {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return { ok: false };
  }

  if (typeof document !== 'object' || document === null) return { ok: false };
  const root = document as Record<string, unknown>;
  const items = Array.isArray(root['items']) ? (root['items'] as unknown[]) : undefined;
  if (!items) return { ok: false };

  const entries: ParsedFeedEntry[] = [];
  for (const raw of items.slice(0, MAX_ENTRIES)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const title = readString(item['title']);
    const link = readString(item['url']);
    const guid = readString(item['id']);
    // `content_text` only. `content_html` is markup, and nothing in this module renders feed
    // markup (16d) — reading it would only invite somebody to.
    const description = readString(item['content_text']) ?? readString(item['summary']) ?? '';

    if (!title && !link) continue;
    entries.push({
      title: clampText(title ?? link ?? ''),
      description: clampText(description),
      ...(link ? { link } : {}),
      ...(guid ? { guid } : {}),
      ...(readDate(readString(item['date_published'])) ? { publishedAt: readDate(readString(item['date_published'])) as Date } : {}),
    });
  }

  return {
    ok: true,
    feed: { title: clampText(readString(root['title']) ?? ''), entries },
  };
}

interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
}

function parseXmlFeed(text: string): FeedParseResult {
  // No DTDs, no entity declarations, no processing instructions beyond the XML declaration.
  // Refused rather than skipped: a document that carries one is not a feed somebody wrote by
  // accident, and "we ignored that part" is how an XXE gets a second chance next release.
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) return { ok: false };

  const root = scan(text);
  if (!root) return { ok: false };

  const channel = findChild(root, 'channel');
  const feedTitle = clampText(childText(channel ?? root, 'title') ?? '');

  const items = channel
    ? childrenNamed(channel, 'item')
    : [...childrenNamed(root, 'entry'), ...childrenNamed(root, 'item')];

  if (items.length === 0 && !channel && root.name !== 'feed' && root.name !== 'rss') {
    return { ok: false };
  }

  const entries: ParsedFeedEntry[] = [];
  for (const item of items.slice(0, MAX_ENTRIES)) {
    const title = childText(item, 'title') ?? '';
    const description =
      childText(item, 'description') ?? childText(item, 'summary') ?? childText(item, 'content') ?? '';
    const link = childText(item, 'link') ?? linkHref(item);
    const guid = childText(item, 'guid') ?? childText(item, 'id');
    const enclosure = findChild(item, 'enclosure')?.attributes['url'];
    const published =
      readDate(childText(item, 'pubDate')) ??
      readDate(childText(item, 'published')) ??
      readDate(childText(item, 'updated'));

    if (title === '' && !link) continue;

    entries.push({
      title: clampText(title === '' ? (link ?? '') : title),
      description: clampText(description),
      ...(link ? { link } : {}),
      ...(guid ? { guid } : {}),
      ...(enclosure ? { enclosureUrl: enclosure } : {}),
      ...(published ? { publishedAt: published } : {}),
    });
  }

  return { ok: true, feed: { title: feedTitle, entries } };
}

/**
 * The scanner. Elements, attributes, text and CDATA — and nothing else.
 *
 * Comments and processing instructions are skipped as spans of characters, never interpreted.
 * Both ceilings are checked as it goes, so a pathological document stops costing us early
 * rather than after it has built a tree.
 */
function scan(text: string): XmlNode | undefined {
  const root: XmlNode = { name: '#document', attributes: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let nodes = 0;
  let index = 0;

  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open === -1) break;

    if (open > index) {
      const chunk = text.slice(index, open);
      const top = stack[stack.length - 1];
      if (top && top !== root) top.text += chunk;
    }

    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open);
      if (end === -1) return undefined;
      index = end + 3;
      continue;
    }

    if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open);
      if (end === -1) return undefined;
      const top = stack[stack.length - 1];
      // CDATA is text, and it stays text — this is the path a `<script>` in a title takes,
      // and it comes out as the characters `<script>` in a `TEXT` column (16d).
      if (top && top !== root) top.text += text.slice(open + 9, end);
      index = end + 3;
      continue;
    }

    if (text.startsWith('<?', open)) {
      const end = text.indexOf('?>', open);
      if (end === -1) return undefined;
      index = end + 2;
      continue;
    }

    if (text.startsWith('<!', open)) return undefined; // DTD-ish. Already refused above.

    const close = text.indexOf('>', open);
    if (close === -1) return undefined;

    const raw = text.slice(open + 1, close);

    if (raw.startsWith('/')) {
      if (stack.length > 1) stack.pop();
      index = close + 1;
      continue;
    }

    nodes += 1;
    if (nodes > MAX_NODES) return undefined;

    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = /^([^\s/>]+)/.exec(body);
    if (!nameMatch?.[1]) return undefined;

    const node: XmlNode = {
      name: localName(nameMatch[1]),
      attributes: readAttributes(body.slice(nameMatch[1].length)),
      children: [],
      text: '',
    };

    const parent = stack[stack.length - 1];
    parent?.children.push(node);

    if (!selfClosing) {
      stack.push(node);
      if (stack.length > MAX_DEPTH) return undefined;
    }

    index = close + 1;
  }

  return root.children[0];
}

function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const name = localName(match[1] ?? '');
    attributes[name] = decodeEntities(match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function localName(name: string): string {
  const colon = name.indexOf(':');
  return (colon === -1 ? name : name.slice(colon + 1)).toLowerCase();
}

function findChild(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((child) => child.name === name.toLowerCase());
}

function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name.toLowerCase());
}

function childText(node: XmlNode, name: string): string | undefined {
  const child = findChild(node, name);
  if (!child) return undefined;
  const value = decodeEntities(child.text).trim();
  return value === '' ? undefined : value;
}

/** Atom's `<link href="…"/>`, which carries its URL in an attribute rather than as text. */
function linkHref(node: XmlNode): string | undefined {
  const link = node.children.find(
    (child) => child.name === 'link' && typeof child.attributes['href'] === 'string',
  );
  return link?.attributes['href'];
}

/**
 * The five predefined names and numeric references, and nothing else.
 *
 * There is no entity table to extend, so there is no billion-laughs expansion and no external
 * reference to resolve: an unknown `&name;` stays the literal characters it arrived as.
 */
function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, name: string) => {
    if (name === 'amp') return '&';
    if (name === 'lt') return '<';
    if (name === 'gt') return '>';
    if (name === 'quot') return '"';
    if (name === 'apos') return "'";
    const code = name.startsWith('#x') || name.startsWith('#X')
      ? Number.parseInt(name.slice(2), 16)
      : Number.parseInt(name.slice(1), 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
    try {
      return String.fromCodePoint(code);
    } catch {
      return match;
    }
  });
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function readDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function clampText(value: string): string {
  return value.length > MAX_TEXT_CHARS ? value.slice(0, MAX_TEXT_CHARS) : value;
}
