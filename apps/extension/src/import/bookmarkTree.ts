/**
 * One shape for both import sources (FableTasks P2.S7): Chrome's
 * `bookmarks.getTree()` and a Netscape bookmark file (what every browser
 * exports). The planner only ever sees this.
 *
 * A container is a browser-owned root folder ("Bookmarks bar", "Other
 * bookmarks"). It is transparent: its subfolders become pages, as if the
 * container were not there.
 */
export interface BookmarkLink {
  kind: 'link';
  title: string;
  url: string;
}

export interface BookmarkFolder {
  kind: 'folder';
  title: string;
  isContainer: boolean;
  children: BookmarkNode[];
}

export type BookmarkNode = BookmarkLink | BookmarkFolder;

/** The subset of `chrome.bookmarks.BookmarkTreeNode` the import reads. */
export interface ChromeBookmarkNode {
  title: string;
  url?: string;
  children?: ChromeBookmarkNode[];
}

/**
 * `getTree()` returns `[root]`; the root's children are always Chrome's own
 * folders (bar, other, mobile), never the user's.
 */
export function fromChromeTree(tree: ChromeBookmarkNode[]): BookmarkFolder {
  const containers = tree.flatMap((root) => root.children ?? []);
  return {
    kind: 'folder',
    title: '',
    isContainer: true,
    children: containers.map((node) => fromChromeNode(node, true)),
  };
}

function fromChromeNode(
  node: ChromeBookmarkNode,
  isContainer: boolean,
): BookmarkNode {
  if (node.url !== undefined)
    return { kind: 'link', title: node.title, url: node.url };
  return {
    kind: 'folder',
    title: node.title,
    isContainer,
    children: (node.children ?? []).map((child) =>
      fromChromeNode(child, false),
    ),
  };
}

/** `<H3 …>`, `<A HREF=…>`, `<DL>` and `</DL>` are all the format needs. */
const NETSCAPE_TOKEN =
  /<h3\b([^>]*)>([\s\S]*?)<\/h3>|<a\b([^>]*)>([\s\S]*?)<\/a>|<dl\b[^>]*>|<\/dl>/gi;
const HREF_ATTRIBUTE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
/** Chrome, Edge and Firefox mark their root folders with these attributes. */
const CONTAINER_ATTRIBUTE =
  /\b(?:personal_toolbar_folder|unfiled_bookmarks_folder)\b/i;
const TAG = /<[^>]*>/g;

/**
 * Parses a Netscape bookmark file without a DOM: the drawer may run in a
 * worker-like context later, and the format is a flat token stream anyway.
 * Unbalanced files (a missing `</DL>`) still yield every link they contain.
 */
export function parseNetscapeBookmarks(html: string): BookmarkFolder {
  const root: BookmarkFolder = {
    kind: 'folder',
    title: '',
    isContainer: true,
    children: [],
  };
  const stack: BookmarkFolder[] = [];
  let pending: BookmarkFolder | null = null;
  let hasOpenedRoot = false;
  for (const match of html.matchAll(NETSCAPE_TOKEN)) {
    const [token, folderAttributes, folderTitle, linkAttributes, linkTitle] =
      match;
    const parent = stack.at(-1) ?? root;
    if (folderTitle !== undefined) {
      pending = {
        kind: 'folder',
        title: decodeEntities(folderTitle),
        isContainer: CONTAINER_ATTRIBUTE.test(folderAttributes ?? ''),
        children: [],
      };
      parent.children.push(pending);
    } else if (linkTitle !== undefined) {
      const href = HREF_ATTRIBUTE.exec(linkAttributes ?? '');
      const url = href?.[1] ?? href?.[2] ?? href?.[3];
      if (url)
        parent.children.push({
          kind: 'link',
          title: decodeEntities(linkTitle),
          url: decodeEntities(url),
        });
    } else if (token.startsWith('</')) {
      stack.pop();
    } else if (pending) {
      stack.push(pending);
      pending = null;
    } else if (hasOpenedRoot) {
      // A <DL> with no heading: keep its links in the current folder.
      stack.push(parent);
    }
    hasOpenedRoot = true;
  }
  return root;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value
    .replace(TAG, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
      if (body.startsWith('#')) {
        const isHex = body[1]?.toLowerCase() === 'x';
        const code = Number.parseInt(
          body.slice(isHex ? 2 : 1),
          isHex ? 16 : 10,
        );
        return code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : entity;
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
    })
    .trim();
}
