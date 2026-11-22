import { describe, expect, test } from "bun:test";
import { createUsageProjectGrouping, usageProjectLabels } from "./usage-projects";

const NO_REPOSITORIES = { fromGit: new Map<string, string>(), inferred: new Map<string, string>() };

describe("createUsageProjectGrouping", () => {
  const group = createUsageProjectGrouping(
    [
      {
        workspaceId: "odt",
        name: "OpenDucktor",
        repoPath: "/code/odt",
        roots: ["/code/odt", "/home/u/.odt/worktrees/odt"],
      },
    ],
    [],
    NO_REPOSITORIES,
  );

  test("puts a repository folder and a task worktree under their workspace", () => {
    expect(group("/code/odt/packages/host").key).toBe("workspace:odt");
    expect(group("/home/u/.odt/worktrees/odt/task-1").key).toBe("workspace:odt");
  });

  test("keeps other folders as recorded and an unknown folder apart", () => {
    expect(group("/code/odt-other")).toEqual({
      key: "path:/code/odt-other",
      workspaceName: null,
      path: "/code/odt-other",
    });
    expect(group(null).key).toBe("unknown");
  });

  test("keeps a folder without a single owner apart, also inside a repository", () => {
    const shared = createUsageProjectGrouping(
      [
        {
          workspaceId: "a",
          name: "A",
          repoPath: "/code/a",
          roots: ["/code/a", "/code/a/shared/task-a"],
        },
        {
          workspaceId: "b",
          name: "B",
          repoPath: "/code/b",
          roots: ["/code/b", "/code/a/shared/task-b"],
        },
      ],
      ["/code/a/shared", "/code/a/shared/same"],
      NO_REPOSITORIES,
    );
    expect(shared("/code/a/src").key).toBe("workspace:a");
    expect(shared("/code/a/shared/task-b/sub").key).toBe("workspace:b");
    expect(shared("/code/a/shared/other").key).toBe("path:/code/a/shared/other");
    expect(shared("/code/a/shared/same/sub").key).toBe("path:/code/a/shared/same/sub");
    expect(shared("/code/a/shared").key).toBe("path:/code/a/shared");
  });

  test("keeps a shared folder apart when it is also a repository", () => {
    const shared = createUsageProjectGrouping(
      [
        { workspaceId: "a", name: "A", repoPath: "/code/a", roots: ["/code/a", "/code/a/task-a"] },
        { workspaceId: "b", name: "B", repoPath: "/code/b", roots: ["/code/b", "/code/a/task-b"] },
      ],
      ["/code/a"],
      NO_REPOSITORIES,
    );
    expect(shared("/code/a/unclaimed").key).toBe("path:/code/a/unclaimed");
    expect(shared("/code/a/task-a/src").key).toBe("workspace:a");
    expect(shared("/code/a/task-b").key).toBe("workspace:b");
  });
});

describe("createUsageProjectGrouping with repositories", () => {
  const workspaces = [
    { workspaceId: "a", name: "A", repoPath: "/code/a", roots: ["/code/a", "/code/shared/task-a"] },
  ];

  test("puts the worktrees of one repository under it, whichever tool made them", () => {
    const group = createUsageProjectGrouping(workspaces, [], {
      fromGit: new Map([
        ["/home/u/.codex/worktrees/1f/app", "/code/app"],
        ["/home/u/.odt/worktrees/app/task-1", "/code/app"],
      ]),
      inferred: new Map([["/code/app.feat-x", "/code/app"]]),
    });
    expect(group("/home/u/.codex/worktrees/1f/app").key).toBe("path:/code/app");
    expect(group("/home/u/.odt/worktrees/app/task-1").key).toBe("path:/code/app");
    expect(group("/code/app.feat-x").key).toBe("path:/code/app");
  });

  test("shows a repository of a workspace as that workspace", () => {
    const group = createUsageProjectGrouping(workspaces, [], {
      fromGit: new Map([["/home/u/.codex/worktrees/2b/a", "/code/a"]]),
      inferred: new Map(),
    });
    expect(group("/home/u/.codex/worktrees/2b/a")).toEqual({
      key: "workspace:a",
      workspaceName: "A",
      path: null,
    });
  });

  test("prefers git over a workspace claim, and a claim over an inferred repository", () => {
    const group = createUsageProjectGrouping(workspaces, ["/code/shared"], {
      fromGit: new Map([["/code/shared/task-a", "/code/other"]]),
      inferred: new Map([
        ["/code/shared/task-a/deleted", "/code/other"],
        ["/code/shared/task-z", "/code/other"],
      ]),
    });
    expect(group("/code/shared/task-a").key).toBe("path:/code/other");
    expect(group("/code/shared/task-a/deleted").key).toBe("workspace:a");
    expect(group("/code/shared/task-z").key).toBe("path:/code/shared/task-z");
  });
});

describe("usageProjectLabels", () => {
  test("adds parent folders only to tell same-named projects apart", () => {
    const labels = usageProjectLabels([
      { key: "a", workspaceName: null, path: "/work/client/app" },
      { key: "b", workspaceName: null, path: "/work/personal/app" },
      { key: "c", workspaceName: null, path: "/work/site" },
      { key: "w", workspaceName: "OpenDucktor", path: null },
      { key: "unknown", workspaceName: null, path: null },
    ]);
    expect(Object.fromEntries(labels)).toEqual({
      a: "client/app",
      b: "personal/app",
      c: "site",
      w: "OpenDucktor",
      unknown: null,
    });
  });

  test("never shows a full path for same-named folders on different drives", () => {
    const labels = usageProjectLabels([
      { key: "path:c:/repo", workspaceName: null, path: "c:/repo" },
      { key: "path:d:/repo", workspaceName: null, path: "d:/repo" },
      { key: "path:/a/b/repo", workspaceName: null, path: "/a/b/repo" },
    ]);
    expect(Object.fromEntries(labels)).toEqual({
      "path:/a/b/repo": "b/repo",
      "path:c:/repo": "repo",
      "path:d:/repo": "repo (2)",
    });
  });

  test("numbers workspaces that share a name", () => {
    const labels = usageProjectLabels([
      { key: "workspace:2", workspaceName: "API", path: null },
      { key: "workspace:1", workspaceName: "API", path: null },
    ]);
    expect(Object.fromEntries(labels)).toEqual({ "workspace:1": "API", "workspace:2": "API (2)" });
  });

  test("never gives a number that another project already has", () => {
    const labels = usageProjectLabels([
      { key: "workspace:1", workspaceName: "API", path: null },
      { key: "workspace:2", workspaceName: "API", path: null },
      { key: "workspace:3", workspaceName: "API (2)", path: null },
      { key: "workspace:4", workspaceName: "Unknown project", path: null },
      { key: "unknown", workspaceName: null, path: null },
    ]);
    expect(Object.fromEntries(labels)).toEqual({
      "workspace:1": "API",
      "workspace:2": "API (3)",
      "workspace:3": "API (2)",
      "workspace:4": "Unknown project (2)",
      unknown: null,
    });
  });
});
