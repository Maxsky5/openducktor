import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const publicDir = new URL("../public/", import.meta.url);

export async function prepareAssets(): Promise<void> {
  // This directory contains only generated assets. Remove retired output on every build.
  await rm(publicDir, { recursive: true, force: true });
  await mkdir(publicDir, { recursive: true });
  await copyFile(
    new URL("../artwork/space-grotesk-license.txt", import.meta.url),
    new URL("space-grotesk-license.txt", publicDir),
  );
  await copyFile(
    new URL("../artwork/ibm-plex-mono-license.txt", import.meta.url),
    new URL("ibm-plex-mono-license.txt", publicDir),
  );
  await copyFile(
    new URL("../artwork/favicon.svg", import.meta.url),
    new URL("favicon.svg", publicDir),
  );
  // The product views copy the app sidebar, so they keep the mark that the app shows.
  await copyFile(
    new URL("../../../packages/frontend/src/assets/openducktor-mark.svg", import.meta.url),
    new URL("openducktor-mark.svg", publicDir),
  );
  await copyFile(
    new URL("../artwork/lucide-license.txt", import.meta.url),
    new URL("lucide-license.txt", publicDir),
  );
  const og = await readFile(new URL("../artwork/open-graph.svg", import.meta.url));
  await sharp(og)
    .png()
    .toFile(fileURLToPath(new URL("open-graph.png", publicDir)));
}
