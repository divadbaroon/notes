# PR① — Scaffold + Design System + Schema + Static Read View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js app, port the design system, create the full Supabase schema/RLS, seed the demo notes, and render a single note publicly by slug.

**Architecture:** Next.js App Router (optional catch-all `app/[[...stack]]/page.tsx`) server-fetches a note from Supabase by the last URL slug and renders its markdown body with a pure, unit-tested renderer. The full schema (nodes/links/profiles/access_codes/node_contributors), RLS, provenance trigger, and the `save_node`/`search_nodes` RPCs are all created now (functions sit unused until later PRs) so later PRs only add app code, never migrations to existing tables.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Tailwind CSS v4, `@supabase/ssr` + `@supabase/supabase-js`, Vitest (unit), Playwright (smoke), Supabase Postgres (`pg_trgm`).

## Global Constraints

- Repo: `Papert-Lab/notes`, working dir `~/papert-lab-notes`. App lives at repo root.
- All work on a feature branch `feat/pr1-scaffold-read-view`; **never push to `main`**; local commits are pre-authorized; integrate via PR.
- Supabase project ref: `npgyxxnldslmbtblqymp`. Use the **personal** Supabase MCP (`mcp__supabase__*`), NOT `vt-supabase`. **Prerequisite:** the project-scope Supabase MCP must be authenticated (`claude /mcp` → supabase → Authenticate) before Task 3.
- Internal-link markdown forms (canonical, used in seeds and renderer): `[[slug]]` (display = target's live title) and `[alias](slug)` (display = alias). External links: `[text](https://…)`.
- Heading level mapping mirrors the prototype: markdown `#` → `<h2>` (i.e. `level = min(hashes + 1, 6)`).
- Design tokens are the imported `colors_and_type.css` (warm cream paper, Georgia serif). Use the raw CSS variable names verbatim (`--bg`, `--text`, `--accent`, …) so the port is pixel-faithful.
- Reserved slugs (never minted): `login`, `signup`, `api`, anything starting `_`.
- Node version ≥ 20.

---

## File structure (PR①)

```
package.json, next.config.ts, tsconfig.json, postcss.config.mjs, eslint.config.mjs   # scaffold
vitest.config.ts, playwright.config.ts                                               # test runners
app/globals.css            # @import tailwindcss + ported design tokens + .note-prose
app/layout.tsx             # root layout (body bg/font)
app/[[...stack]]/page.tsx  # optional catch-all: render note at last slug (single column, PR①)
app/not-found.tsx          # missing-note fallback
lib/supabase/server.ts     # createServerClient (await cookies, getAll/setAll)
lib/supabase/client.ts     # createBrowserClient
lib/notes/types.ts         # Note type
lib/notes/slug.ts          # slugify / isReserved / uniqueSlug   (pure, TDD)
lib/notes/queries.ts       # getNodeBySlug, getSlugTitleMap      (server)
lib/markdown/render.ts     # renderNoteBody / renderInline       (pure, TDD)
lib/util/format.ts         # formatEdited(date)                  (pure, TDD)
supabase/migrations/0001_init.sql   # schema + RLS + trigger + pg_trgm + RPCs
supabase/seed.sql                    # Matuschak demo nodes
e2e/read-view.spec.ts                # Playwright smoke
```

---

## Task 1: Scaffold Next.js + Tailwind v4 + test runners

**Files:** Create scaffold (root), `postcss.config.mjs`, `vitest.config.ts`, `playwright.config.ts`. Preserve existing `README.md`, `docs/`, `.mcp.json`, `.gitignore`.

**Interfaces:** Produces a booting Next.js app + `npm test` (Vitest) and `npm run e2e` (Playwright) scripts later tasks rely on.

- [ ] **Step 1: Branch**

```bash
cd ~/papert-lab-notes && git checkout -b feat/pr1-scaffold-read-view
```

- [ ] **Step 2: Scaffold into a temp dir, then merge (avoids create-next-app's non-empty-dir refusal)**

```bash
SCRATCH=$(mktemp -d)
npx create-next-app@latest "$SCRATCH/app" --typescript --eslint --app --no-src-dir --import-alias "@/*" --use-npm --no-turbopack --skip-install
# copy everything except the generated git/readme/gitignore (we keep ours)
rsync -a --exclude='.git' --exclude='README.md' --exclude='.gitignore' "$SCRATCH/app/" ~/papert-lab-notes/
cd ~/papert-lab-notes && npm install
```

- [ ] **Step 3: Install Tailwind v4 + Supabase + test deps**

```bash
cd ~/papert-lab-notes
npm install tailwindcss @tailwindcss/postcss postcss @supabase/ssr @supabase/supabase-js
npm install -D vitest @vitest/coverage-v8 @playwright/test
npx playwright install chromium
```

- [ ] **Step 4: PostCSS config for Tailwind v4**

`postcss.config.mjs`:
```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
```

- [ ] **Step 5: Vitest config**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
```

- [ ] **Step 6: Playwright config**

`playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

- [ ] **Step 7: Add test scripts to `package.json`**

In `package.json` `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest",
"e2e": "playwright test"
```

- [ ] **Step 8: Verify the app boots, then commit**

Run: `npm run build`
Expected: build completes (default create-next-app page) with no errors.

```bash
git add -A && git commit -m "chore: scaffold Next.js + Tailwind v4 + Vitest + Playwright"
```

---

## Task 2: Port the design system

**Files:** Replace `app/globals.css`; replace `app/layout.tsx`. Delete `app/page.tsx` (replaced by the catch-all in Task 9).

**Interfaces:** Produces the global CSS variables (`--bg`, `--text`, `--accent`, `--turtle-deep`, …), `.note-prose` and `.md-*` classes that Task 9's read view and later editor PRs consume.

- [ ] **Step 1: Write `app/globals.css` (ported tokens + base + prose)**

```css
@import "tailwindcss";

/* === Papert Lab design tokens (ported verbatim from colors_and_type.css) === */
:root {
  --bg: #f5f0e6;
  --card-bg: #FAF8F3;
  --card-border: #E8E2D8;
  --text: #3D3530;
  --text-muted: #6B6358;
  --text-tertiary: #9B9488;
  --accent: #5C3A1E;
  --turtle: #7a9b7a;
  --turtle-deep: #4e6b54;
  --clay: #c2664a;
  --brass: #b8893f;
  --rule: #d6cdbc;
  --font-body: Georgia, "Times New Roman", serif;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
  --ease-out: cubic-bezier(0.25, 0.1, 0.25, 1);
}

html, body { height: 100%; margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: var(--font-body);
  font-size: 17px;
  line-height: 1.7;
  color: var(--text);
  background-color: var(--bg);
  -webkit-font-smoothing: antialiased;
  background-image:
    url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.07'/%3E%3C/svg%3E"),
    url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.04' numOctaves='5' stitchTiles='stitch' seed='2'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23p)' opacity='0.15'/%3E%3C/svg%3E");
  background-size: 256px, 512px;
  background-repeat: repeat;
}

/* === read-view prose (ported from the prototype .note-prose block) === */
.note-prose p { font-family: var(--font-body); font-size: 16px; line-height: 1.7; color: var(--text-muted); margin: 0 0 1.05em; }
.note-prose p:last-child { margin-bottom: 0; }
.note-prose a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; cursor: pointer; transition: color 160ms var(--ease-out), background 160ms var(--ease-out); border-radius: 2px; padding: 0 1px; }
.note-prose a:hover { color: var(--text); background: rgba(92,58,30,0.09); }
.note-prose a[data-missing="1"] { color: var(--clay); text-decoration-style: dotted; }
.note-prose em { font-style: italic; }
.note-prose strong { font-weight: 600; color: var(--text); }
.note-prose code { font-family: var(--font-mono); font-size: 0.9em; background: rgba(61,38,21,0.06); border-radius: 3px; padding: 0 4px; }
.note-prose h2, .note-prose h3, .note-prose h4, .note-prose h5, .note-prose h6 { font-family: var(--font-body); font-weight: 600; color: var(--text); margin: 1.5em 0 .4em; }
.note-prose h2 { font-size: 20px; } .note-prose h3 { font-size: 18px; } .note-prose h4 { font-size: 16.5px; } .note-prose h5, .note-prose h6 { font-size: 15px; }
.note-prose ul { margin: .3em 0 .9em; padding-left: 22px; }
.note-prose li { font-family: var(--font-body); font-size: 16px; line-height: 1.55; color: var(--text-muted); margin: 0 0 .25em; }
.note-prose blockquote { margin: 0 0 1em; padding-left: 14px; border-left: 3px solid var(--clay); color: var(--text-tertiary); font-style: italic; }
```

- [ ] **Step 2: Write `app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Papert Lab — Working Notes",
  description: "A densely-linked notes wiki for the Papert Lab discussion group.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Remove the default home page (replaced in Task 9)**

```bash
rm -f app/page.tsx
```

- [ ] **Step 4: Verify build, commit**

Run: `npm run build`
Expected: builds (a 404 for `/` is fine until Task 9 adds the route).

```bash
git add -A && git commit -m "feat: port Papert Lab design tokens and prose styles"
```

---

## Task 3: Supabase schema, RLS, trigger, and RPCs

**Files:** Create `supabase/migrations/0001_init.sql`. Apply via the Supabase MCP.

**Interfaces:** Produces tables `profiles`, `access_codes`, `nodes`, `links`, `node_contributors`; RPCs `search_nodes(q text)` and `save_node(p_id, p_slug, p_title, p_body, p_links)`.

- [ ] **Step 1: Write `supabase/migrations/0001_init.sql`**

```sql
-- Extensions -----------------------------------------------------------
create extension if not exists pg_trgm;

-- Identity -------------------------------------------------------------
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  created_at  timestamptz not null default now()
);

-- Access-code gate -----------------------------------------------------
create table access_codes (
  code        text primary key,
  label       text,
  max_uses    int  not null default 1,
  uses        int  not null default 0,
  active      bool not null default true,
  created_at  timestamptz not null default now()
);

-- Notes ("nodes") ------------------------------------------------------
create table nodes (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  title           text not null default '',
  body            text not null default '',
  body_text       text not null default '',
  created_by      uuid references profiles(id),
  last_edited_by  uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index nodes_title_trgm on nodes using gin (title gin_trgm_ops);
create index nodes_body_text_trgm on nodes using gin (body_text gin_trgm_ops);

-- Materialized internal links -----------------------------------------
create table links (
  id            bigint generated always as identity primary key,
  source_id     uuid not null references nodes(id) on delete cascade,
  target_id     uuid not null references nodes(id) on delete cascade,
  display_text  text,
  position      int  not null default 0
);
create index links_target on links (target_id);
create index links_source on links (source_id);

-- Author(s) ------------------------------------------------------------
create table node_contributors (
  node_id     uuid not null references nodes(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  first_at    timestamptz not null default now(),
  primary key (node_id, profile_id)
);

-- Provenance trigger ---------------------------------------------------
create or replace function set_node_meta() returns trigger
  language plpgsql security definer as $$
begin
  new.updated_at := now();
  new.last_edited_by := auth.uid();
  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end $$;
create trigger nodes_meta before insert or update on nodes
  for each row execute function set_node_meta();

-- RLS ------------------------------------------------------------------
alter table nodes enable row level security;
create policy nodes_read   on nodes for select using (true);
create policy nodes_insert on nodes for insert to authenticated with check (true);
create policy nodes_update on nodes for update to authenticated using (true) with check (true);
create policy nodes_delete on nodes for delete to authenticated using (true);

alter table links enable row level security;
create policy links_read  on links for select using (true);
create policy links_write on links for all to authenticated using (true) with check (true);

alter table node_contributors enable row level security;
create policy nc_read  on node_contributors for select using (true);
create policy nc_write on node_contributors for all to authenticated using (true) with check (true);

alter table profiles enable row level security;
create policy profiles_read       on profiles for select using (true);
create policy profiles_update_own on profiles for update to authenticated using (id = auth.uid());

alter table access_codes enable row level security;  -- no policies → only service role

-- Search RPC -----------------------------------------------------------
create or replace function search_nodes(q text)
returns table(id uuid, slug text, title text) language sql stable as $$
  select id, slug, title from nodes
  where q = '' or title ilike '%' || q || '%' or title % q
  order by similarity(title, coalesce(nullif(q,''), title)) desc, title asc
  limit 8;
$$;

-- Save RPC (used from PR④; created now) --------------------------------
create or replace function save_node(p_id uuid, p_slug text, p_title text, p_body text, p_links jsonb)
returns nodes language plpgsql security invoker as $$
declare
  v_node nodes;
  v_link jsonb;
begin
  insert into nodes (id, slug, title, body, body_text)
  values (
    coalesce(p_id, gen_random_uuid()),
    p_slug,
    coalesce(p_title, ''),
    coalesce(p_body, ''),
    regexp_replace(coalesce(p_body, ''), '[#*`>\[\]\(\)]', '', 'g')
  )
  on conflict (id) do update
    set title = excluded.title,
        body = excluded.body,
        body_text = excluded.body_text
  returning * into v_node;

  delete from links where source_id = v_node.id;
  if p_links is not null then
    for v_link in select * from jsonb_array_elements(p_links) loop
      insert into links (source_id, target_id, display_text, position)
      select v_node.id, n.id, nullif(v_link->>'display',''), coalesce((v_link->>'position')::int, 0)
      from nodes n where n.slug = v_link->>'slug';
    end loop;
  end if;

  if auth.uid() is not null then
    insert into node_contributors (node_id, profile_id)
    values (v_node.id, auth.uid()) on conflict do nothing;
  end if;

  return v_node;
end $$;
```

- [ ] **Step 2: Apply the migration via MCP**

Use tool `mcp__supabase__apply_migration` with `project_id: "npgyxxnldslmbtblqymp"`, `name: "0001_init"`, and `query:` the file contents.
Expected: success, no error.

- [ ] **Step 3: Verify tables exist**

Use tool `mcp__supabase__list_tables` with `project_id: "npgyxxnldslmbtblqymp"`, `schemas: ["public"]`, `verbose: false`.
Expected: `profiles`, `access_codes`, `nodes`, `links`, `node_contributors` present.

- [ ] **Step 4: Check security advisors**

Use tool `mcp__supabase__get_advisors` with `project_id: "npgyxxnldslmbtblqymp"`, `type: "security"`.
Expected: no RLS-disabled errors on the new tables. (`access_codes` is RLS-enabled with no policies by design.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_init.sql && git commit -m "feat: initial Supabase schema, RLS, trigger, and RPCs"
```

---

## Task 4: Seed the demo notes

**Files:** Create `supabase/seed.sql`. Apply via MCP `execute_sql`.

**Interfaces:** Produces seeded `nodes` rows (slugs `evergreen`, `transient`, `accrete`, `insight`, `spaced`, `atomic`, `linked`, `about`) that Task 9 renders.

- [ ] **Step 1: Write `supabase/seed.sql`**

```sql
insert into nodes (slug, title, body) values
('evergreen', 'Evergreen note-writing as fundamental unit of knowledge work',
$md$If you had to set one metric as a leading indicator for yourself as a knowledge worker, the best might be the number of [[evergreen]] notes written per day.

Note-writing can be a virtuosic skill, but [most people take only transient notes](transient) — a bucket for storage or scratch thought. The leverage comes from compounding: [evergreen note-writing helps insight accumulate](insight). And because [knowledge work should accrete](accrete), each note enriches the broader network.

## References

Ahrens, S. (2017). *How to Take Smart Notes.*$md$),
('transient', 'Most people take only transient notes',
$md$Much of the day-to-day thinking in creative work is simply lost, like sand castles in the tide.

Ephemerality can be useful in low-fidelity thought, but we should do our serious thinking as [[evergreen]] notes so the thinking accumulates rather than evaporates.$md$),
('accrete', 'Knowledge work should accrete',
$md$If writing is the medium of research rather than its product, then there is no reason not to work as if nothing counts except writing.

A clear, tangible purpose when you attend a seminar makes you more engaged. See [evergreen note-writing as the fundamental unit](evergreen). Over time the network of [[atomic]] notes becomes the substrate for new manuscripts.$md$),
('insight', 'Evergreen note-writing helps insight accumulate',
$md$Leaps of insight emerge from prior thought. To make that leap, partially-formed ideas must collide.

Because [[evergreen]] notes are small enough to develop in an hour, each enriches the broader network. Related: notes should be [[atomic]] and [densely linked](linked).$md$),
('spaced', 'Existing spaced repetition systems discourage evergreen notes',
$md$Though prompts in a spaced-repetition system are atomic like [[evergreen]] notes, they are in many ways *too* atomized. The form discourages incremental synthesis.

The questions float detached from meaningful context and are not [densely linked](linked). Happily, the mnemonic medium can be extended to one's personal notes.$md$),
('atomic', 'Evergreen notes should be atomic',
$md$It is best to create notes which are atomic — about a single idea. Atomicity makes notes easier to link, revise, and reuse.

It is easy to forget that the point is to link densely ([[linked]]). If a note is about many things, you cannot link to it precisely. See also [[evergreen]].$md$),
('linked', 'Evergreen notes should be densely linked',
$md$If we create a steady stream of [[atomic]], durable notes, we produce a web of ideas. The density of links is what makes that web valuable.

A folder hierarchy forces each note into one place. Dense linking lets a note participate in many lines of thought — which is how [insight accumulates](insight).$md$),
('about', 'About these notes',
$md$These are working notes for the Papert Lab discussion group — a living collection in various states of development, published in the spirit of working with the garage door up.

Unlike a blog, the notes are densely linked and meant to be read non-linearly. Start anywhere, follow a link, and let the ideas [accrete](accrete) as you wander.$md$);
```

- [ ] **Step 2: Apply the seed**

Use tool `mcp__supabase__execute_sql` with `project_id: "npgyxxnldslmbtblqymp"` and `query:` the file contents.
Expected: 8 rows inserted.

- [ ] **Step 3: Verify**

Use tool `mcp__supabase__execute_sql` with query `select slug, title from nodes order by slug;`
Expected: 8 rows including `evergreen` and `about`.

- [ ] **Step 4: Commit**

```bash
git add supabase/seed.sql && git commit -m "feat: seed evergreen-notes demo content"
```

---

## Task 5: Supabase client helpers + env

**Files:** Create `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/notes/types.ts`, `.env.local` (gitignored), `.env.example`.

**Interfaces:** Produces `createClient()` (async, server) and `createBrowserClient()` wrapper; `Note` type consumed by Task 8/9.

- [ ] **Step 1: Get the project URL + anon key**

Use tool `mcp__supabase__get_project_url` and `mcp__supabase__get_publishable_keys` (or `get_anon_key`) with `project_id: "npgyxxnldslmbtblqymp"`. Record values.

- [ ] **Step 2: Write `.env.local` and `.env.example`**

`.env.local` (real values; gitignored):
```
NEXT_PUBLIC_SUPABASE_URL=https://npgyxxnldslmbtblqymp.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon/publishable key>
```
`.env.example` (committed, placeholders):
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

- [ ] **Step 3: Write `lib/notes/types.ts`**

```ts
export type Note = {
  id: string;
  slug: string;
  title: string;
  body: string;
  body_text: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  last_edited_by: string | null;
};
```

- [ ] **Step 4: Write `lib/supabase/server.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // called from a Server Component; safe to ignore (middleware refreshes sessions)
          }
        },
      },
    }
  );
}
```

- [ ] **Step 5: Write `lib/supabase/client.ts`**

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 6: Verify build, commit**

Run: `npm run build`  Expected: builds.
```bash
git add -A && git commit -m "feat: Supabase server/browser clients and Note type"
```

---

## Task 6: Slug utilities (pure, TDD)

**Files:** Create `lib/notes/slug.ts`, `lib/notes/slug.test.ts`.

**Interfaces:** Produces `slugify(title): string`, `isReserved(slug): boolean`, `uniqueSlug(title, exists): string` used by the editor/create path in later PRs.

- [ ] **Step 1: Write the failing test — `lib/notes/slug.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { slugify, isReserved, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("lowercases, strips punctuation, hyphenates", () => {
    expect(slugify("Evergreen Notes!")).toBe("evergreen-notes");
  });
  it("trims leading/trailing hyphens", () => {
    expect(slugify("  —Hello—  ")).toBe("hello");
  });
});

describe("isReserved", () => {
  it("flags reserved words and underscore-prefixed", () => {
    expect(isReserved("login")).toBe(true);
    expect(isReserved("_next")).toBe(true);
    expect(isReserved("evergreen")).toBe(false);
  });
});

describe("uniqueSlug", () => {
  it("appends a counter on collision", () => {
    const taken = new Set(["atomic", "atomic-2"]);
    expect(uniqueSlug("Atomic", (s) => taken.has(s))).toBe("atomic-3");
  });
  it("avoids reserved bases", () => {
    expect(uniqueSlug("login", () => false)).toBe("login-2");
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm test -- slug`  Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/notes/slug.ts`**

```ts
const RESERVED = new Set(["login", "signup", "api"]);

export function slugify(title: string): string {
  return (title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function isReserved(slug: string): boolean {
  return RESERVED.has(slug) || slug.startsWith("_");
}

export function uniqueSlug(title: string, exists: (s: string) => boolean): string {
  let base = slugify(title);
  if (!base) base = "note";
  let slug = base;
  let i = 2;
  while (exists(slug) || isReserved(slug)) {
    slug = `${base}-${i++}`;
  }
  return slug;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- slug`  Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/notes/slug.ts lib/notes/slug.test.ts && git commit -m "feat: slug utilities with tests"
```

---

## Task 7: Markdown read renderer (pure, TDD)

**Files:** Create `lib/markdown/render.ts`, `lib/markdown/render.test.ts`.

**Interfaces:** Produces `renderInline(s, titles)` and `renderNoteBody(md, titles): string`. `titles` is `Record<slug, title>`. Consumed by Task 9 and the backlink/snippet code in later PRs.

- [ ] **Step 1: Write the failing test — `lib/markdown/render.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { renderNoteBody } from "./render";

const titles = { evergreen: "Evergreen notes", insight: "Insight accumulates" };

describe("renderNoteBody", () => {
  it("renders a paragraph with bold and italic", () => {
    expect(renderNoteBody("Hello **bold** and *italic*"))
      .toBe("<p>Hello <strong>bold</strong> and <em>italic</em></p>");
  });

  it("renders [[slug]] as an internal link using the live title", () => {
    expect(renderNoteBody("See [[evergreen]] now", titles))
      .toBe('<p>See <a href="/evergreen" data-slug="evergreen">Evergreen notes</a> now</p>');
  });

  it("renders [alias](slug) with the alias text", () => {
    expect(renderNoteBody("[the leverage](insight)", titles))
      .toBe('<p><a href="/insight" data-slug="insight">the leverage</a></p>');
  });

  it("marks unknown internal targets as missing", () => {
    expect(renderNoteBody("[x](ghost)", titles))
      .toBe('<p><a href="/ghost" data-slug="ghost" data-missing="1">x</a></p>');
  });

  it("renders external links in a new tab", () => {
    expect(renderNoteBody("[site](https://papertlab.org)"))
      .toBe('<p><a href="https://papertlab.org" target="_blank" rel="noopener">site</a></p>');
  });

  it("renders an h2 from a single hash (prototype mapping)", () => {
    expect(renderNoteBody("# Heading")).toBe("<h2>Heading</h2>");
  });

  it("escapes HTML in text", () => {
    expect(renderNoteBody("a < b & c")).toBe("<p>a &lt; b &amp; c</p>");
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm test -- render`  Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/markdown/render.ts`**

```ts
export type SlugTitle = Record<string, string>;

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const INLINE_RE =
  /(\[\[[^\]\n]+\]\])|(\[[^\]\n]*\]\([^)\n]*\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(`[^`\n]+`)/g;

export function renderInline(s: string, titles: SlugTitle = {}): string {
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(s))) {
    out += esc(s.slice(last, m.index));
    const tok = m[0];
    if (m[1]) {
      const slug = tok.slice(2, -2).trim();
      const title = titles[slug] ?? slug;
      out += `<a href="/${esc(slug)}" data-slug="${esc(slug)}">${esc(title)}</a>`;
    } else if (m[2]) {
      const lb = tok.indexOf("](");
      const display = tok.slice(1, lb);
      const target = tok.slice(lb + 2, -1);
      const isExternal = /^[a-z]+:\/\//i.test(target);
      if (isExternal) {
        out += `<a href="${esc(target)}" target="_blank" rel="noopener">${esc(display || target)}</a>`;
      } else if (titles[target] !== undefined) {
        out += `<a href="/${esc(target)}" data-slug="${esc(target)}">${esc(display || titles[target])}</a>`;
      } else {
        out += `<a href="/${esc(target)}" data-slug="${esc(target)}" data-missing="1">${esc(display || target)}</a>`;
      }
    } else if (m[3]) out += `<strong>${esc(tok.slice(2, -2))}</strong>`;
    else if (m[4]) out += `<em>${esc(tok.slice(1, -1))}</em>`;
    else if (m[5]) out += `<code>${esc(tok.slice(1, -1))}</code>`;
    last = INLINE_RE.lastIndex;
  }
  out += esc(s.slice(last));
  return out;
}

export function renderNoteBody(md: string, titles: SlugTitle = {}): string {
  const lines = (md || "").split("\n");
  let html = "";
  let para: string[] = [];
  let lists = 0;
  const flush = () => {
    if (para.length) { html += `<p>${renderInline(para.join(" "), titles)}</p>`; para = []; }
  };
  const closeLists = (to: number) => { while (lists > to) { html += "</ul>"; lists--; } };
  for (const ln of lines) {
    const b = ln.match(/^([ \t]*)[-*]\s+(.*)$/);
    const h = ln.match(/^(#{1,5})\s+(.*)$/);
    const q = ln.match(/^>\s+(.*)$/);
    if (b) {
      flush();
      const indent = b[1].replace(/\t/g, "  ").length;
      const level = Math.floor(indent / 2) + 1;
      while (lists < level) { html += "<ul>"; lists++; }
      closeLists(level);
      html += `<li>${renderInline(b[2], titles)}</li>`;
    } else if (h) {
      closeLists(0); flush();
      const lvl = Math.min(h[1].length + 1, 6);
      html += `<h${lvl}>${renderInline(h[2], titles)}</h${lvl}>`;
    } else if (q) {
      closeLists(0); flush();
      html += `<blockquote>${renderInline(q[1], titles)}</blockquote>`;
    } else if (ln.trim() === "") {
      closeLists(0); flush();
    } else {
      closeLists(0); para.push(ln);
    }
  }
  flush(); closeLists(0);
  return html;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- render`  Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/markdown/render.ts lib/markdown/render.test.ts && git commit -m "feat: markdown read-view renderer with slug-resolved links"
```

---

## Task 8: Note queries + edited-time formatter

**Files:** Create `lib/notes/queries.ts`, `lib/util/format.ts`, `lib/util/format.test.ts`.

**Interfaces:** Produces `getNodeBySlug(slug): Promise<Note|null>`, `getSlugTitleMap(): Promise<Record<string,string>>`, `formatEdited(iso): string`. Consumed by Task 9.

- [ ] **Step 1: Write the failing test — `lib/util/format.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { formatEdited } from "./format";

describe("formatEdited", () => {
  it("formats an ISO date as 'Mon D, YYYY'", () => {
    expect(formatEdited("2026-06-25T15:00:00Z")).toMatch(/Jun 25, 2026/);
  });
  it("returns empty string for null", () => {
    expect(formatEdited(null)).toBe("");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- format`  Expected: FAIL.

- [ ] **Step 3: Implement `lib/util/format.ts`**

```ts
export function formatEdited(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- format`  Expected: PASS (2 tests).

- [ ] **Step 5: Implement `lib/notes/queries.ts`**

```ts
import { createClient } from "@/lib/supabase/server";
import type { Note } from "./types";

export async function getNodeBySlug(slug: string): Promise<Note | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("nodes")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return (data as Note) ?? null;
}

export async function getSlugTitleMap(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase.from("nodes").select("slug,title");
  const map: Record<string, string> = {};
  (data ?? []).forEach((n: { slug: string; title: string }) => {
    map[n.slug] = n.title;
  });
  return map;
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/notes/queries.ts lib/util/format.ts lib/util/format.test.ts && git commit -m "feat: note queries and edited-time formatter"
```

---

## Task 9: Static read view route

**Files:** Create `app/[[...stack]]/page.tsx`, `app/not-found.tsx`. Create `e2e/read-view.spec.ts`.

**Interfaces:** Consumes `getNodeBySlug`, `getSlugTitleMap`, `renderNoteBody`, `formatEdited`. Produces the public read page (single column for PR①).

- [ ] **Step 1: Write `app/not-found.tsx`**

```tsx
export default function NotFound() {
  return (
    <main style={{ maxWidth: 640, margin: "80px auto", padding: "0 24px" }}>
      <h1 style={{ fontFamily: "var(--font-body)", color: "var(--text)" }}>Note not found</h1>
      <p style={{ color: "var(--text-muted)" }}>
        This note doesn’t exist yet. <a href="/evergreen" style={{ color: "var(--accent)" }}>Go home</a>.
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Write `app/[[...stack]]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getNodeBySlug, getSlugTitleMap } from "@/lib/notes/queries";
import { renderNoteBody } from "@/lib/markdown/render";
import { formatEdited } from "@/lib/util/format";

const HOME_SLUG = "evergreen";

export default async function Page({
  params,
}: {
  params: Promise<{ stack?: string[] }>;
}) {
  const { stack = [] } = await params;
  const slug = stack[stack.length - 1] ?? HOME_SLUG;
  const note = await getNodeBySlug(slug);
  if (!note) notFound();

  const titles = await getSlugTitleMap();
  const html = renderNoteBody(note.body, titles);
  const edited = formatEdited(note.updated_at);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          padding: "14px 28px",
          borderBottom: "1px solid var(--card-border)",
        }}
      >
        <a href="/" style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 19, color: "var(--text)", textDecoration: "none" }}>
          Papert Lab wiki
        </a>
        <a href="https://papertlab.org" target="_blank" rel="noopener"
           style={{ fontFamily: "var(--font-sans)", fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-tertiary)", textDecoration: "none" }}>
          Papert Lab
        </a>
      </header>

      <article style={{ maxWidth: 640, width: "100%", margin: "0 auto", padding: "40px 28px 88px", boxSizing: "border-box" }}>
        <h1 style={{ fontFamily: "var(--font-body)", fontSize: 28, fontWeight: 400, color: "var(--text)", margin: "0 0 8px", letterSpacing: "-0.01em" }}>
          {note.title || "Untitled note"}
        </h1>
        {edited && (
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 22 }}>
            last edited {edited}
          </div>
        )}
        <div className="note-prose" dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </div>
  );
}
```

- [ ] **Step 3: Write the Playwright smoke test — `e2e/read-view.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

test("home renders the evergreen note", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Evergreen note-writing");
});

test("a slug path renders that note and links resolve to titles", async ({ page }) => {
  await page.goto("/transient");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("transient notes");
  const link = page.locator('.note-prose a[data-slug="evergreen"]').first();
  await expect(link).toBeVisible();
});

test("unknown slug shows not-found", async ({ page }) => {
  await page.goto("/does-not-exist");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("not found");
});
```

- [ ] **Step 4: Run unit tests + e2e**

Run: `npm test` → Expected: all unit tests PASS.
Run (ensure `.env.local` is set): `npm run e2e` → Expected: 3 Playwright tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/ e2e/ && git commit -m "feat: public static read view by slug"
```

---

## Task 10: Deploy to Vercel + open PR

**Files:** none (config in Vercel dashboard/CLI).

- [ ] **Step 1: Deploy preview**

```bash
cd ~/papert-lab-notes
npx vercel link    # link to a Papert-Lab Vercel project (interactive — needs your Vercel login)
npx vercel env add NEXT_PUBLIC_SUPABASE_URL
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
npx vercel        # preview deploy
```
Expected: a preview URL renders `/evergreen`. (Domain `notes.papertlab.org` is bound on the production promotion in a later PR.)

- [ ] **Step 2: Push branch and open PR**

```bash
git push -u origin feat/pr1-scaffold-read-view
gh pr create --base main --title "PR①: scaffold + design system + schema + static read view" \
  --body "Implements PR① of docs/superpowers/specs/2026-06-25-papert-lab-notes-design.md.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-Review

**Spec coverage (§12.1):** scaffold ✓(T1) · design tokens+texture+prose ✓(T2) · schema+RLS+trigger+pg_trgm+RPCs ✓(T3) · seed demo nodes ✓(T4) · Supabase wiring ✓(T5) · single-note-by-slug read ✓(T9) · public read (anon RLS select) ✓(T3 policy + T9). Slug/render/format utilities (T6–8) support the read view and seed later PRs.

**Deferred to later PRs (intentionally, per §12):** stacked panes + URL state machine (PR②), auth/access-code Edge Function (PR③), CM6 editor + save path (PR④), `@`/Cmd+K autocomplete + command palette (PR⑤), backlinks + node-as-folder + nav (PR⑥), main-site backlink (PR⑦). The `save_node`/`search_nodes` RPCs exist now but are not called until PR④/⑤.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `Note` (T5) is what `getNodeBySlug` returns (T8) and the page consumes (T9). `SlugTitle`/`titles: Record<string,string>` matches between `getSlugTitleMap` (T8) and `renderNoteBody` (T7). Internal-link markdown (`[[slug]]`, `[alias](slug)`) is consistent across the renderer (T7), seed (T4), and the global constraint.

**Known risk:** `npx vercel link` (T10 S1) is interactive and needs your Vercel login — flagged, not automatable here.
