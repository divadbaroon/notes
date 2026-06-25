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
