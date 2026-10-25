import { describe, expect, test } from "bun:test";
import { gitChangeIntentKey } from "@openducktor/frontend-core/git/model/git-change-intent";
import { discardUnavailableReason, runningFileAction } from "./git-file-row-actions";

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

describe("discardUnavailableReason", () => {
  const submodule = (diff: string) =>
    ({ file: "sub", type: "submodule", additions: 1, deletions: 1, diff }) as const;
  const oid = "0332".padEnd(40, "0");

  test("names the cause for a submodule commit and for edits inside a submodule", () => {
    expect(
      discardUnavailableReason(
        submodule(`@@ -1 +1 @@\n-Subproject commit ${oid}\n+Subproject commit ${"1".repeat(40)}\n`),
      ),
    ).toContain("Discard cannot change the commit");
    expect(
      discardUnavailableReason(
        submodule(`@@ -1 +1 @@\n-Subproject commit ${oid}\n+Subproject commit ${oid}-dirty\n`),
      ),
    ).toBe(
      "sub has edits inside the submodule. Discard them inside the submodule, for example with `git -C sub restore .`.",
    );
  });

  test("is null for a file", () => {
    expect(
      discardUnavailableReason({
        file: "a.ts",
        type: "modified",
        additions: 1,
        deletions: 1,
        diff: "@@ -1 +1 @@\n-a\n+b\n",
      }),
    ).toBeNull();
  });
});
