import { describe, expect, test } from "bun:test";
import { MAC_KEYS, PC_KEYS, steerKey } from "./replicas/keys";
import {
  COMMAND,
  COMPACT_COMMAND,
  SKILLS,
  SLASH_COMMANDS,
  SLASH_QUERY,
} from "./scenes/composer/sample";
import { importProduct } from "./test-support/product-source";

type Named = { trigger: string } | { name: string };

// SAFETY: slash-command-schemas.ts exports this command, and a missing export fails the test.
const { MANUAL_SESSION_COMPACTION_SLASH_COMMAND } = await importProduct<{
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND: {
    trigger: string;
    source: string;
    description: string;
  };
}>("packages/contracts/src/slash-command-schemas.ts");
// SAFETY: composer-autocomplete-filters.ts exports these functions, and a missing export fails the
// test.
const filters = await importProduct<{
  filterSlashCommands: <Item extends { trigger: string }>(items: Item[], query: string) => Item[];
  filterSkills: <Item extends { name: string }>(items: Item[], query: string) => Item[];
}>("packages/frontend-core/src/sessions/composer/composer-autocomplete-filters.ts");
// SAFETY: steer-shortcut.ts exports this function, and a missing export fails the test.
const { steerShortcutLabel } = await importProduct<{
  steerShortcutLabel: (applePlatform: boolean) => string;
}>("packages/frontend/src/lib/steer-shortcut.ts");

const names = (items: readonly Named[]): string[] =>
  items.map((item) => ("trigger" in item ? item.trigger : item.name));

describe("the composer copied from the app", () => {
  test("the slash menu starts with /compact of the app", () => {
    const { trigger, source: kind, description } = MANUAL_SESSION_COMPACTION_SLASH_COMMAND;
    expect({ trigger, source: kind, description }).toEqual(COMPACT_COMMAND);
  });

  test("the slash query makes the picked command the first row", () => {
    const shown = filters.filterSlashCommands([...SLASH_COMMANDS], SLASH_QUERY.slice(1));
    expect(names(shown)[0]).toBe(COMMAND);
  });

  test("the skill menu lists the skills in the order of the app", () => {
    expect(names(filters.filterSkills([...SKILLS], ""))).toEqual(names(SKILLS));
  });

  test("the queue hint shows the steer shortcut of each platform", () => {
    expect(steerKey(MAC_KEYS)).toBe(steerShortcutLabel(true));
    expect(steerKey(PC_KEYS)).toBe(steerShortcutLabel(false));
  });
});
