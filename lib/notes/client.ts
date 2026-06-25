import { createClient } from "@/lib/supabase/client";
import type { Note } from "./types";
import { slugify, isReserved } from "./slug";
import { extractLinks } from "@/lib/markdown/render";

export async function fetchAllNodes(): Promise<Note[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("nodes").select("*").order("title");
  if (error) throw error;
  return (data as Note[]) ?? [];
}

export async function saveNode(args: {
  id: string | null;
  slug: string;
  title: string;
  body: string;
}): Promise<Note> {
  const supabase = createClient();
  const links = extractLinks(args.body);
  const { data, error } = await supabase.rpc("save_node", {
    p_id: args.id,
    p_slug: args.slug,
    p_title: args.title,
    p_body: args.body,
    p_links: links,
  });
  if (error) throw error;
  return data as Note;
}

export async function signOut(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
}

/** Mint a unique, non-reserved slug for a new title given the slugs already taken. */
export function makeSlug(title: string, existing: Set<string>): string {
  let base = slugify(title);
  if (!base) base = "note";
  let s = base;
  let i = 2;
  while (existing.has(s) || isReserved(s)) s = `${base}-${i++}`;
  return s;
}
