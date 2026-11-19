// The stylesheets of `PageScene`, for the build of a host page. A host page links the base styles
// and the styles of each scene that it shows, so a page loads only the styles of its own scenes.
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PageStyleSheet } from "../src/react/PageScene";
import { SCENE_NAMES } from "../src/registry";

/** The base styles, which declare the order of the layers. Every page with a scene links them first. */
const BASE_STYLES = fileURLToPath(new URL("../styles/index.css", import.meta.url));

// The classic JSX runtime accepts a key after a spread, which some views use.
const transpiler = new Bun.Transpiler({
  loader: "tsx",
  tsconfig: { compilerOptions: { jsx: "react" } },
});

/**
 * A module that can import more modules: TypeScript, with or without JSX. A data module, such as
 * package.json, imports nothing, and the transpiler cannot read it.
 */
const SCRIPT = /\.tsx?$/;

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
      if (target.endsWith(".css")) {
        if (!styles.includes(target)) styles.push(target);
      } else if (SCRIPT.test(target)) {
        visit(target);
      }
    }
  };
  visit(entry);
  return styles;
}

/**
 * The stylesheet files of each stylesheet of `PageScene`, as absolute paths in import order:
 * `base` holds the base styles, and each scene holds the stylesheet of each part of its view,
 * without the base styles. A host bundles the files of each entry into one stylesheet.
 */
export function pageStyles(): Map<PageStyleSheet, string[]> {
  const sheets = new Map<PageStyleSheet, string[]>([["base", [BASE_STYLES]]]);
  for (const name of SCENE_NAMES) {
    const view = fileURLToPath(new URL(`../src/scenes/${name}/view.tsx`, import.meta.url));
    sheets.set(
      name,
      importedStyles(view).filter((file) => file !== BASE_STYLES),
    );
  }
  return sheets;
}
