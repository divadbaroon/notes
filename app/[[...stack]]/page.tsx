import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMember } from "@/lib/auth";
import type { Note } from "@/lib/notes/types";
import Wiki from "@/app/wiki";

export default async function Page({
  params,
}: {
  params: Promise<{ stack?: string[] }>;
}) {
  const { stack = [] } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("nodes").select("*").order("title");
  const nodes = (data as Note[]) ?? [];

  const valid = stack.filter((s) => nodes.some((n) => n.slug === s));
  if (stack.length > 0 && valid.length === 0) notFound();

  const member = await getCurrentMember();
  return <Wiki initialNodes={nodes} initialStack={valid} member={member} />;
}
