import { describe, expect, test } from "bun:test";
import type {
  AgentSessionControlSendInput,
  AgentSessionControlStartInput,
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createAgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import type { LocalAttachmentService } from "../../application/attachments/local-attachment-service";
import { HostValidationError } from "../../effect/host-errors";
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

const controlSummary = (
  input: Pick<AgentSessionControlStartInput, "runtimeKind" | "workingDirectory" | "sessionScope">,
  externalSessionId: string,
) => ({
  externalSessionId,
  runtimeKind: input.runtimeKind,
  workingDirectory: input.workingDirectory,
  title: "Build session",
  sessionAssociation: input.sessionScope,
  startedAt: "2026-07-16T10:00:00.000Z",
  status: "idle" as const,
});

const createHarness = async (resolveAttachment?: LocalAttachmentService["resolve"]) => {
  const envelopes: AgentSessionLiveEnvelope[] = [];
  const snapshots: AgentSessionLiveSnapshot[] = [];
  const attachmentResolutions: string[] = [];
  const forks: unknown[] = [];
  const resumes: unknown[] = [];
  const sends: AgentSessionControlSendInput[] = [];
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
          sessionAssociation: input.sessionScope,
          activity: "idle",
          title: "Build session",
          startedAt: "2026-07-16T10:00:00.000Z",
          pendingApprovals: [],
          pendingQuestions: [],
          contextUsage: null,
        };
        snapshots.push(snapshot);
        return controlSummary(input, "session-1");
      }),
    resumeSession: (input) =>
      Effect.sync(() => {
        resumes.push(input);
        return controlSummary(input, input.externalSessionId);
      }),
    forkSession: (input) =>
      Effect.sync(() => {
        forks.push(input);
        return controlSummary(input, "fork-1");
      }),
    sendUserMessage: (input) =>
      Effect.sync(() => {
        sends.push(input);
        return {
          type: "user_message" as const,
          externalSessionId: input.externalSessionId,
          timestamp: "2026-07-16T10:02:00.000Z",
          messageId: "message-1",
          message: "Continue",
          parts: [{ kind: "text" as const, text: "Continue" }],
          state: "queued" as const,
        };
      }),
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
  const attachmentResolver: Pick<LocalAttachmentService, "resolve"> = {
    resolve:
      resolveAttachment ??
      ((input) =>
        Effect.sync(() => {
          attachmentResolutions.push(input.path);
          return { path: `/staged/${input.path}` };
        })),
  };
  return {
    attachmentResolutions,
    envelopes,
    forks,
    resumes,
    router: createEffectHostCommandRouter({
      handlers: createAgentSessionLiveCommandHandlers(service, attachmentResolver),
    }),
    sends,
    starts,
  };
};

describe("createAgentSessionLiveCommandHandlers", () => {
  test("parses and routes a normalized session-control command", async () => {
    const { forks, resumes, router, starts } = await createHarness();

    await expect(
      Effect.runPromise(router.invoke("agent_session_control_start", startInput)),
    ).resolves.toMatchObject({ externalSessionId: "session-1", runtimeKind: "opencode" });
    expect(starts).toEqual([startInput]);

    const sessionScope = { kind: "repository" } as const;
    const resumeInput = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
      sessionScope,
    };
    const forkInput = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree",
      parentExternalSessionId: "session-1",
      sessionScope,
      systemPrompt: "Fork it",
    };
    await expect(
      Effect.runPromise(router.invoke("agent_session_control_resume", resumeInput)),
    ).resolves.toMatchObject({ sessionAssociation: sessionScope });
    await expect(
      Effect.runPromise(router.invoke("agent_session_control_fork", forkInput)),
    ).resolves.toMatchObject({ sessionAssociation: sessionScope });
    expect(resumes).toEqual([resumeInput]);
    expect(forks).toEqual([forkInput]);
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

  test("resolves attachment paths before invoking an adapter", async () => {
    const { attachmentResolutions, router, sends } = await createHarness();
    const input = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
      sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
      parts: [
        {
          kind: "attachment" as const,
          attachment: {
            id: "attachment-1",
            path: "brief.pdf",
            name: "brief.pdf",
            kind: "pdf" as const,
            mime: "application/pdf",
          },
        },
      ],
    } satisfies AgentSessionControlSendInput;

    await Effect.runPromise(router.invoke("agent_session_control_send", input));

    expect(attachmentResolutions).toEqual(["brief.pdf"]);
    expect(sends).toEqual([
      {
        ...input,
        parts: [
          {
            kind: "attachment",
            attachment: {
              id: "attachment-1",
              path: "/staged/brief.pdf",
              name: "brief.pdf",
              kind: "pdf",
              mime: "application/pdf",
            },
          },
        ],
      },
    ]);
  });

  test("does not invoke an adapter when attachment resolution fails", async () => {
    const { router, sends } = await createHarness(() =>
      Effect.fail(
        new HostValidationError({
          field: "path",
          message: "Attachment path is not a staged local attachment.",
        }),
      ),
    );

    await expect(
      Effect.runPromise(
        router.invoke("agent_session_control_send", {
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          parts: [
            {
              kind: "attachment",
              attachment: {
                id: "attachment-1",
                path: "/etc/passwd",
                name: "passwd",
                kind: "pdf",
              },
            },
          ],
        }),
      ),
    ).rejects.toThrow("Attachment path is not a staged local attachment.");
    expect(sends).toEqual([]);
  });
});
