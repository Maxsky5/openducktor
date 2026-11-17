import { expect, test } from "bun:test";
import { SHORTCUT_COMMANDS } from "@/features/shortcuts/catalogue";
import { buildCommandViews, groupCommandViews, searchKey } from "./settings-shortcut-model";

const labelsFound = (term: string) => {
  const views = buildCommandViews(
    SHORTCUT_COMMANDS,
    { version: 1, overrides: {} },
    "darwin",
    "electron",
  );
  return Array.from(groupCommandViews(views, "all", searchKey(term)).values())
    .flat()
    .flatMap((item) => (item.kind === "command" ? [item.command.label] : []));
};

test.each(["ctrl b", "control b", "ctrl+b", "⌃b"])("finds the macOS keys ⌃B by %s", (term) => {
  expect(labelsFound(term)).toContain("Toggle sidebar");
});

test.each(["cmd k", "command k", "⌘k"])("finds the macOS keys ⌘K by %s", (term) => {
  expect(labelsFound(term)).toContain("Toggle command palette");
});
