import { describe, expect, test } from "bun:test";
import { sessionComparisonOptions } from "./session-comparison-options";

describe("sessionComparisonOptions", () => {
  test("keeps local and remote identities plus a missing selected branch", () => {
    const options = sessionComparisonOptions(
      [
        { name: "origin/main", isCurrent: false, isRemote: false },
        { name: "origin/main", isCurrent: false, isRemote: true },
      ],
      { branch: "missing" },
      { allowUpstream: true },
    );
    expect(options.map((option) => option.value)).toEqual([
      "refs/heads/origin/main",
      "refs/remotes/origin/main",
      "refs/heads/missing",
      "@{upstream}",
    ]);
  });

  test("marks the repository default option", () => {
    const options = sessionComparisonOptions(
      [
        { name: "main", isCurrent: true, isRemote: false },
        { name: "origin/main", isCurrent: false, isRemote: true },
      ],
      { branch: "main" },
      { defaultTarget: { remote: "origin", branch: "main" } },
    );
    expect(
      options.map(({ value, description }) => ({ value, description: description ?? null })),
    ).toEqual([
      { value: "refs/heads/main", description: "current" },
      { value: "refs/remotes/origin/main", description: "default" },
    ]);
  });

  test("leaves out the local branch that the compared directory has checked out", () => {
    const branches = [
      { name: "main", isCurrent: true, isRemote: false },
      { name: "odt/task-1", isCurrent: false, isRemote: false, worktreePath: "/wt/task-1" },
      { name: "odt/task-1", isCurrent: false, isRemote: true },
    ];
    expect(
      sessionComparisonOptions(branches, { branch: "main" }, { checkoutBranch: "odt/task-1" }).map(
        (option) => option.value,
      ),
    ).toEqual(["refs/heads/main", "refs/remotes/odt/task-1"]);
    expect(
      sessionComparisonOptions(branches, { branch: "main" }).map((option) => option.value),
    ).toContain("refs/heads/odt/task-1");
  });

  test("names the tracked upstream once, and offers it only where it applies", () => {
    const branches = [{ name: "main", isCurrent: true, isRemote: false }];
    expect(
      sessionComparisonOptions(branches, { branch: "@{upstream}" }, { allowUpstream: true }),
    ).toEqual([
      {
        value: "refs/heads/main",
        label: "main",
        secondaryLabel: "local",
        searchKeywords: ["main"],
        description: "current",
      },
      { value: "@{upstream}", label: "Tracked upstream", secondaryLabel: "selected" },
    ]);
    expect(
      sessionComparisonOptions(branches, { branch: "main" }).map((option) => option.value),
    ).toEqual(["refs/heads/main"]);
  });
});
