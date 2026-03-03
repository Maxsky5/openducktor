import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const assetsDir = path.resolve(__dirname, "../dist/assets");
if (!existsSync(assetsDir)) {
  throw new Error(`Expected build assets directory at "${assetsDir}". Run "bun run build" first.`);
}

const assetFiles = readdirSync(assetsDir);
const expectedVendorChunks = [
  "vendor-react-",
  "vendor-ui-",
  "vendor-markdown-",
  "vendor-virtual-",
  "vendor-misc-",
];

for (const chunkPrefix of expectedVendorChunks) {
  const matchedFile = assetFiles.find(
    (fileName) => fileName.startsWith(chunkPrefix) && fileName.endsWith(".js"),
  );
  if (!matchedFile) {
    throw new Error(
      `Missing expected vendor chunk "${chunkPrefix}*.js" in ${assetsDir}. Check manualChunks mapping.`,
    );
  }
}

const indexFile = assetFiles.find(
  (fileName) => fileName.startsWith("index-") && fileName.endsWith(".js"),
);
if (!indexFile) {
  throw new Error(`Missing entry chunk "index-*.js" in ${assetsDir}.`);
}

const indexSource = readFileSync(path.join(assetsDir, indexFile), "utf8");
if (!indexSource.includes('from"./vendor-react-')) {
  throw new Error(
    `Entry chunk "${indexFile}" does not import "vendor-react-*". React vendor splitting may be broken.`,
  );
}

if (indexSource.includes("__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE")) {
  throw new Error(
    `Entry chunk "${indexFile}" still embeds React DOM internals. Move React DOM runtime to vendor-react chunk.`,
  );
}

console.log(`Chunk verification passed for ${indexFile}.`);
