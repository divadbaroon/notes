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

export type NoteListItem = { slug: string; title: string; updated_at: string };

/** All notes as lightweight {slug,title,updated_at} rows for the index/listing page. */
export async function getAllNotesList(): Promise<NoteListItem[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("nodes").select("slug,title,updated_at");
  return (data as NoteListItem[]) ?? [];
}
