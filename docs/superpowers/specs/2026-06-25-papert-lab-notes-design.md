# Papert Lab Working Notes — Design Spec

**Date:** 2026-06-25
**Repo:** `Papert-Lab/notes`
**Status:** Approved architecture; pre-implementation.

---

## 1. Purpose & framing

A public, densely-linked notes wiki for the Papert Lab weekly discussion group (Virginia Tech).
The lab is named after **Seymour Papert** (constructionism: you learn by building shareable
"objects to think with"). The product is two things at once:

1. A **mnemonic medium** — used here in Andy Matuschak's *evergreen notes* sense, **not** the
   literal Quantum-Country spaced-repetition sense. Memory comes from **atomicity + dense
   linking + non-linear re-encounter**, not flashcards. (SRS is an explicit non-goal for v1;
   see §11.)
2. A **playground** where lab patrons contribute notes — and later, cognition-augmenting tools —
   to a shared substrate.

**Read is public; write is gated.** Anyone can read every note at `notes.papertlab.org`.
Creating, editing, or deleting requires an account, and sign-up requires an access code.

### Cognitive rationale (why these features, not which features)

| Mechanism | Feature that serves it |
|---|---|
| Elaboration / generation effect | Writing atomic notes; aliasing links while writing |
| Retrieval by traversal | Stacked panes + dense internal links + backlinks |
| Distributed encoding (not one folder) | No folders; a node participates in many contexts via links |
| Social construction (Papert) | Group-trust editing; patron contributions; "with the garage door up" |

---

## 2. Source of truth: the imported prototype

`Working Notes.dc.html` (Claude Design, imported via DesignSync) is **not a mockup — it is a
complete, runnable interaction prototype** (~700-line React/`DCLogic` component). The production
build *productionizes* it rather than inventing it. What the prototype already specifies exactly:

- **Sliding stacked panes** as sticky columns with collapsing vertical-text "spines"; a
  hover-preview popup card (460px) on link hover.
- **The link state machine** (`openNote(srcIndex, id)`): see §7. This already matches the
  owner's written spec verbatim.
- **Live-source-styling markdown editor** in `contenteditable`: `renderMd()` keeps `**`, `*`,
  `` ` ``, `[[ ]]`, `]( )` syntax **visible but dimmed** (`.md-mark`), hides heading `#` marks
  (`.md-hide`), colors `@`-mentions green. Cmd+B/I/K, Enter.
- **`@`-mention autocomplete and Cmd+K link-with-search** — both query notes, both offer
  "+ Create note", both insert an internal link. Arrow / Enter / Tab / Esc navigation.
- **New note** = a new rightmost column in edit mode (the owner's "panel to the right",
  reconciled with the stack model).
- **Backlinks** grid ("Links to this note") at the foot of each note.
- **Design tokens** (`colors_and_type.css`): warm cream paper (`--bg:#f5f0e6`), Georgia serif
  body, wood-brown accent (`--accent:#5C3A1E`), green mentions (`--turtle-deep:#4e6b54`), SVG
  fractal-noise paper texture, `--ease-out` cubic easing.

### What the prototype does NOT have (the production layer we add)

URL state (it is pure in-memory React), Supabase (it is `localStorage`), auth / access codes,
stable slugs, shareable per-note title URLs, and **id/slug-based links** (it matches on title
strings — see §9).

---

## 3. Architecture

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind, deployed on **Vercel**, domain
  `notes.papertlab.org`.
- **Backend:** Supabase project `npgyxxnldslmbtblqymp` (Postgres + Auth + Edge Functions).
- **Editor:** **CodeMirror 6** (chosen over Tiptap — see §6).
- **Rendering model:** Server Components fetch the notes for a URL path on first load (SSR);
  the client takes over for subsequent stack mutations with no server round-trip (notes fetched
  on demand and cached client-side).

### Units (each independently understandable / testable)

| Unit | Responsibility | Depends on |
|---|---|---|
| `stack-model` | Pure functions: the open-pane state machine (§7) | nothing (pure TS) |
| `url-codec` | Encode/decode stack ⇄ URL path; History API sync | `stack-model` |
| `note-store` | Fetch/save nodes & links via Supabase; client cache | `@supabase/ssr` |
| `editor` (CM6) | Live-source-styling, keymaps, autocomplete source | `note-store` (search) |
| `panes` (UI) | Sticky columns, spines, hover preview, backlinks grid | `stack-model`, `note-store` |
| `auth` | Access-code signup (Edge Fn), login, write-gating | Supabase Auth |

The pure `stack-model` and `url-codec` are deliberately framework-free so they can be unit-tested
in isolation — they hold the subtlest logic in the system.

---

## 4. Data model (Postgres / Supabase)

```sql
-- Identity ------------------------------------------------------------
profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  created_at  timestamptz not null default now()
)

-- Access-code gate for sign-up ---------------------------------------
access_codes (
  code        text primary key,
  label       text,
  max_uses    int  not null default 1,
  uses        int  not null default 0,
  active      bool not null default true,
  created_at  timestamptz not null default now()
)

-- Notes (everything is a "node") -------------------------------------
nodes (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,        -- stable, URL-facing, IMMUTABLE after creation
  title           text not null default '',    -- '' allowed → renders "Untitled note"
  body            text not null default '',    -- markdown SOURCE text (CM6 is text-native)
  body_text       text not null default '',    -- derived plaintext, for search
  created_by      uuid references profiles(id),
  last_edited_by  uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
)

-- Materialized internal links (re-derived on every save) -------------
links (
  id            bigint generated always as identity primary key,
  source_id     uuid not null references nodes(id) on delete cascade,
  target_id     uuid not null references nodes(id) on delete cascade,
  display_text  text,                          -- alias; null → render target's live title
  position      int  not null default 0
)

-- Author(s) set (appended on each distinct contributor's save) -------
node_contributors (
  node_id        uuid not null references nodes(id) on delete cascade,
  profile_id     uuid not null references profiles(id) on delete cascade,
  first_at       timestamptz not null default now(),
  primary key (node_id, profile_id)
)
```

**A node IS the unit of both "document" and "folder."** A node with an empty `body` but a title,
referenced by other notes, is a de-facto label / Map-of-Content. No `type` column — folder-ness
is emergent, exactly as the prototype treats all nodes uniformly.

**Slug rules:** generated at first save from `slugify(title)` + short disambiguator; **immutable**
thereafter. Renaming changes `title`, never `slug` → shared URLs never break, and slug-based links
survive renames. Empty-title node → slug `node-<short-id>`. Reserved slugs (cannot be minted):
`login`, `signup`, `api`, `_next` (see §7 URL collisions). "Norms" is a *real node*, not a
reserved route, so its slug (e.g. `norms`) is mintable like any other.

---

## 5. Auth, RLS, and the access-code gate

### Sign-up cannot be gated by RLS

`auth.users` is owned by Supabase GoTrue; RLS on it does not gate inserts. The real mechanism is a
**Supabase Edge Function `signup`** (service-role) that runs atomically:

1. Validate access code (`active = true AND uses < max_uses`).
2. Check `username` is free.
3. `auth.admin.createUser({ email, password })`.
4. Insert `profiles { id, username }`.
5. `uses = uses + 1` on the code.

The client never calls `auth.signUp` directly. Login afterward is normal email/password. (Google
OAuth deferred — §11.)

### RLS policies

```sql
-- nodes: public read; any authenticated member writes (group trust)
alter table nodes enable row level security;
create policy nodes_read   on nodes for select using (true);
create policy nodes_insert on nodes for insert to authenticated with check (true);
create policy nodes_update on nodes for update to authenticated using (true) with check (true);
create policy nodes_delete on nodes for delete to authenticated using (true);

-- links + node_contributors: public read; writes authenticated (written via save RPC)
alter table links enable row level security;
create policy links_read   on links for select using (true);
create policy links_write  on links for all to authenticated using (true) with check (true);

alter table node_contributors enable row level security;
create policy nc_read  on node_contributors for select using (true);
create policy nc_write on node_contributors for all to authenticated using (true) with check (true);

-- profiles: public read (to show author usernames); update own only
alter table profiles enable row level security;
create policy profiles_read       on profiles for select using (true);
create policy profiles_update_own on profiles for update to authenticated using (id = auth.uid());

-- access_codes: NO anon/authenticated policies → only the service-role Edge Fn can touch them
alter table access_codes enable row level security;
```

**Group-trust decision:** any signed-in member can edit any note (a small, trusted lab). Trade-off
made explicit: no per-note ownership protection; "last write wins"; mitigated by `node_contributors`
+ `last_edited_by` provenance. (Author-only editing and revision history are deferred — §11.)

### Provenance trigger (authoritative, unspoofable)

```sql
create function set_node_meta() returns trigger
  language plpgsql security definer as $$
begin
  new.updated_at := now();
  new.last_edited_by := auth.uid();
  if tg_op = 'INSERT' and new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end $$;
create trigger nodes_meta before insert or update on nodes
  for each row execute function set_node_meta();
```

### Save path (atomic)

The client already holds the parsed internal links (CM6's tree). It calls an RPC
`save_node(p_id uuid, p_title text, p_body text, p_links jsonb)` that, in one transaction:
upserts the node (`title`, `body`, `body_text`), **replaces** all `links` where `source_id = p_id`
from `p_links`, and ensures a `node_contributors` row for `auth.uid()`. `SECURITY INVOKER`
(RLS-enforced). Provenance/timestamps come from the trigger.

### Search

`pg_trgm` GIN index on `nodes.title` (and `body_text`). RPC `search_nodes(q text)` →
`{ id, slug, title }[]`, used by the `@` and Cmd+K autocomplete. (Trigram is the lightest option
adequate for a small, typo-tolerant corpus; `tsvector` is overkill at this scale.)

---

## 6. Editor — CodeMirror 6 (and why not Tiptap)

The prototype's editor keeps **literal markdown syntax visible but dimmed** (`**`, `[[`, `` ` ``).
That is *source-mode-with-styling* — Obsidian's actual model. Tiptap/ProseMirror is WYSIWYG: its
model *removes* those characters into a node tree, so keeping them visible fights the abstraction.
**CodeMirror 6 is Obsidian's real engine** and is text-native, which also matches storing markdown
source in `nodes.body`. Hence CM6.

Implementation:

- `@codemirror/lang-markdown` + `@lezer/markdown` for parsing.
- A `ViewPlugin` building `Decoration`s that reproduce the prototype's classes — `md-bold`,
  `md-mark` (dimmed syntax), `md-italic`, `md-code`, `md-mention`, `md-link`, `md-url`,
  `md-h1..h5`, `md-hide` (heading `#`), `md-quote`. This is the well-known "Obsidian Live Preview"
  CM6 recipe: style syntax tokens, optionally hide them when the cursor is off the line.
- **Keymaps:** Cmd/Ctrl+B wraps `**…**`; Cmd/Ctrl+I wraps `*…*`; Cmd/Ctrl+K inserts `[sel]()` and
  opens the link search inside `()`; Enter = newline (CM default).
- **Autocomplete** via `@codemirror/autocomplete` with a custom `CompletionSource`:
  - triggers on `@…` (spaces allowed in query; commit on select) and inside `](…)`;
  - options from `search_nodes(q)` plus a synthetic **"+ Create note '<q>'"** option;
  - on select: `@` → insert `[[<slug>]]` (id-backed; renders live title or alias); Cmd+K →
    `[<display>](<slug>)`; "Create" mints a node and opens it as a new column.

**Link storage = by slug, not title.** Internal links are stored as `[[slug]]` / `[alias](slug)`
where `slug` is immutable. Rendering resolves `slug → live title` (or shows the alias). This fixes
the prototype's title-string matching, which dangles on rename (§9).

---

## 7. Stacked panes + URL state

### The state machine (ported from the prototype's `openNote`, matches the owner's spec)

State `S` = ordered list of open node slugs (panes left→right). On clicking an internal link to
`target` inside the pane at index `i`:

```
let j = S.indexOf(target)
if (j >= 0)        →  FOCUS: smooth-scroll pane j into view. S unchanged.   // already open ⇒ never close
else               →  BRANCH: S = S.slice(0, i+1).concat(target)            // truncate right of source, append
```

Edge cases (all covered by the single rule above):
- target already open at `j < i` (the owner's "note 3 → note 2"): focus, close nothing. ✓
- target already open at `j > i`: focus (scroll left→right). S unchanged.
- target not open (the owner's "note 2 → note 4"): truncate everything right of pane `i` (closes
  note 3), append note 4. ✓
- target == pane `i` itself: `j == i ≥ 0` → focus self / no-op.
- **Open from outside a pane** (search, home, direct URL load): `S = [target]` (fresh single-pane
  stack), not a branch.
- **New note / close pane:** new note pushes a rightmost editing column; closing pane `k` removes
  it; an empty untitled new note is discarded on close (per prototype).

### URL scheme

- **Path = the stack:** `notes.papertlab.org/<slug0>/<slug1>/<slug2>` via a catch-all
  `app/[...stack]/page.tsx`. A **single-segment path `/<slug>` is the canonical, shareable URL**.
- **Title click copies the single-note URL** (`origin + '/' + slug`) to the clipboard — shareable
  independent of whatever chain is currently open. (Titles are the share handle.)
- **Sync with minimal latency:** stack mutations use the **History API** directly
  (`pushState` on user-initiated branch/new/close so Back walks the branch history; `replaceState`
  for programmatic normalization) — no Next.js navigation, no reload, no server round-trip. Pure
  scroll/focus (already-open target) does **not** change the URL (S is unchanged).
- **Collisions:** reserved top-level routes `/login`, `/signup`, `/api`, `/_next` are excluded from
  slug space (§4). The "Norms" nav points to a real node (`/about`-style slug), not a reserved path.
- **Load:** parse path → slugs → fetch nodes in parallel (SSR on first paint) → render the stack.
  Unknown slug → that pane renders a "missing note" state; the rest render.

---

## 8. Backlinks, node-as-folder, navigation

- **Backlinks** ("Links to this note"): `select … from links where target_id = $node` joined to
  source nodes; rendered as the 2-col card grid from the prototype (title + snippet). Real, indexed
  reverse lookup (not a full-corpus scan).
- **Node-as-folder:** emergent (§4). An empty-body node renders title + backlinks only and works as
  a label/MOC. No special UI mode.
- **Nav:** header "Papert Lab wiki" → home (a configurable home node, e.g. `evergreen` in the
  prototype). "Norms" → the norms node. "New note" button + key (§10). External "Papert Lab" link →
  `papertlab.org`.
- **Home / index discovery:** because there are no folders, discovery = the home node (a curated MOC)
  + search + backlinks. (A global graph view is a deferred nice-to-have, §11.)

---

## 9. Correctness upgrades over the prototype

1. **Id/slug-based links, not title matching.** Prototype resolves `[[title]]` and `](target)` by
   case-insensitive title match and computes backlinks by substring-scanning every body. Production
   stores links by immutable slug and materializes a `links` table → rename-safe, indexed, exact.
2. **Author(s) + last-edited surfaced.** Prototype shows only a "Saved" chip. Production renders
   `author(s)` (from `node_contributors`) and `last edited <relative time> by <username>` under each
   title — the owner's required note fields.
3. **`contenteditable` fragility removed.** CM6 replaces the prototype's "re-render `innerHTML`
   every keystroke + hand-restore caret" loop with a robust document/selection model (IME, mobile,
   complex selections).

---

## 10. Keyboard model

| Action | Binding | Notes |
|---|---|---|
| Bold / italic / link | Cmd/Ctrl + B / I / K | In-editor (CM6 keymap). In the editor, Cmd+K = insert link (search notes). |
| Command palette / quick-open / **new note** | Cmd/Ctrl + K *(when NOT in the editor)* + header "New note" button | Opens a quick-switcher: search and open any note; typing a title with no exact match surfaces "+ Create note '<q>'" as the top action. **This is the new-note path.** Reuses `search_nodes` (§5). |
| @ mention / autocomplete nav | `@`, then ↑/↓/Enter/Tab/Esc | Per prototype. |
| Blur editor | Esc | Per prototype. |

**Why no dedicated `Cmd`+letter for new note.** `Cmd+N` is OS-reserved ("new window") and a page
cannot `preventDefault` it; a **bare `n` collides with typing**; and single-modifier combos
(`Cmd+J`, `Cmd+Shift+K`, …) each collide with *some* browser's reserved shortcut cross-platform.
Browser-native tools-for-thought apps (Notion, Linear, Obsidian Publish, Vercel) all converge on a
**`Cmd/Ctrl+K` command palette + a button** for exactly this reason. `Cmd+K` is reliably
page-capturable (the entire Cmd-K-palette pattern depends on it); inside the CM editor it is scoped
to "insert link" — the same *connect-to-a-note* verb. The design's header reads "New note ⌘N"; on
port, the label drops the "⌘N" hint.

The command palette is a thin new component: a modal over `search_nodes` whose actions are *open
note*, *create note*, and (later) *go to home/norms*. A global-capture Chrome extension (side panel
via a *non-reserved* command) remains a **separable, deferred subsystem** (§11) — the web app is the
deliverable.

---

## 11. Non-goals (explicit YAGNI)

Cut from v1, with what's lost noted:

- **Spaced-repetition prompts (literal mnemonic medium).** Lost: Quantum-Country-style review.
  Schema does not preclude a later `prompts` table. Owner chose evergreen-notes scope.
- **Real-time multiplayer / CRDT editing.** Lost: simultaneous live co-editing. Mitigation: small
  trusted group, last-write-wins, save-on-pause + refetch. Revisit if collisions bite.
- **Revision history / author-only editing.** Group-trust overwrite chosen (§5).
- **Google OAuth.** Email/username/password only for now.
- **Chrome extension** for global Cmd-key capture.
- **Folders** (by design — nodes are folders) and a **global graph view** (deferred).

---

## 12. PR sequencing

Incremental PRs, each on a feature branch with tests, **never** to `main` (standing rule). Each PR
is independently reviewable and leaves the app in a working state.

1. **Scaffold + design system + static read view.** Next.js + TS + Tailwind; port
   `colors_and_type.css` tokens + paper texture + prose styles; Supabase client wiring; schema
   migration (all tables, RLS, trigger, `save_node`/`search_nodes` RPCs, `pg_trgm`); seed the
   Matuschak demo nodes. Render a single note by slug (server-fetched). Public read works.
2. **Stacked panes + URL state machine.** Catch-all `[...stack]` route; sticky columns + spines;
   `stack-model` (pure, unit-tested) + `url-codec`; hover-preview popup; History-API sync;
   title-click-copies-single-note-URL. Read-only.
3. **Auth + write-gating.** `signup` Edge Function (access code); login; session via `@supabase/ssr`;
   logged-out = read-only, logged-in = can edit; profiles/username.
4. **Editor + save.** CM6 live-source-styling (md-* parity); Cmd+B/I/K; Enter; new-note-as-column;
   `save_node` RPC (body + link materialization + contributor + provenance).
5. **@ mention + Cmd+K autocomplete.** `search_nodes` RPC; `@` widget + Cmd+K in-parens search;
   create-note-from-query; slug-backed aliased links.
6. **Backlinks + node-as-folder + nav + new-note key.** Real backlinks from `links`; empty-body-node
   affordance; home/Norms nav; `n` keybinding.
7. **`main-site` backlink** (separate repo `Papert-Lab/main-site`): a nav/footer link to
   `notes.papertlab.org`.

Throughout: deploy to Vercel; bind `notes.papertlab.org`. Tests: Vitest (stack-model, url-codec,
slug, link-parsing, decorations) + Playwright (pane interaction, auth gate, editor).

---

## 13. Open risks

- **CM6 live-source-styling fidelity.** Reproducing the prototype's exact dimmed-syntax look in CM6
  decorations is the highest-uncertainty task. De-risk in PR④ with a visual spike against the
  prototype before wiring persistence.
- **History-API + Next App Router interplay.** Direct `pushState` must not desync Next's router.
  Validated in PR② against the documented pattern (treat the catch-all route as the source of truth
  on load; own the URL via History API during a session).
- **Access-code Edge Function** needs the service-role key in Supabase Edge secrets (not Vercel).
