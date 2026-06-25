# Papert Lab — Working Notes

A public, densely-linked notes wiki for the [Papert Lab](https://papertlab.org) weekly
discussion group at Virginia Tech. A **mnemonic medium** in the evergreen-notes sense
(Matuschak): atomic, concept-oriented notes, densely interlinked, read non-linearly through
sliding stacked panes. A playground where lab patrons contribute notes — and, later, tools —
that augment the group's shared cognition.

- **Read** is public at `notes.papertlab.org`.
- **Write** (create / edit / delete) requires an account, gated by an access code.

## Status

Pre-implementation. The design spec lives in
[`docs/superpowers/specs/`](docs/superpowers/specs/). Implementation lands as incremental PRs.

## Stack

Next.js (App Router) · CodeMirror 6 (live-source-styling editor) · Supabase (Postgres + Auth +
Edge Functions) · Tailwind · Vercel.

## Backend

Supabase project `npgyxxnldslmbtblqymp`. The Supabase MCP server is configured at project scope
in `.mcp.json`; authenticate it with `claude /mcp` (HTTP OAuth) before running migrations.
