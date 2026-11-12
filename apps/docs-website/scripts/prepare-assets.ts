import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pageStyles } from "@openducktor/product-scenes/page-styles";
import {
  bundleAsync,
  type CustomAtRules,
  type Selector,
  transform,
  type TransformOptions,
  type Visitor,
} from "lightningcss";
import { SCENE_STYLES_DIR } from "../config/site";

const app = new URL("../", import.meta.url);
const publicDir = new URL("public/", app);
const modules = new URL("node_modules/", app);

/**
 * The browsers of the default Next.js build targets, as Lightning CSS reads them: Chrome and Edge
 * 111, Firefox 111, and Safari 16.4. The scene styles then lower the same features as the styles of
 * the page.
 */
const TARGETS = {
  chrome: 111 << 16,
  edge: 111 << 16,
  firefox: 111 << 16,
  safari: (16 << 16) | (4 << 8),
};

/** A file that a stylesheet links with `url()`, inline, so a bundled stylesheet has no other file. */
async function dataUrl(file: string): Promise<string> {
  const type = file.endsWith(".svg") ? "image/svg+xml" : undefined;
  if (!type)
    throw new Error(`Add the media type of ${file} to dataUrl() in scripts/prepare-assets.ts.`);
  return `data:${type};base64,${Buffer.from(await readFile(file)).toString("base64")}`;
}

/**
 * The rules of a scene stylesheet apply only inside the view of their scene. Two scene stylesheets
 * on one page can hold the same part stylesheet, and the second copy would otherwise override the
 * rules between the two copies. Each rule of the package starts in `:where(.stage)`, so the scope
 * goes into it: `:where([data-page-scene="hero"] .stage)`. A rule can still select an ancestor of
 * the view, such as `:where([data-theme="dark"])` on the page root, and it keeps its specificity.
 */
function scopeTo(scene: string): Visitor<CustomAtRules> {
  const stage: Selector = [
    { type: "attribute", name: "data-page-scene", operation: { operator: "equal", value: scene } },
    { type: "combinator", value: "descendant" },
    { type: "class", name: "stage" },
  ];
  const isStage = (selector: Selector) =>
    selector.length === 1 && selector[0]?.type === "class" && selector[0].name === "stage";
  /** The selector with the scope in its `:where(.stage)`, also inside `:is()`, or null. */
  const scoped = (selector: Selector): Selector | null => {
    let found = false;
    const result = selector.map((component) => {
      if (component.type !== "pseudo-class") return component;
      if (component.kind !== "where" && component.kind !== "is") return component;
      if (component.kind === "where" && component.selectors.length === 1) {
        if (isStage(component.selectors[0] ?? [])) {
          found = true;
          return { ...component, selectors: [stage] };
        }
      }
      const inner = component.selectors.map((item) => scoped(item) ?? item);
      if (inner.some((item, index) => item !== component.selectors[index])) found = true;
      return { ...component, selectors: inner };
    });
    return found ? result : null;
  };
  // Lightning CSS calls this for the selectors of each rule, not for the arguments of `:is()`.
  return {
    Selector(selector) {
      const result = scoped(selector);
      if (!result) {
        throw new Error(
          `The ${scene} scene has a rule outside :where(.stage). Scope each rule of packages/product-scenes to the stage.`,
        );
      }
      return result;
    },
  };
}

/**
 * Bundles the stylesheet files of one stylesheet of `PageScene`, with the files that they link
 * inline. The bundle starts from an entry that only imports the files, and that only Lightning CSS
 * reads.
 */
async function bundleSheet(name: string, files: string[]): Promise<string> {
  const entry = fileURLToPath(new URL(`${name}.scene-entry.css`, app));
  const imports = files.map((file) => `@import "${file.split(sep).join("/")}";`).join("\n");
  // The first pass joins the imports and removes the nesting, so the scope goes only on top rules.
  const { code, dependencies = [] } = await bundleAsync({
    filename: entry,
    targets: TARGETS,
    analyzeDependencies: true,
    resolver: { read: (file) => (file === entry ? imports : readFile(file, "utf8")) },
  });
  let css = code.toString();
  for (const dependency of dependencies) {
    if (dependency.type !== "url") continue;
    const linked = join(dirname(dependency.loc.filePath), dependency.url);
    css = css.replaceAll(dependency.placeholder, await dataUrl(linked));
  }
  const options: TransformOptions<CustomAtRules> = {
    filename: entry,
    code: Buffer.from(css),
    minify: true,
    targets: TARGETS,
  };
  if (name !== "base") options.visitor = scopeTo(name);
  return transform(options).code.toString();
}

/**
 * Bundles each stylesheet of `PageScene` with Lightning CSS, as Next.js bundles the styles of the
 * page, into `public/scene-styles/`. Each name has a hash of its content, such as
 * `hero.1a2b3c4d.css`. A page links the base stylesheet and the stylesheet of each of its scenes.
 */
async function bundleSceneStyles(): Promise<void> {
  const outdir = new URL(`${SCENE_STYLES_DIR}/`, publicDir);
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir);
  await Promise.all(
    [...pageStyles()].map(async ([name, files]) => {
      const css = await bundleSheet(name, files);
      const hash = createHash("sha256").update(css).digest("base64url").slice(0, 12);
      await writeFile(new URL(`${name}.${hash}.css`, outdir), css);
    }),
  );
}

/**
 * Writes the ignored `public/` directory from its sources: the favicon, which the header shows as
 * the brand mark, the licenses, and the scene stylesheets.
 */
export async function prepareAssets(): Promise<void> {
  await mkdir(publicDir, { recursive: true });
  const copies: [string, URL][] = [
    ["favicon.svg", new URL("../../packages/frontend/src/assets/openducktor-mark.svg", app)],
    ["space-grotesk-license.txt", new URL("@fontsource-variable/space-grotesk/LICENSE", modules)],
    ["ibm-plex-mono-license.txt", new URL("@fontsource/ibm-plex-mono/LICENSE", modules)],
    ["lucide-license.txt", new URL("lucide-react/LICENSE", modules)],
  ];
  await Promise.all([
    ...copies.map(([name, from]) => copyFile(from, new URL(name, publicDir))),
    bundleSceneStyles(),
  ]);
}

if (import.meta.main) await prepareAssets();
