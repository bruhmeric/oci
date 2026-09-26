import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Deterministic trace root: `npm run build`/`npm run dev` always execute
  // from the repo root, so pin it instead of letting Turbopack infer a
  // workspace root from ancestor lockfiles (which breaks the standalone
  // layout in nested checkouts).
  turbopack: { root: process.cwd() },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
