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
  type CreateBrowserCallerResolverInput,
  createBrowserCallerResolver,
} from "./browser-caller-resolver";
import type { BrowserServiceError } from "./browser-service-error";

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
  const input: CreateBrowserCallerResolverInput = {
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
    resolver: createBrowserCallerResolver(input),
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
): Promise<BrowserServiceError> =>
  Effect.runPromise(Effect.flip(resolver.resolve(input))).then((error) => {
    if (error._tag !== "BrowserServiceError") {
      throw new Error(`Expected a browser failure, got ${error._tag}.`);
    }
    return error;
  });

describe("createBrowserCallerResolver", () => {
  test("resolves a task agent session to its task", async () => {
    const { resolver, ownerReads, liveReads } = createResolver({
      owners: [workspaceOwner("ses_chat"), taskOwner("ses_qa")],
    });

    const owner = await Effect.runPromise(
      resolver.resolve({ workspaceId: "repo", caller: caller("ses_qa") }),
    );

    expect(owner).toEqual({
      kind: "task",
      workspaceId: "repo",
      taskId: "task-1",
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
      kind: "workspace_session",
      workspaceId: "repo",
      sessionId: "chat-1",
    });
  });

  test("follows live parent links from a nested subagent session to its root", async () => {
    const { resolver } = createResolver({
      owners: [taskOwner("ses_root")],
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

    expect(owner).toMatchObject({ kind: "task", taskId: "task-1" });
  });

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
    ).resolves.toMatchObject({ kind: "task", taskId: "task-1" });
    const error = await resolveFailure(resolver, {
      workspaceId: "repo",
      caller: caller("thread-other", "codex"),
    });
    expect(error.code).toBe("browser_unmanaged_caller");
  });

  test("rejects a session of the same ID but another runtime kind", async () => {
    const { resolver } = createResolver({ owners: [taskOwner("shared-id", "claude")] });

    const error = await resolveFailure(resolver, {
      workspaceId: "repo",
      caller: caller("shared-id", "opencode"),
    });

    expect(error).toMatchObject({
      code: "browser_unmanaged_caller",
      details: { runtime: "opencode", runtimeSessionId: "shared-id" },
    });
    expect(error.message).toBe(
      "Browser tools need a managed OpenDucktor session. The OpenCode session 'shared-id' does not belong to a task or an active Workspace Session of this workspace.",
    );
  });

  test("rejects an archived Workspace Session", async () => {
    const { resolver } = createResolver({ owners: [workspaceOwner("ses_chat", true)] });

    const error = await resolveFailure(resolver, {
      workspaceId: "repo",
      caller: caller("ses_chat"),
    });

    expect(error.code).toBe("browser_unmanaged_caller");
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

    expect(error.code).toBe("browser_unmanaged_caller");
  });

  test("stops at a parent link cycle", async () => {
    const { resolver } = createResolver({
      live: { opencode: [liveLink("ses_a", "ses_b"), liveLink("ses_b", "ses_a")] },
    });

    const error = await resolveFailure(resolver, {
      workspaceId: "repo",
      caller: caller("ses_a"),
    });

    expect(error.code).toBe("browser_unmanaged_caller");
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

    expect(error.code).toBe("browser_unmanaged_caller");
    expect(error.message).toContain("more than one task or Workspace Session");
  });
});
