import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Without this, Next walks up and finds
  // ~/package-lock.json, treats the home dir as the root, and Turbopack tries to
  // watch the entire home directory (→ "Map maximum size exceeded" dev crash).
  turbopack: { root: import.meta.dirname },

  // The homepage is the reading-group app. The root "/" is otherwise handled by the
  // optional catch-all Supabase wiki (app/[[...stack]]), which needs a real database and,
  // on Vercel, doesn't reliably match the index route — so send "/" straight to /session.
  async redirects() {
    return [{ source: "/", destination: "/session", permanent: false }];
  },
};

export default nextConfig;
