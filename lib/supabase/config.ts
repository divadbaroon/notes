// Supabase connection values. Fall back to harmless placeholders when the env vars are absent
// (e.g. a Vercel build with no Supabase configured) so `@supabase/ssr` doesn't throw "URL and
// API key are required" while prerendering pages like /login. The Supabase-backed wiki simply
// won't function without real credentials — but the app builds, and the standalone /session and
// /local pages (which use no backend) work regardless. Set the real env vars to enable Supabase.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";
