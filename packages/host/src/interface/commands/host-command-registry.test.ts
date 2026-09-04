import { describe, expect, test } from "bun:test";
import {
  HOST_COMMAND_NAMES,
  isHostCommandName,
  parseHostCommandName,
} from "./host-command-registry";

describe("HOST_COMMAND_NAMES", () => {
  test("stays unique and sorted for transport validation", () => {
    const commandNames: string[] = [...HOST_COMMAND_NAMES];

    expect(commandNames).toEqual([...commandNames].sort());
    expect(new Set(commandNames).size).toBe(commandNames.length);
  });

  test("parses known commands and rejects unknown commands", () => {
    expect(isHostCommandName("tasks_list")).toBe(true);
    expect(parseHostCommandName("tasks_list")).toBe("tasks_list");
    expect(isHostCommandName("missing_command")).toBe(false);
    expect(() => parseHostCommandName("missing_command")).toThrow(
      "Unknown OpenDucktor host command: missing_command",
    );
  });
});
