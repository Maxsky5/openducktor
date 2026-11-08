import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { PAGE_VIEWS } from "../src/react/page-views";
import { pageStyles } from "./page-styles";

const file = (path: string) => fileURLToPath(new URL(path, import.meta.url));

test("has the base styles and the styles of each view of PageScene, without the base styles", () => {
  const sheets = pageStyles();
  expect(sheets.get("base")).toEqual([file("../styles/index.css")]);
  const names: string[] = [...sheets.keys()];
  expect(names.sort()).toEqual(["base", ...Object.keys(PAGE_VIEWS)].sort());
  const hero = sheets.get("hero") ?? [];
  expect(hero).toContain(file("../src/scenes/hero/view.css"));
  expect(hero).not.toContain(file("../styles/index.css"));
  expect(new Set(hero).size).toBe(hero.length);
});
