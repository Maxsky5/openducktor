import { describe, expect, test } from "bun:test";
import { HostValidationError } from "../../effect/host-errors";
import { parseListAgentSessionsForTasksInput } from "./task-command-inputs";

describe("parseListAgentSessionsForTasksInput", () => {
  test("rejects blank task IDs with a typed validation error", () => {
    expect(() =>
      parseListAgentSessionsForTasksInput({
        repoPath: "/repo",
        taskIds: ["task-1", " "],
      }),
    ).toThrow(HostValidationError);
    expect(() =>
      parseListAgentSessionsForTasksInput({
        repoPath: "/repo",
        taskIds: ["task-1", " "],
      }),
    ).toThrow("taskIds[1] is required.");
  });

  test("trims and deduplicates valid task IDs at the command boundary", () => {
    expect(
      parseListAgentSessionsForTasksInput({
        repoPath: "/repo",
        taskIds: [" task-2 ", "task-1", "task-2"],
      }),
    ).toEqual({ repoPath: "/repo", taskIds: ["task-2", "task-1"] });
  });
});
