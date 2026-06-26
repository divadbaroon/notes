import { getAllNotesList } from "@/lib/notes/queries";
import { getCurrentMember } from "@/lib/auth";
import AllNotes from "./all-notes";

export const dynamic = "force-dynamic";

export default async function AllNotesPage() {
  const [notes, member] = await Promise.all([getAllNotesList(), getCurrentMember()]);
  return <AllNotes notes={notes} isMember={!!member} />;
}
