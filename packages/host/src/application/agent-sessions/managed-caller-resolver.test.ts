import { describe, expect, test } from "bun:test";
import type {
  AgentSessionLiveSnapshot,
  OdtBrowserCaller,
  RuntimeKind,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { RuntimeSessionOwner } from "../../ports/workspace-session-store-port";
import {
  type CreateManagedCallerResolverInput,
  createManagedCallerResolver,
} from "./managed-caller-resolver";

type LiveLink = Pick<AgentSessionLiveSnapshot, "ref" | "parentExternalSessionId">;

const liveLink = (
  externalSessionId: string,
  parentExternalSessionId: string | undefined,
  overrides: { repoPath?: string; runtimeKind?: RuntimeKind } = {},
): LiveLink => {
  const link: LiveLink = {
    ref: {
      repoPath: overrides.repoPath ?? "/repo",
      runtimeKind: overrides.runtimeKind ?? "opencode",
      workingDirectory: "/repo/.worktrees/task-1",
      externalSessionId,
    },
  };
  if (parentExternalSessionId !== undefined) {
    link.parentExternalSessionId = parentExternalSessionId;
  }
  return link;
};

const taskOwner = (externalSessionId: string, runtimeKind: RuntimeKind = "opencode") =>
  ({
    kind: "task",
    taskId: "task-1",
    role: "qa",
    runtimeKind,
    externalSessionId,
  }) satisfies RuntimeSessionOwner;

const workspaceOwner = (externalSessionId: string, archived = false) =>
  ({
    kind: "workspace",
    sessionId: "chat-1",
    archived,
    runtimeKind: "opencode",
    externalSessionId,
  }) satisfies RuntimeSessionOwner;

const createResolver = ({
  owners = [],
  live = {},
}: {
  owners?: RuntimeSessionOwner[];
  live?: Partial<Record<RuntimeKind, LiveLink[]>>;
}) => {
  const ownerReads: unknown[] = [];
  let liveReads = 0;
  const input: CreateManagedCallerResolverInput = {
    workspaceSettings: {
      getRepoConfig: (workspaceId) =>
        workspaceId === "repo"
          ? Effect.succeed({
              workspaceId: "repo",
              workspaceName: "Repo",
              repoPath: "/repo",
              branchPrefix: "odt",
              defaultTargetBranch: { remote: "origin", branch: "main" },
              git: {},
              hooks: { postComplete: [] },
              actions: { items: [], defaultActionId: null },
              worktreeCopyPaths: [],
              promptOverrides: {},
              agentDefaults: {},
              agentStudioState: { openTaskIds: [] },
            })
          : Effect.fail(
              new HostValidationError({
                field: "workspaceId",
                message: `Workspace '${workspaceId}' is not configured.`,
              }),
            ),
    },
    workspaceSessions: {
      listRuntimeOwners: (scope) => {
        ownerReads.push(scope);
        return Effect.succeed(owners);
      },
    },
    liveSessions: {
      list: () =>
        (["opencode", "codex", "claude"] as const).map((runtimeKind) => ({
          binding: { runtimeKind },
          listSnapshots: () => {
            liveReads += 1;
            return Effect.succeed(live[runtimeKind] ?? []);
          },
        })),
    },
  };
  return {
    resolver: createManagedCallerResolver(input),
    ownerReads,
    liveReads: () => liveReads,
  };
};

const caller = (runtimeSessionId: string, runtime: RuntimeKind = "opencode"): OdtBrowserCaller => ({
  runtime,
  runtimeSessionId,
});

const resolveFailure = (
  resolver: ReturnType<typeof createResolver>["resolver"],
  input: Parameters<ReturnType<typeof createResolver>["resolver"]["resolve"]>[0],
): Promise<HostValidationError<object>> =>
  Effect.runPromise(Effect.flip(resolver.resolve(input))).then((error) => {
    if (error._tag !== "HostValidationError") {
      throw new Error(`Expected a caller failure, got ${error._tag}.`);
    }
    return error;
  });

describe("createManagedCallerResolver", () => {
  test("resolves a task agent session to its task", async () => {
    const { resolver, ownerReads, liveReads } = createResolver({
      owners: [workspaceOwner("ses_chat"), taskOwner("ses_qa")],
    });

    const owner = await Effect.runPromise(
      resolver.resolve({ workspaceId: "repo", caller: caller("ses_qa") }),
    );

    expect(owner).toEqual({
      kind: "task",
      taskId: "task-1",
      role: "qa",
      runtimeKind: "opencode",
      externalSessionId: "ses_qa",
    });
    expect(ownerReads).toEqual([{ workspaceId: "repo", repoPath: "/repo" }]);
    expect(liveReads()).toBe(0);
  });

  test("resolves an active Workspace Session to its session", async () => {
    const { resolver } = createResolver({ owners: [workspaceOwner("ses_chat")] });

    const owner = await Effect.runPromise(
      resolver.resolve({ workspaceId: "repo", caller: caller("ses_chat") }),
    );

    expect(owner).toEqual({
      kind: "workspace",
      sessionId: "chat-1",
      archived: false,
      runtimeKind: "opencode",
      externalSessionId: "ses_chat",
    });
  });

  test.each(["spec", "planner", "build", "qa"])(
    "keeps the %s role through nested subagents",
    async (role) => {
      const root = { ...taskOwner("ses_root"), role };
      const { resolver } = createResolver({
        owners: [root],
        live: {
          opencode: [
            liveLink("ses_root", undefined),
            liveLink("ses_child", "ses_root"),
            liveLink("ses_grandchild", "ses_child"),
          ],
        },
      });

      const owner = await Effect.runPromise(
        resolver.resolve({ workspaceId: "repo", caller: caller("ses_grandchild") }),
      );

      expect(owner).toEqual(root);
    },
  );

  test("follows Codex subagent threads through the Codex runtime only", async () => {
    const { resolver } = createResolver({
      owners: [taskOwner("thread-root", "codex")],
      live: {
        codex: [liveLink("thread-child", "thread-root", { runtimeKind: "codex" })],
        opencode: [liveLink("thread-other", "thread-root")],
      },
    });

    await expect(
      Effect.runPromise(
        resolver.resolve({ workspaceId: "repo", caller: caller("thread-child", "codex") }),
      ),
    ).resolves.toEqual(taskOwner("thread-root", "codex"));
    const error = await resolveFailure(resolver, {
      workspaceId: "repo",
      caller: caller("thread-other", "codex"),
    });
    expect(error.field).toBe("caller");
  });

  test("rejects a session of the same ID but another runtime kind", async () => {
    const { resolver } = createResolver({ owners: [taskOwner("shared-id", "claude")] });

    const error = await resolveFailure(resolver, {
      workspaceId: "repo",
      caller: caller("shared-id", "opencode"),
    });

    expect(error).toMatchObject({
      field: "caller",
      details: { runtime: "opencode", runtimeSessionId: "shared-id" },
    });
    expect(error.message).toBe(
      "The OpenCode session 'shared-id' does not belong to a task or an active Workspace Session of this workspace.",
    );
  });

  test("rejects an archived Workspace Session", async () => {
    const { resolver } = createResolver({ owners: [workspaceOwner("ses_chat", true)] });

    const error = await resolveFailure(resolver, {
      workspaceId: "repo",
      caller: caller("ses_chat"),
    });

    expect(error.field).toBe("caller");
    expect(error.message).toContain("belongs to an archived Workspace Session");
  });

  test("does not follow parent links of live sessions in another repository", async () => {
    const { resolver } = createResolver({
      owners: [taskOwner("ses_root")],
      live: { opencode: [liveLink("ses_child", "ses_root", { repoPath: "/other-repo" })] },
    });

    const error = await resolveFailure(resolver, {
      workspaceId: "repo",
      caller: caller("ses_child"),
    });

    expect(error.field).toBe("caller");
  });

  test("stops at a parent link cycle", async () => {
    const { resolver } = createResolver({
      live: { opencode: [liveLink("ses_a", "ses_b"), liveLink("ses_b", "ses_a")] },
    });

    const error = await resolveFailure(resolver, {
      workspaceId: "repo",
      caller: caller("ses_a"),
    });

    expect(error.field).toBe("caller");
    expect(error.message).toContain("contain a cycle");
  });

  test("rejects a root session that more than one owner claims", async () => {
    const { resolver } = createResolver({
      owners: [taskOwner("ses_root"), workspaceOwner("ses_root")],
    });

    const error = await resolveFailure(resolver, {
      workspaceId: "repo",
      caller: caller("ses_root"),
    });

    expect(error.field).toBe("caller");
    expect(error.message).toContain("more than one task or Workspace Session");
  });

  test("rejects conflicting parent links instead of selecting one root", async () => {
    const { resolver } = createResolver({
      owners: [taskOwner("root-a"), { ...taskOwner("root-b"), taskId: "task-2" }],
      live: {
        opencode: [liveLink("ses_child", "root-a"), liveLink("ses_child", "root-b")],
      },
    });

    const error = await resolveFailure(resolver, {
      workspaceId: "repo",
      caller: caller("ses_child"),
    });

    expect(error.message).toContain("conflicting session parent links");
  });

  test("rejects a nested subagent of an archived Workspace Session", async () => {
    const { resolver } = createResolver({
      owners: [workspaceOwner("ses_root", true)],
      live: { opencode: [liveLink("ses_child", "ses_root")] },
    });

    const error = await resolveFailure(resolver, {
      workspaceId: "repo",
      caller: caller("ses_child"),
    });

    expect(error.message).toContain("archived Workspace Session");
  });

  test("rejects an unknown workspace before reading session owners", async () => {
    const { resolver, ownerReads } = createResolver({ owners: [taskOwner("ses_root")] });

    const error = await resolveFailure(resolver, {
      workspaceId: "unconfigured",
      caller: caller("ses_root"),
    });

    expect(error.field).toBe("workspaceId");
    expect(ownerReads).toEqual([]);
  });
});
