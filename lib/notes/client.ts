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

/** Upload an image to the public `note-images` bucket; returns its public URL.
 *  Write access is gated by storage RLS to members (see migration 0004). */
export async function uploadImage(file: File): Promise<string> {
  const supabase = createClient();
  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${Date.now()}-${rand}.${ext}`;
  const { error } = await supabase.storage.from("note-images").upload(path, file, {
    cacheControl: "31536000",
    contentType: file.type || "image/png",
    upsert: false,
  });
  if (error) throw error;
  return supabase.storage.from("note-images").getPublicUrl(path).data.publicUrl;
}

/** Permanently delete a note (members only; gated by the delete_node RPC + RLS). */
export async function deleteNode(slug: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("delete_node", { p_slug: slug });
  if (error) throw error;
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
