import {
  TITLE_MAX_LENGTH,
  URL_MAX_LENGTH,
  type Card,
  type Deck,
  type Page,
} from 'deck-schema';
import { generateNKeysBetween } from 'fractional-indexing';

import {
  activeCards,
  activeDecks,
  compareOrder,
} from '../drawer/workspaceModel';
import type {
  BookmarkFolder,
  BookmarkLink,
  BookmarkNode,
} from './bookmarkTree';

/** Joins nested folder names when a sub-subfolder is flattened into a deck. */
const NESTED_TITLE_SEPARATOR = ' › ';

export interface ExistingWorkspace {
  pages: Page[];
  decks: Deck[];
  cards: Card[];
}

export interface BookmarkImportCounts {
  /** Folders that became a new page. */
  pages: number;
  /** Subfolders that became a new deck. */
  decks: number;
  /** Links that became a new card. */
  links: number;
  /** Links already in Deck (or twice in the import) - left alone. */
  duplicates: number;
  /** `javascript:`, `chrome://`, `file:` and over-long URLs. */
  unsupported: number;
}

export interface BookmarkImportPlan {
  pages: Page[];
  decks: Deck[];
  cards: Card[];
  counts: BookmarkImportCounts;
}

export interface PlanOptions {
  now: number;
  createId: () => string;
}

/** A destination deck in the plan, before ids and order keys exist. */
interface DeckDraft {
  pageTitle: string;
  title: string;
  links: BookmarkLink[];
}

/**
 * Bookmarks → workspace (FableTasks P2.S7). Top-level folders become pages,
 * every folder below them becomes a deck (deeper ones flattened as
 * "Parent › Child"), and links loose in a page folder land in a deck named
 * after the page.
 *
 * Idempotent by construction: a link whose URL is already in Deck is skipped,
 * and a page or deck with the same title is reused, so a second run plans
 * nothing.
 */
export function planBookmarkImport(
  tree: BookmarkFolder,
  existing: ExistingWorkspace,
  options: PlanOptions,
): BookmarkImportPlan {
  const drafts = collectDrafts(tree);
  const knownUrls = new Set(
    existing.cards
      .filter(({ deletedAt }) => deletedAt === null)
      .map(({ url }) => normalizeUrl(url)),
  );
  let duplicates = 0;
  let unsupported = 0;
  const accepted = drafts.map((draft) => {
    const links = draft.links.flatMap((link) => {
      const url = importableUrl(link.url);
      if (!url) {
        unsupported += 1;
        return [];
      }
      const key = normalizeUrl(url.href);
      if (knownUrls.has(key)) {
        duplicates += 1;
        return [];
      }
      knownUrls.add(key);
      return [{ ...link, url: url.href }];
    });
    return { ...draft, links };
  });
  const records = buildRecords(
    accepted.filter(({ links }) => links.length > 0),
    existing,
    options,
  );
  return {
    ...records,
    counts: {
      pages: records.pages.length,
      decks: records.decks.length,
      links: records.cards.length,
      duplicates,
      unsupported,
    },
  };
}

function collectDrafts(root: BookmarkFolder): DeckDraft[] {
  const pageFolders: BookmarkFolder[] = [];
  const looseByContainer: DeckDraft[] = [];
  const visitContainer = (container: BookmarkFolder) => {
    const loose = container.children.filter(isLink);
    if (loose.length > 0) {
      const title = container.title || UNTITLED;
      looseByContainer.push({ pageTitle: title, title, links: loose });
    }
    for (const folder of container.children.filter(isFolder)) {
      if (folder.isContainer) visitContainer(folder);
      else pageFolders.push(folder);
    }
  };
  visitContainer(root);
  return [...looseByContainer, ...pageFolders.flatMap(pageDrafts)];
}

const UNTITLED = 'Bookmarks';

function pageDrafts(page: BookmarkFolder): DeckDraft[] {
  const pageTitle = page.title || UNTITLED;
  const drafts: DeckDraft[] = [];
  const loose = page.children.filter(isLink);
  if (loose.length > 0)
    drafts.push({ pageTitle, title: pageTitle, links: loose });
  const visit = (folder: BookmarkFolder, path: string[]) => {
    const title = [...path, folder.title || UNTITLED].join(
      NESTED_TITLE_SEPARATOR,
    );
    drafts.push({ pageTitle, title, links: folder.children.filter(isLink) });
    for (const child of folder.children.filter(isFolder))
      visit(child, [...path, folder.title || UNTITLED]);
  };
  for (const folder of page.children.filter(isFolder)) visit(folder, []);
  return drafts;
}

function buildRecords(
  drafts: DeckDraft[],
  existing: ExistingWorkspace,
  options: PlanOptions,
): Pick<BookmarkImportPlan, 'pages' | 'decks' | 'cards'> {
  const builder = createRecordBuilder(existing, options);
  for (const draft of drafts) {
    const pageId = builder.pageIdFor(draft.pageTitle);
    builder.addCards(builder.deckIdFor(pageId, draft.title), draft.links);
  }
  return builder.records();
}

/**
 * Accumulates the new records for one plan. Reuse is by title, case-blind:
 * the second run of an import finds every page and deck it made the first
 * time.
 */
function createRecordBuilder(
  existing: ExistingWorkspace,
  { now, createId }: PlanOptions,
) {
  const base = { createdAt: now, updatedAt: now, deletedAt: null };
  const pageIds = new Map<string, string>();
  const deckIds = new Map<string, string>();
  const pages: Page[] = [];
  const decks: Deck[] = [];
  const cards: Card[] = [];
  const livePages = existing.pages
    .filter(({ deletedAt }) => deletedAt === null)
    .toSorted((left, right) => compareOrder(left.order, right.order));

  const pageIdFor = (title: string): string => {
    const key = titleKey(title);
    const known =
      pageIds.get(key) ??
      livePages.find((page) => titleKey(page.title) === key)?.id;
    if (known) return remember(pageIds, key, known);
    const [order] = nextKeys([livePages.at(-1), pages.at(-1)], 1);
    const page: Page = { ...base, id: createId(), title: clip(title), order };
    pages.push(page);
    return remember(pageIds, key, page.id);
  };

  const deckIdFor = (pageId: string, title: string): string => {
    const key = titleKey(title);
    const scopedKey = `${pageId}
${key}`;
    const liveDecks = activeDecks(existing.decks, pageId, 'normal');
    const known =
      deckIds.get(scopedKey) ??
      liveDecks.find((deck) => titleKey(deck.title) === key)?.id;
    if (known) return remember(deckIds, scopedKey, known);
    const newOnPage = decks.filter((deck) => deck.pageId === pageId);
    const [order] = nextKeys([liveDecks.at(-1), newOnPage.at(-1)], 1);
    const deck: Deck = {
      ...base,
      id: createId(),
      pageId,
      title: clip(title),
      kind: 'normal',
      order,
      color: null,
      isCollapsed: false,
    };
    decks.push(deck);
    return remember(deckIds, scopedKey, deck.id);
  };

  const addCards = (deckId: string, links: BookmarkLink[]) => {
    const lastExisting = activeCards(existing.cards, deckId).at(-1);
    const lastNew = cards.filter((card) => card.deckId === deckId).at(-1);
    const orders = nextKeys([lastExisting, lastNew], links.length);
    links.forEach((link, index) => {
      const { hostname } = new URL(link.url);
      cards.push({
        ...base,
        id: createId(),
        deckId,
        url: link.url,
        title: clip(link.title.trim() || hostname),
        hostname,
        order: orders[index] ?? '',
        pinned: false,
        lastOpenedAt: null,
      });
    });
  };

  return {
    pageIdFor,
    deckIdFor,
    addCards,
    records: () => ({ pages, decks, cards }),
  };
}

/** Order keys after whatever already sits last, so nothing renumbers. */
function nextKeys(
  lastRecords: ({ order: string } | undefined)[],
  count: number,
): [string, ...string[]] {
  const after = lastRecords
    .flatMap((record) => (record ? [record.order] : []))
    .toSorted(compareOrder)
    .at(-1);
  const [first, ...rest] = generateNKeysBetween(after ?? null, null, count);
  if (first === undefined) throw new Error('Cannot order zero records');
  return [first, ...rest];
}

function remember(map: Map<string, string>, key: string, id: string): string {
  map.set(key, id);
  return id;
}

function importableUrl(value: string): URL | null {
  if (value.length > URL_MAX_LENGTH) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

/** `https://Example.com/a#top` and `https://example.com/a` are one link. */
export function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}${url.search}`;
  } catch (error) {
    if (error instanceof TypeError) return value;
    throw error;
  }
}

function titleKey(title: string): string {
  return clip(title).trim().toLocaleLowerCase();
}

function clip(title: string): string {
  return title.slice(0, TITLE_MAX_LENGTH);
}

function isLink(node: BookmarkNode): node is BookmarkLink {
  return node.kind === 'link';
}

function isFolder(node: BookmarkNode): node is BookmarkFolder {
  return node.kind === 'folder';
}
