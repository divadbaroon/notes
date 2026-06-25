import { createClient } from "@/lib/supabase/server";

export type Member = { userId: string; username: string };

/** The signed-in member (has a profile = redeemed a valid access code), or null. */
export async function getCurrentMember(): Promise<Member | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();
  if (!data) return null;
  return { userId: user.id, username: data.username };
}
