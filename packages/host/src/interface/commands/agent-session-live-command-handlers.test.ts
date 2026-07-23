import { describe, expect, test } from "bun:test";
import type {
  AgentSessionControlStartInput,
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createAgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import type { AgentSessionRuntimeAdapterPort } from "../../ports/agent-session-live-adapter-port";
import { createEffectHostCommandRouter } from "../router/host-command-router";
import { createAgentSessionLiveCommandHandlers } from "./agent-session-live-command-handlers";

const startInput: AgentSessionControlStartInput = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
  systemPrompt: "Build the feature",
};

const createHarness = async () => {
  const envelopes: AgentSessionLiveEnvelope[] = [];
  const snapshots: AgentSessionLiveSnapshot[] = [];
  const starts: AgentSessionControlStartInput[] = [];
  const adapter: AgentSessionRuntimeAdapterPort = {
    binding: { runtimeId: "runtime-1", runtimeKind: "opencode", repoPath: "/repo" },
    matches: (ref) =>
      snapshots.some((snapshot) => snapshot.ref.externalSessionId === ref.externalSessionId),
    listRetainedSnapshots: () => Effect.succeed(snapshots),
    readRetainedSnapshot: (ref) => {
      const session = snapshots.find(
        (snapshot) => snapshot.ref.externalSessionId === ref.externalSessionId,
      );
      return Effect.succeed(
        session ? { type: "live" as const, session } : { type: "missing" as const, ref },
      );
    },
    loadContext: () => Effect.succeed(null),
    replyApproval: () => Effect.void,
    replyQuestion: () => Effect.void,
    releaseRuntime: () => Effect.succeed(snapshots.map(({ ref }) => ref)),
    startSession: (input) =>
      Effect.sync(() => {
        starts.push(input);
        const snapshot: AgentSessionLiveSnapshot = {
          ref: {
            repoPath: input.repoPath,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: "session-1",
          },
          activity: "idle",
          title: "Build session",
          startedAt: "2026-07-16T10:00:00.000Z",
          pendingApprovals: [],
          pendingQuestions: [],
          contextUsage: null,
        };
        snapshots.push(snapshot);
        return {
          externalSessionId: "session-1",
          runtimeKind: "opencode" as const,
          workingDirectory: input.workingDirectory,
          title: "Build session",
          role: "build" as const,
          startedAt: snapshot.startedAt,
          status: "idle" as const,
        };
      }),
    resumeSession: () => Effect.dieMessage("unexpected resume"),
    forkSession: () => Effect.dieMessage("unexpected fork"),
    sendUserMessage: () => Effect.dieMessage("unexpected send"),
    updateSessionModel: () => Effect.dieMessage("unexpected model update"),
    stopSession: () => Effect.dieMessage("unexpected stop"),
    releaseSession: () => Effect.dieMessage("unexpected release"),
  };
  const service = createAgentSessionLiveStateService({
    adapterRegistry: createLiveSessionAdapterRegistry(),
    faultLog: () => Effect.void,
    publish: (envelope) => envelopes.push(envelope),
  });
  await Effect.runPromise(service.registerRuntimeAdapter(adapter));
  return {
    envelopes,
    router: createEffectHostCommandRouter({
      handlers: createAgentSessionLiveCommandHandlers(service),
    }),
    starts,
  };
};

describe("createAgentSessionLiveCommandHandlers", () => {
  test("parses and routes a normalized session-control command", async () => {
    const { router, starts } = await createHarness();

    await expect(
      Effect.runPromise(router.invoke("agent_session_control_start", startInput)),
    ).resolves.toMatchObject({ externalSessionId: "session-1", runtimeKind: "opencode" });
    expect(starts).toEqual([startInput]);
  });

  test("rejects native routing fields before invoking an adapter", async () => {
    const { router, starts } = await createHarness();

    await expect(
      Effect.runPromise(
        router.invoke("agent_session_control_start", {
          ...startInput,
          runtimeId: "native-runtime",
        }),
      ),
    ).rejects.toThrow();
    expect(starts).toEqual([]);
  });

  test("rejects runtime-specific policy before invoking an adapter", async () => {
    const { router, starts } = await createHarness();

    await expect(
      Effect.runPromise(
        router.invoke("agent_session_control_start", {
          ...startInput,
          runtimePolicy: { kind: "opencode" },
        }),
      ),
    ).rejects.toThrow();
    expect(starts).toEqual([]);
  });
});
