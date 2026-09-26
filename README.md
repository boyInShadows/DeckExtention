<div align="center">

# Deck

**A calm new tab with a deep drawer.**

A Chrome extension that replaces the new-tab page. Open a tab and you get a quiet,
instant page: a clock, one input, and your pinned links. Press one key and the whole
workspace slides up — pages, decks, cards, an inbox, notes. Close it and it's calm again.

No account. No telemetry. No network calls. Four permissions.

</div>

---

## Status

**Phase 2 in progress — the drawer is taking shape.**

| Phase | Scope | Status |
|---|---|---|
| P1 | Calm surface — clock, The Line, pins, themes, wallpaper, backups | Implementation complete; coverage and one-week field trial pending |
| P2 | Drawer — pages, decks, cards, drag-and-drop, quick save, inbox | In progress: drawer shell + pages rail, decks and cards CRUD, and drag-and-drop are done. Quick Save, inbox triage, keyboard help and bookmarks import are next |
| P3 | Sessions, tab stashing, resurfacing | Planned |
| P4 | Optional self-hosted sync | Planned |

---

## What it is

Deck fuses three ideas that usually ship separately:

- **A calm surface.** The page you see 90% of the time is a clock, a greeting, one input,
  and up to twelve pinned tiles. It paints instantly and asks nothing of you.
- **A deep drawer.** One keystroke (`Ctrl+J`, or `Space` on an empty input) slides up a
  full workspace: pages down the side, decks of cards in the middle, notes, an inbox.
- **The Line.** A single input that searches your saved cards, your notes and your open
  tabs, runs commands with a `>` prefix, and searches the web with `?`. One muscle memory
  instead of three.

### Capture is one keystroke

`Ctrl+Shift+S` on any page saves it straight to your Inbox and shows a small toast — no
popup, no "which folder?" picker, no decisions. You triage later, by keyboard, in the drawer.

---

## Principles

These are the constraints the project is built under, not marketing copy:

| | |
|---|---|
| **Instant** | The surface is interactive in under 60 ms warm. Nothing waits on disk or network. Budgets are enforced in CI: 60 KB gz for the surface, 180 KB gz for the drawer. |
| **Invisible** | It looks right before you configure anything. There is no onboarding wizard and no setup tax. |
| **Trustworthy** | Four install-time permissions: `storage`, `unlimitedStorage`, `favicon`, `contextMenus`. `commands` is a manifest key, not a permission. Everything else is optional and requested in context, with a reason, the first time you use the feature that needs it. No account, no telemetry, no network requests. Fonts and icons are local. |
| **Deep on demand** | Power is there when you go looking for it and invisible when you aren't. Including a Custom CSS box and stable `data-deck` hooks on every element. |
| **Never loses data** | Every write is appended to an oplog. A full snapshot is taken daily and kept for seven days. Migrations run on a copy and refuse to proceed if verification fails. Export always works — even if the database is corrupt, it falls back to the last snapshot. |

### What Deck deliberately does not have

Accounts · billing · sharing · AI · a widget marketplace · weather · quotes · news ·
telemetry · any permission that can read your browsing history or page content.

---

## Development

```bash
pnpm install
pnpm dev      # Vite + CRXJS, load apps/extension/dist as an unpacked extension
pnpm test     # Vitest
pnpm lint
pnpm size     # bundle budgets — fails the build if exceeded
pnpm build
```

**Stack:** pnpm workspaces · TypeScript strict · Vite + CRXJS · React 19 (aliased to
`preact/compat` at build time to stay inside the bundle budget) · Tailwind 4 · IndexedDB via
`idb` · `dnd-kit` · `fractional-indexing` · Zod · Vitest · Playwright · `size-limit`.

### Contributing agents — read this

This project is built largely by AI agents working to a written spec.

The planning documents — `MasterPlan.md` (the product and the research behind it),
`FableTasks.md` (the numbered task list), and **`AGENTS.md` (the binding rules of
engagement)** — are **deliberately not published to this repository**. They live only in
the owner's working directory.

If you are an agent and you cannot see those three files next to this README, **you are
working from an incomplete checkout. Stop and ask the owner for them.** Do not infer the
rules from the code.

Work happens on `development`. `main` is merged by the owner only.

---

## License

Not yet chosen.
