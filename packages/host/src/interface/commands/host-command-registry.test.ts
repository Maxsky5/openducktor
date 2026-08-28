import { describe, expect, test } from "bun:test";
import { jsonValueSchema, taskCardSchema } from "@openducktor/contracts";
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

  test("preserves valid spaces in opaque path responses", () => {
    expect(parseHostCommandResponse("git_canonicalize_path", "/tmp/repo ")).toBe("/tmp/repo ");
    expect(
      parseHostCommandResponse("workspace_stage_local_attachment", {
        path: "/tmp/image.png ",
      }),
    ).toEqual({ path: "/tmp/image.png " });
  });

  test("accepts optional task fields that JSON transport omits", () => {
    const task = taskCardSchema.parse({
      createdAt: "2026-08-28T00:00:00.000Z",
      id: "task-1",
      issueType: "feature",
      parentId: undefined,
      pullRequest: undefined,
      status: "open",
      targetBranch: undefined,
      title: "Add GitHub login",
      updatedAt: "2026-08-28T00:00:00.000Z",
    });

    const response = parseHostCommandResponse("tasks_list", [task]);

    const expectedTransportValue = jsonValueSchema.parse(JSON.parse(JSON.stringify([task])));
    expect(response).toEqual(expectedTransportValue);
  });
});
