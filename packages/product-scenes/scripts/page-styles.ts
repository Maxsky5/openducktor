// The stylesheets of `PageScene`, for the build of a host page. A host page links the base styles
// and the styles of each scene that it shows, so a page loads only the styles of its own scenes.
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PageStyleSheet } from "../src/react/PageScene";
import { SCENE_NAMES, type SceneName } from "../src/registry";

/** The modules that hold the views of `PageScene`. */
const VIEW_MAPS = ["../src/react/page-views.ts", "../src/astro/views.ts"].map((path) =>
  fileURLToPath(new URL(path, import.meta.url)),
);

/** The base styles, which declare the order of the layers. Every page with a scene links them first. */
const BASE_STYLES = fileURLToPath(new URL("../styles/index.css", import.meta.url));

// The classic JSX runtime accepts a key after a spread, which some views use.
const transpiler = new Bun.Transpiler({
  loader: "tsx",
  tsconfig: { compilerOptions: { jsx: "react" } },
});

/** The static imports of the package in `file`, resolved, in the order of the file. */
function localImports(file: string): string[] {
  return transpiler
    .scanImports(readFileSync(file, "utf8"))
    .filter(({ path, kind }) => kind === "import-statement" && path.startsWith("."))
    .map(({ path }) => Bun.resolveSync(path, dirname(file)));
}

/**
 * The stylesheets that `entry` imports, directly or through the modules of the package that it
 * imports, in the order in which a bundler evaluates them: each import in the order of its file,
 * and the imports of a module before the module.
 */
function importedStyles(entry: string): string[] {
  const visited = new Set<string>();
  const styles: string[] = [];
  const visit = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);
    for (const target of localImports(file)) {
      if (!target.endsWith(".css")) visit(target);
      else if (!styles.includes(target)) styles.push(target);
    }
  };
  visit(entry);
  return styles;
}

/** The view module of each scene of `PageScene`, by scene name. */
function sceneViews(): Map<SceneName, string> {
  const views = new Map<SceneName, string>();
  for (const file of VIEW_MAPS.flatMap(localImports)) {
    const folder = /[/\\]scenes[/\\]([^/\\]+)[/\\]view\.tsx$/.exec(file)?.[1];
    const name = SCENE_NAMES.find((scene) => scene === folder);
    if (name) views.set(name, file);
  }
  return views;
}

/**
 * The stylesheet files of each stylesheet of `PageScene`, as absolute paths in import order:
 * `base` holds the base styles, and each scene holds the stylesheet of each part of its view,
 * without the base styles. A host bundles the files of each entry into one stylesheet.
 */
export function pageStyles(): Map<PageStyleSheet, string[]> {
  const sheets = new Map<PageStyleSheet, string[]>([["base", [BASE_STYLES]]]);
  for (const [name, view] of sceneViews()) {
    sheets.set(
      name,
      importedStyles(view).filter((file) => file !== BASE_STYLES),
    );
  }
  return sheets;
}
