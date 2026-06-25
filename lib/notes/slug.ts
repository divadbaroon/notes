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
