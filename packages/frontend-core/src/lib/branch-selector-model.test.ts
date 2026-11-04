import { describe, expect, test } from "bun:test";
import type { GitBranch } from "@openducktor/contracts";
import { targetBranchOptions, toBranchSelectorOptions } from "./branch-selector-model";

describe("toBranchSelectorOptions", () => {
  test("maps branches to combobox options with source labels", () => {
    const branches: GitBranch[] = [
      { name: "main", isRemote: false, isCurrent: true },
      { name: "origin/main", isRemote: true, isCurrent: false },
    ];

    expect(toBranchSelectorOptions(branches)).toEqual([
      {
        value: "main",
        label: "main",
        secondaryLabel: "local",
        description: "current",
        searchKeywords: ["main"],
      },
      {
        value: "origin/main",
        label: "origin/main",
        secondaryLabel: "origin",
        searchKeywords: ["origin", "main"],
      },
    ]);
  });

  test("includes configured branch when missing from branch list", () => {
    const branches: GitBranch[] = [{ name: "main", isRemote: false, isCurrent: true }];

    expect(
      toBranchSelectorOptions(branches, { includeBranchNames: ["release/1.0", "main", ""] }),
    ).toEqual([
      {
        value: "main",
        label: "main",
        secondaryLabel: "local",
        description: "current",
        searchKeywords: ["main"],
      },
      {
        value: "release/1.0",
        label: "release/1.0",
        secondaryLabel: "configured",
        searchKeywords: ["release", "1.0"],
      },
    ]);
  });
});

describe("targetBranchOptions", () => {
  const branches: GitBranch[] = [{ name: "origin/main", isRemote: true, isCurrent: false }];

  test("lists only the branches without a target", () => {
    expect(targetBranchOptions(branches, null).map((option) => option.value)).toEqual([
      "refs/remotes/origin/main",
    ]);
  });

  test("keeps a saved target that the branch list lacks", () => {
    expect(targetBranchOptions(branches, { remote: "origin", branch: "release" }).at(-1)).toEqual({
      value: "refs/remotes/origin/release",
      label: "origin/release",
      secondaryLabel: "configured",
      searchKeywords: ["origin", "release"],
    });
    expect(targetBranchOptions(branches, { remote: "origin", branch: "main" })).toHaveLength(1);
  });
});
