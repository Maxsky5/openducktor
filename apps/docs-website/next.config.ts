import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const withMDX = createMDX();

// The build writes complete HTML, the router payloads, and the search index to `out/`.
// Cloudflare serves these files without a Next.js server.
const config: NextConfig = {
  output: "export",
  // Each page is a folder with an `index.html`, so Cloudflare serves `/page/` without a redirect.
  trailingSlash: true,
  // Static export has no image optimizer.
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  // The dev indicator covers the brand in the top left corner.
  devIndicators: false,
  // The repository keeps its agent rules in its own AGENTS.md files, so `next dev` writes none.
  agentRules: false,
  // The product scenes ship their TypeScript and CSS sources.
  transpilePackages: ["@openducktor/product-scenes"],
  turbopack: {
    rules: {
      // Each scene links its bundled stylesheet of `public/scene-styles/`. The modules of the
      // scenes also import their own stylesheets, and Turbopack would link all of them on every
      // page, so the build reads these imports as unused text.
      "*.css": { condition: { path: /product-scenes\/src\// }, type: "raw" },
    },
  },
};

export default withMDX(config);
