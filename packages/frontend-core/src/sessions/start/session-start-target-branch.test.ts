import { describe, expect, test } from "bun:test";
import type { GitBranch } from "@openducktor/contracts";
import { resolveSessionStartTargetBranchChoices } from "./session-start-target-branch";

const localOnly: GitBranch[] = [
  { name: "main", isCurrent: true, isRemote: false },
  { name: "feature/login", isCurrent: false, isRemote: false },
];

const resolve = resolveSessionStartTargetBranchChoices;
const values = (branches: GitBranch[], target: Parameters<typeof resolve>[1]) =>
  resolve(branches, target).options.map((option) => option.value);

describe("resolveSessionStartTargetBranchChoices", () => {
  test("offers only existing branches when the configured target is missing", () => {
    const choices = resolve(localOnly, { remote: "origin", branch: "main" });

    expect(choices.options.map((option) => option.value)).toEqual([
      "refs/heads/main",
      "refs/heads/feature/login",
    ]);
    expect(choices.missingValue).toBe("refs/remotes/origin/main");
    expect(choices.missingMessage).toBe(
      "Target branch origin/main does not exist in this repository. Choose another target branch.",
    );
  });

  test("keeps a configured target that the repository has", () => {
    const branches: GitBranch[] = [
      ...localOnly,
      { name: "origin/main", isCurrent: false, isRemote: true },
    ];

    const choices = resolve(branches, { remote: "origin", branch: "main" });

    expect(choices.missingValue).toBeNull();
    expect(choices.missingMessage).toBeNull();
    expect(values(branches, { remote: "origin", branch: "main" })).toEqual([
      "refs/heads/main",
      "refs/heads/feature/login",
      "refs/remotes/origin/main",
    ]);
    expect(values(localOnly, { branch: "main" })).toEqual([
      "refs/heads/main",
      "refs/heads/feature/login",
    ]);
  });

  test("offers the configured target while the branch list has not loaded", () => {
    const choices = resolve([], { remote: "origin", branch: "main" });

    expect(choices.missingValue).toBeNull();
    expect(choices.options).toEqual([
      {
        value: "refs/remotes/origin/main",
        label: "origin/main",
        secondaryLabel: "configured",
        searchKeywords: ["origin", "main"],
      },
    ]);
  });

  test("keeps the tracked upstream, which names no branch", () => {
    const choices = resolve(localOnly, { branch: "@{upstream}" });

    expect(choices.missingValue).toBeNull();
    expect(choices.options.at(-1)).toMatchObject({ value: "@{upstream}", label: "@{upstream}" });
  });
});
