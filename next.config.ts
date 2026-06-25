import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Without this, Next walks up and finds
  // ~/package-lock.json, treats the home dir as the root, and Turbopack tries to
  // watch the entire home directory (→ "Map maximum size exceeded" dev crash).
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
