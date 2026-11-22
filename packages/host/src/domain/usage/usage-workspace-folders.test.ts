import { describe, expect, test } from "bun:test";
import { usageWorkspaceFolders, workspacesWithSharedWorktrees } from "./usage-workspace-folders";

const join = (...parts: string[]) => parts.join("/");
const workspace = (workspaceId: string, worktreeBase: string) => ({
  workspaceId,
  name: workspaceId.toUpperCase(),
  repoPath: `/code/${workspaceId}`,
  worktreeBase,
});

describe("usageWorkspaceFolders", () => {
  test("gives a workspace with its own worktree folder that whole folder", () => {
    const folders = usageWorkspaceFolders([workspace("a", "/home/u/.odt/worktrees/a")], [], join);
    expect(folders).toEqual({
      workspaces: [
        {
          workspaceId: "a",
          name: "A",
          repoPath: "/code/a",
          roots: ["/code/a", "/home/u/.odt/worktrees/a"],
        },
      ],
      separateFolders: [],
    });
  });

  test("gives each workspace only the worktrees of its own tasks in a shared folder", () => {
    const folders = usageWorkspaceFolders(
      [workspace("a", "/shared"), workspace("b", "/shared"), workspace("c", "/home/c")],
      [
        {
          workspaceId: "a",
          taskId: "task-a",
          sessionDirectories: ["/shared/custom", "/shared", "/x"],
        },
        { workspaceId: "b", taskId: "task-b", sessionDirectories: [] },
        // Imported task IDs can repeat across workspaces: nobody owns that folder.
        { workspaceId: "a", taskId: "same", sessionDirectories: [] },
        { workspaceId: "b", taskId: "same", sessionDirectories: [] },
      ],
      join,
    );
    expect(folders.workspaces.map(({ roots }) => roots)).toEqual([
      ["/code/a", "/shared/task-a", "/shared/custom"],
      ["/code/b", "/shared/task-b"],
      ["/code/c", "/home/c"],
    ]);
    expect(folders.separateFolders).toEqual(["/shared", "/shared/same"]);
  });

  test("finds the workspaces whose worktree folder another one uses", () => {
    const shared = workspacesWithSharedWorktrees([
      workspace("a", "/shared/"),
      workspace("b", "/shared"),
      workspace("c", "/home/c"),
    ]);
    expect(shared.map(({ workspaceId }) => workspaceId)).toEqual(["a", "b"]);
  });
});
