import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { HostValidationError } from "../../effect/host-errors";
import {
  HOST_COMMAND_NAMES,
  HOST_COMMAND_RESPONSE_SCHEMAS,
  isHostCommandName,
  parseHostCommandName,
  parseHostCommandResponse,
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

  test("provides one named response schema for every command", () => {
    expect(Object.keys(HOST_COMMAND_RESPONSE_SCHEMAS).sort()).toEqual([...HOST_COMMAND_NAMES]);
  });

  test("rejects malformed command results at the transport boundary", () => {
    expect(parseHostCommandResponse("workspace_list", [])).toEqual([]);
    expect(() =>
      parseHostCommandResponse("workspace_list", { workspaceId: "workspace-1" }),
    ).toThrow("Host command 'workspace_list' returned an invalid response.");
  });

  test("rejects non-JSON output from response schema transforms", () => {
    const command = "workspace_list";
    const originalSchema = HOST_COMMAND_RESPONSE_SCHEMAS[command];

    Object.defineProperty(HOST_COMMAND_RESPONSE_SCHEMAS, command, {
      configurable: true,
      enumerable: true,
      value: z.string().transform(() => BigInt(1)),
      writable: true,
    });

    try {
      expect(() => parseHostCommandResponse(command, "response")).toThrow(HostValidationError);
    } finally {
      Object.defineProperty(HOST_COMMAND_RESPONSE_SCHEMAS, command, {
        configurable: true,
        enumerable: true,
        value: originalSchema,
        writable: true,
      });
    }
  });
});
