/**
 * Builds each isolated page entry `src/rich-content/isolated-page/page-src/<name>.ts`, with its
 * optional `<name>.css`, into one self-contained `assets/pages/<name>.html`. The page has inline JS and CSS, inline woff2 fonts,
 * and a Content Security Policy that blocks every load except inline data and runs only the page
 * script. The build fails when the output would load another file or a remote resource.
 *
 * Run `bun run build:page` in apps/mobile after a change in `page-src`.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BunPlugin } from "bun";

/**
 * The page Content Security Policy. `scriptHash` is the base64 SHA-256 hash of the page script, so
 * only that script runs. Markup that a renderer bug lets into the page, such as an `onerror`
 * attribute, cannot run script.
 */
export const pageContentSecurityPolicy = (scriptHash: string): string =>
  `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; img-src data:; font-src data:`;

const MOBILE_ROOT = path.resolve(import.meta.dir, "..");
export const PAGE_SOURCE_DIRECTORY = path.join(
  MOBILE_ROOT,
  "src/rich-content/isolated-page/page-src",
);
export const PAGE_OUTPUT_DIRECTORY = path.join(MOBILE_ROOT, "assets/pages");

const FONT_MEDIA_TYPES = new Map([
  ["woff2", "font/woff2"],
  ["woff", "font/woff"],
  ["ttf", "font/ttf"],
  ["otf", "font/otf"],
]);

const fontExtension = (url: string): string =>
  (url.split(/[?#]/, 1)[0] ?? "").split(".").at(-1)?.toLowerCase() ?? "";

/**
 * Replaces each `@font-face` source list with one inline font: the woff2 source when the list
 * has one, because every supported WebView reads woff2.
 */
export const inlineFontSources = async (css: string, directory: string): Promise<string> => {
  const fonts = [...css.matchAll(/src:([^;}]+)/g)].flatMap(([declaration, list = ""]) => {
    const sources = [
      ...list.matchAll(
        /url\(\s*["']?([^"')]+)["']?\s*\)(?:\s*format\(\s*["']?[^"')]+["']?\s*\))?/g,
      ),
    ];
    const chosen = sources.find(([, url = ""]) => fontExtension(url) === "woff2") ?? sources[0];
    const url = chosen?.[1];
    if (url === undefined || url.startsWith("data:")) return [];
    const mediaType = FONT_MEDIA_TYPES.get(fontExtension(url));
    if (mediaType === undefined) {
      throw new Error(`The page CSS uses the font ${url}, which is not woff2, woff, ttf, or otf.`);
    }
    return [{ declaration, url, mediaType }];
  });
  const inlined = await Promise.all(
    fonts.map(async (font) => ({
      ...font,
      bytes: await readFile(path.resolve(directory, font.url.split(/[?#]/, 1)[0] ?? font.url)),
    })),
  );
  let result = css;
  for (const { declaration, url, mediaType, bytes } of inlined) {
    const format =
      mediaType === "font/ttf"
        ? "truetype"
        : mediaType === "font/otf"
          ? "opentype"
          : fontExtension(url);
    result = result.replace(
      declaration,
      `src:url(data:${mediaType};base64,${bytes.toString("base64")}) format("${format}")`,
    );
  }
  return result;
};

const inlineFontsPlugin: BunPlugin = {
  name: "inline-css-fonts",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => ({
      contents: await inlineFontSources(await readFile(args.path, "utf8"), path.dirname(args.path)),
      loader: "css",
    }));
  },
};

/** Stops text inside an inline element from closing that element early. */
const escapeInline = (text: string, element: "script" | "style"): string =>
  text.replace(new RegExp(`</${element}`, "gi"), `\\x3C/${element}`).replaceAll("<!--", "\\x3C!--");

export const pageHtml = (script: string, style: string): string => {
  const inlineScript = escapeInline(script, "script");
  const scriptHash = createHash("sha256").update(inlineScript).digest("base64");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${pageContentSecurityPolicy(scriptHash)}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
    `<style>${escapeInline(style, "style")}</style>`,
    "</head>",
    "<body>",
    '<div id="root"></div>',
    `<script>${inlineScript}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
};

/**
 * Builds one page entry into its HTML text. A `<name>.css` file beside the entry is the page
 * style sheet; it can `@import` package styles, such as `katex/dist/katex.min.css`.
 */
export const buildIsolatedPage = async (entry: string): Promise<string> => {
  const styleEntry = entry.replace(/\.ts$/, ".css");
  const result = await Bun.build({
    entrypoints: (await Bun.file(styleEntry).exists()) ? [entry, styleEntry] : [entry],
    target: "browser",
    format: "iife",
    minify: true,
    splitting: false,
    sourcemap: "none",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [inlineFontsPlugin],
  });
  if (!result.success) {
    throw new Error(`The page ${entry} did not build:\n${result.logs.map(String).join("\n")}`);
  }
  const scripts = result.outputs.filter((output) => output.path.endsWith(".js"));
  const styles = result.outputs.filter((output) => output.path.endsWith(".css"));
  if (scripts.length !== 1 || scripts.length + styles.length !== result.outputs.length) {
    const files = result.outputs.map((output) => output.path).join(", ");
    throw new Error(
      `The page ${entry} must build into one script and its style sheet, but it built ${files}. Remove the import that adds a file.`,
    );
  }
  const script = await scripts[0]?.text();
  const style = (await Promise.all(styles.map((output) => output.text()))).join("\n");
  const externalUrl = /url\(\s*["']?(?!data:)([^"')]+)/.exec(style)?.[1];
  if (externalUrl !== undefined) {
    throw new Error(
      `The page ${entry} CSS loads ${externalUrl}. Pages load no file or remote resource.`,
    );
  }
  return pageHtml(script ?? "", style);
};

export type BuiltPage = { readonly name: string; readonly file: string; readonly bytes: number };

/** Builds every `<name>.ts` entry of `sourceDirectory` into `<outputDirectory>/<name>.html`. */
export const buildIsolatedPages = async (
  sourceDirectory: string,
  outputDirectory: string,
): Promise<BuiltPage[]> => {
  const entries = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"),
    )
    .map((entry) => entry.name)
    .toSorted();
  if (entries.length === 0) throw new Error(`No page entry exists in ${sourceDirectory}.`);
  await mkdir(outputDirectory, { recursive: true });
  const pages: BuiltPage[] = [];
  for (const entry of entries) {
    const name = entry.slice(0, -".ts".length);
    const html = await buildIsolatedPage(path.join(sourceDirectory, entry));
    const file = path.join(outputDirectory, `${name}.html`);
    await writeFile(file, html);
    pages.push({ name, file, bytes: Buffer.byteLength(html) });
  }
  return pages;
};

if (import.meta.main) {
  for (const page of await buildIsolatedPages(PAGE_SOURCE_DIRECTORY, PAGE_OUTPUT_DIRECTORY)) {
    console.log(
      `Built ${path.relative(MOBILE_ROOT, page.file)} (${Math.round(page.bytes / 1024)} KiB)`,
    );
  }
}
