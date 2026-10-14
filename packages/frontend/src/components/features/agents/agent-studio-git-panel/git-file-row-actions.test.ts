import { describe, expect, test } from "bun:test";
import { gitChangeIntentKey } from "@/features/agent-studio-git";
import { runningFileAction } from "./git-file-row-actions";

const fileKey = (
  action: "stage" | "unstage" | "discard",
  group: "unstaged" | "staged",
  file: string,
) => gitChangeIntentKey({ action, group, selection: { kind: "file", filePath: file } });

describe("runningFileAction", () => {
  test("names the file action that runs now", () => {
    expect(runningFileAction("unstaged", "a.ts", fileKey("stage", "unstaged", "a.ts"))).toBe(
      "stage",
    );
    expect(runningFileAction("staged", "a.ts", fileKey("unstage", "staged", "a.ts"))).toBe(
      "unstage",
    );
    expect(runningFileAction("staged", "a.ts", fileKey("discard", "staged", "a.ts"))).toBe(
      "discard",
    );
  });

  test("is null for another file, another group, a group action, or no change", () => {
    expect(runningFileAction("unstaged", "a.ts", fileKey("stage", "unstaged", "b.ts"))).toBeNull();
    expect(runningFileAction("staged", "a.ts", fileKey("stage", "unstaged", "a.ts"))).toBeNull();
    expect(
      runningFileAction(
        "unstaged",
        "a.ts",
        gitChangeIntentKey({ action: "stage", group: "unstaged", selection: { kind: "all" } }),
      ),
    ).toBeNull();
    expect(runningFileAction("unstaged", "a.ts", null)).toBeNull();
  });
});
