import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Nearly every Rallyz page depends on the signed-in user, so pages render
  // per request. Cache Components (Next 16's opt-in static shell) is left off.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
