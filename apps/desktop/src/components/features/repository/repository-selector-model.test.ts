import { describe, expect, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { toRepositorySelectorOptions } from "./repository-selector-model";

const workspace = (
  workspaceId: string,
  workspaceName: string,
  repoPath: string,
): WorkspaceRecord => ({
  workspaceId,
  workspaceName,
  repoPath,
  isActive: false,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: "/tmp/worktrees",
  effectiveWorktreeBasePath: "/tmp/worktrees",
});

describe("toRepositorySelectorOptions", () => {
  test("maps workspaces to combobox options using workspace labels", () => {
    const options = toRepositorySelectorOptions([
      workspace("openducktor", "OpenDucktor", "/Users/dev/workspace/openducktor"),
      workspace("fairnest", "Fairnest", "/Users/dev/workspace/fairnest"),
    ]);

    expect(options).toEqual([
      {
        value: "openducktor",
        label: "OpenDucktor",
        searchKeywords: ["OpenDucktor", "Users", "dev", "workspace", "openducktor"],
      },
      {
        value: "fairnest",
        label: "Fairnest",
        searchKeywords: ["Fairnest", "Users", "dev", "workspace", "fairnest"],
      },
    ]);
  });

  test("adds error metadata when repository prompt validation reports errors", () => {
    const options = toRepositorySelectorOptions(
      [
        workspace("openducktor", "OpenDucktor", "/Users/dev/workspace/openducktor"),
        workspace("fairnest", "Fairnest", "/Users/dev/workspace/fairnest"),
      ],
      {
        "/Users/dev/workspace/fairnest": 2,
      },
    );

    expect(options).toEqual([
      {
        value: "openducktor",
        label: "OpenDucktor",
        searchKeywords: ["OpenDucktor", "Users", "dev", "workspace", "openducktor"],
      },
      {
        value: "fairnest",
        label: "Fairnest",
        searchKeywords: ["Fairnest", "Users", "dev", "workspace", "fairnest"],
        accentColor: "hsl(var(--destructive))",
        secondaryLabel: "2 errors",
      },
    ]);
  });
});
