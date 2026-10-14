import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // HiGHS (the recovery optimiser's LP solver) loads highs.wasm from beside
  // its own loader, so it is required from node_modules, not bundled.
  serverExternalPackages: ["highs"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
