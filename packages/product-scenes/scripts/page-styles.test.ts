import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { SCENE_NAMES } from "../src/registry";
import { pageStyles } from "./page-styles";

const file = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The test reads the scene names from the registry, which loads no view. A view loads GSAP, and GSAP
// keeps the first window that it finds, so a view loaded before a test registers a DOM breaks the
// motion tests that run later in the same process.
test("has the base styles and the styles of each scene, without the base styles", () => {
  const sheets = pageStyles();
  expect(sheets.get("base")).toEqual([file("../styles/index.css")]);
  const names: string[] = [...sheets.keys()];
  expect(names.sort()).toEqual(["base", ...SCENE_NAMES].sort());
  const hero = sheets.get("hero") ?? [];
  expect(hero).toContain(file("../src/scenes/hero/view.css"));
  expect(hero).not.toContain(file("../styles/index.css"));
  expect(new Set(hero).size).toBe(hero.length);
});
