import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The OpenDucktor mark of the app, `packages/frontend/src/assets/openducktor-mark.svg`: a rubber
 * duck with a night vision visor, on the brand violet tile. The header and the link preview images
 * draw it, and `scripts/prepare-assets.ts` copies it as the favicon.
 */
export const BRAND_MARK_SVG = readFileSync(
  join(process.cwd(), "../../packages/frontend/src/assets/openducktor-mark.svg"),
  "utf8",
);
