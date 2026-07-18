// Bare /discussion has no session of its own — the populated reader lives at a dated URL
// (/discussion/<date>, e.g. /discussion/7-11-26, driven by content/session-<date>-thoughts.json).
// Send visitors to the current discussion.

import { redirect } from "next/navigation";

export default function DiscussionIndex() {
  redirect("/discussion/7-11-26");
}
