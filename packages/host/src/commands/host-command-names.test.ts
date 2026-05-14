import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HOST_COMMAND_NAMES } from "./host-command-names";

const repoRoot = resolve(import.meta.dir, "../../../..");

const readTauriRegisteredCommandNames = (): string[] => {
  const registrySource = readFileSync(
    resolve(repoRoot, "apps/desktop/src-tauri/src/commands/command_registry.rs"),
    "utf8",
  );

  const commandNames = [...registrySource.matchAll(/commands(?:::[a-z_]+)+::([a-z][a-z0-9_]*)/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);

  return [...new Set(commandNames)].sort();
};

describe("HOST_COMMAND_NAMES", () => {
  test("matches the Tauri desktop command registry", () => {
    expect([...HOST_COMMAND_NAMES].sort()).toEqual(readTauriRegisteredCommandNames());
  });
});
