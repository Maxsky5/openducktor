import { describe, expect, test } from "bun:test";
import { HostValidationError } from "../../effect/host-errors";
import { parseListAgentSessionsForTasksInput } from "./task-command-inputs";

describe("parseListAgentSessionsForTasksInput", () => {
  test("rejects a missing repo path", () => {
    expect(() =>
      parseListAgentSessionsForTasksInput({
        taskIds: ["task-1"],
      }),
    ).toThrow("repoPath is required.");
  });

  test("rejects non-array task IDs", () => {
    expect(() =>
      parseListAgentSessionsForTasksInput({
        repoPath: "/repo",
        taskIds: "task-1",
      }),
    ).toThrow("taskIds must be an array of strings.");
  });

  test("rejects non-string task IDs with an accurate field error", () => {
    expect(() =>
      parseListAgentSessionsForTasksInput({
        repoPath: "/repo",
        taskIds: ["task-1", 2],
      }),
    ).toThrow("taskIds[1] must be a string.");
  });

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

  test("accepts an empty task ID list", () => {
    expect(
      parseListAgentSessionsForTasksInput({
        repoPath: "/repo",
        taskIds: [],
      }),
    ).toEqual({ repoPath: "/repo", taskIds: [] });
  });
});
