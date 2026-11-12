import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { PageStyleSheet } from "@openducktor/product-scenes/react/page";
import { SCENE_STYLES_DIR } from "@/config/site";

/**
 * The address of a bundled stylesheet of the scenes, such as `/scene-styles/hero.1a2b3c4d.css`.
 * `scripts/prepare-assets.ts` writes the files before `next dev` and `next build`. Each call reads
 * the folder, so `next dev` links the files of the last asset step.
 */
export function sceneStylesheet(sheet: PageStyleSheet): string {
  const file = readdirSync(join(process.cwd(), "public", SCENE_STYLES_DIR)).find(
    (name) => name.slice(0, name.indexOf(".")) === sheet,
  );
  if (file === undefined) {
    throw new Error(
      `public/${SCENE_STYLES_DIR}/ has no stylesheet for "${sheet}". Run \`bun scripts/prepare-assets.ts\` in apps/docs-website.`,
    );
  }
  return `/${SCENE_STYLES_DIR}/${file}`;
}
