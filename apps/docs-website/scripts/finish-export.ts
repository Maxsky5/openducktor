import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { headersFile, readBuildTarget, robotsFile } from "../config/site";
import { publishedPages } from "../lib/pages";

const out = new URL("../out/", import.meta.url);

/**
 * Finds the internal links of the exported pages that open no published page or no section. Each
 * page maps its URL to its HTML. A link to a static file, such as the favicon, needs `files`.
 */
export function findBrokenLinks(pages: Map<string, string>, files: Set<string>): string[] {
  const ids = new Map<string, Set<string>>();
  for (const [path, html] of pages) {
    ids.set(path, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? "")));
  }
  const broken: string[] = [];
  for (const [path, html] of pages) {
    for (const match of html.matchAll(/<a\s[^>]*href="([^"]*)"/g)) {
      const href = match[1] ?? "";
      if (!href.startsWith("/") && !href.startsWith("#")) continue;
      const url = new URL(href.replaceAll("&amp;", "&"), `https://docs.invalid${path}`);
      const target = url.pathname;
      if (files.has(target)) continue;
      const targetIds = ids.get(target);
      if (!targetIds) {
        broken.push(`${path} links to ${href}, which is not a published page.`);
        continue;
      }
      const section = decodeURIComponent(url.hash.slice(1));
      if (section && !targetIds.has(section)) {
        broken.push(`${path} links to ${href}, but ${target} has no section "${section}".`);
      }
    }
  }
  return broken;
}

/** The package files whose license forbids the removal of their notices. */
const NOTICE_SOURCES = ["gsap/gsap-core.js", "gsap/CSSPlugin.js", "gsap/TextPlugin.js"];

/** The first legal comment (`/*! ... *\/`) of a package file. */
export function legalNotice(source: string): string {
  const notice = /\/\*![\s\S]*?\*\//.exec(source)?.[0];
  if (!notice) throw new Error("A GSAP file has no license notice. Update NOTICE_SOURCES.");
  return notice;
}

/**
 * The Next.js minifier removes every comment, including the GSAP license notices. This puts them
 * back at the start of each chunk that contains GSAP.
 */
async function restoreLegalNotices(files: string[]): Promise<number> {
  const modules = new URL("../node_modules/", import.meta.url);
  const sources = await Promise.all(
    NOTICE_SOURCES.map((path) => readFile(new URL(path, modules), "utf8")),
  );
  const banner = `${sources.map(legalNotice).join("\n")}\n`;
  const scripts = files.filter((name) => name.startsWith("/_next/static/") && name.endsWith(".js"));
  // The scan compares bytes, so only a GSAP chunk becomes text.
  const marker = Buffer.from("gsapVersions");
  const restored = await Promise.all(
    scripts.map(async (file) => {
      const url = new URL(`.${file}`, out);
      const bytes = await readFile(url);
      if (!bytes.includes(marker)) return false;
      const code = bytes.toString("utf8");
      if (!code.startsWith(banner)) await writeFile(url, banner + code);
      return true;
    }),
  );
  return restored.filter(Boolean).length;
}

/** Checks the export, then writes the Cloudflare headers and robots files for the build target. */
async function finishExport(): Promise<void> {
  const target = readBuildTarget();
  const problems: string[] = [];
  const pages = new Map<string, string>();
  const paths = publishedPages().map((page) => page.url);
  const documents = await Promise.all(
    paths.map((path) =>
      readFile(new URL(`.${path}index.html`, out), "utf8").catch(() => undefined),
    ),
  );
  paths.forEach((path, index) => {
    const html = documents[index];
    if (html === undefined || !html.includes('id="docs-title"')) {
      problems.push(`The export has no complete page for ${path}.`);
    } else {
      pages.set(path, html);
    }
  });
  // The paths of all files of the export, such as `/favicon.svg`. Folders do not count, so a
  // link to `/page` without its slash fails, because only `/page/` is a published page.
  const files = new Set(
    (await readdir(out, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map(
        (entry) =>
          `/${relative(fileURLToPath(out), join(entry.parentPath, entry.name)).split(sep).join("/")}`,
      ),
  );
  // Each page has its link preview image, such as `/og/mobile/image.png`.
  const images = paths.map((path) => `/og${path}image.png`);
  for (const required of [
    "/404.html",
    "/search-index.json",
    "/sitemap.xml",
    "/llms.txt",
    "/llms-full.txt",
    ...images,
  ]) {
    if (!files.has(required)) problems.push(`The export has no ${required}.`);
  }
  problems.push(...findBrokenLinks(pages, files));
  if (problems.length > 0) {
    throw new Error(
      `The documentation export is incomplete. Fix these problems in apps/docs-website, then run the build again. Do not publish this output.\n- ${problems.join("\n- ")}`,
    );
  }
  if ((await restoreLegalNotices([...files])) === 0) {
    throw new Error(
      "The export has no GSAP chunk. Check the demonstrations, or update restoreLegalNotices().",
    );
  }
  await writeFile(new URL("_headers", out), headersFile(target));
  await writeFile(new URL("robots.txt", out), robotsFile(target));
  console.log(`Checked ${pages.size} pages and wrote the ${target} headers and robots files.`);
}

if (import.meta.main) await finishExport();
