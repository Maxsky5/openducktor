import { describe, expect, mock, test } from "bun:test";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";
import { useLiveTranscriptAttachment } from "./use-live-transcript-attachment";
import type { RuntimeTranscriptSourceResolution } from "./use-runtime-transcript-source-resolution";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useLiveTranscriptAttachment>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useLiveTranscriptAttachment, initialProps);

const activeWorkspace: ActiveWorkspace = {
  workspaceId: "workspace-a",
  workspaceName: "Workspace A",
  repoPath: "/repo-a",
};

const createSource = (
  overrides: Partial<RuntimeSessionTranscriptSource> = {},
): RuntimeSessionTranscriptSource => ({
  runtimeRef: { kind: "opencode", runtimeId: "runtime-1" },
  workingDirectory: "/repo-a",
  isLive: true,
  ...overrides,
});

const resolvedSource = (
  overrides: Partial<RuntimeTranscriptSourceResolution> = {},
): RuntimeTranscriptSourceResolution => ({
  isPending: false,
  error: null,
  runtimeId: "runtime-1",
  ...overrides,
});

const createApprovalRequest = (requestId: string): AgentApprovalRequest => ({
  requestId,
  requestType: "permission_grant",
  title: "Approve permission: shell",
  summary: "Approval request for shell.",
  affectedPaths: ["*"],
  action: { name: "shell" },
  mutation: "mutating",
  supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
});

const createQuestionRequest = (requestId: string): AgentQuestionRequest => ({
  requestId,
  questions: [
    {
      header: "Choose path",
      question: "Which path should the subagent use?",
      options: [{ label: "A", description: "Path A" }],
    },
  ],
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  isOpen: true,
  activeWorkspace,
  externalSessionId: "session-1",
  source: createSource(),
  sourceResolution: resolvedSource(),
  visiblePendingApprovals: [],
  visiblePendingQuestions: [],
  attachRuntimeTranscriptSession: mock(async () => {}),
  ...overrides,
});

describe("useLiveTranscriptAttachment", () => {
  test("attaches live transcripts with the current pending requests", async () => {
    const attachRuntimeTranscriptSession = mock(async () => {});
    const pendingApproval = createApprovalRequest("approval-1");
    const pendingQuestion = createQuestionRequest("question-1");
    const harness = createHookHarness(
      createBaseArgs({
        visiblePendingApprovals: [pendingApproval],
        visiblePendingQuestions: [pendingQuestion],
        attachRuntimeTranscriptSession,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor(() => attachRuntimeTranscriptSession.mock.calls.length === 1);

      expect(attachRuntimeTranscriptSession).toHaveBeenCalledWith({
        repoPath: "/repo-a",
        externalSessionId: "session-1",
        runtimeRef: { kind: "opencode", runtimeId: "runtime-1" },
        workingDirectory: "/repo-a",
        pendingApprovals: [pendingApproval],
        pendingQuestions: [pendingQuestion],
      });
    } finally {
      await harness.unmount();
    }
  });

  test("tracks loading until the live attachment settles", async () => {
    const deferredAttach = createDeferred<void>();
    const attachRuntimeTranscriptSession = mock(async () => deferredAttach.promise);
    const harness = createHookHarness(createBaseArgs({ attachRuntimeTranscriptSession }));

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isAttachingLiveTranscript);

      await harness.run(async () => {
        deferredAttach.resolve(undefined);
        await deferredAttach.promise;
      });
      await harness.waitFor((state) => !state.isAttachingLiveTranscript);

      expect(harness.getLatest().liveTranscriptAttachError).toBeNull();
    } finally {
      deferredAttach.resolve(undefined);
      await harness.unmount();
    }
  });

  test("clears loading and reports the attach error when attachment fails", async () => {
    const attachRuntimeTranscriptSession = mock(async () => {
      throw new Error("attach unavailable");
    });
    const harness = createHookHarness(createBaseArgs({ attachRuntimeTranscriptSession }));

    try {
      await harness.mount();
      await harness.waitFor(
        (state) =>
          !state.isAttachingLiveTranscript &&
          state.liveTranscriptAttachError === "attach unavailable",
      );

      expect(attachRuntimeTranscriptSession).toHaveBeenCalledTimes(1);
      expect(harness.getLatest()).toEqual({
        isAttachingLiveTranscript: false,
        liveTranscriptAttachError: "attach unavailable",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("clears stale attach errors when retrying the same transcript", async () => {
    const retryAttach = createDeferred<void>();
    let attachCount = 0;
    const attachRuntimeTranscriptSession = mock(() => {
      attachCount += 1;
      if (attachCount === 1) {
        return Promise.reject(new Error("first attach failed"));
      }
      return retryAttach.promise;
    });
    const baseArgs = createBaseArgs({ attachRuntimeTranscriptSession });
    const harness = createHookHarness(baseArgs);

    try {
      await harness.mount();
      await harness.waitFor(
        (state) =>
          !state.isAttachingLiveTranscript &&
          state.liveTranscriptAttachError === "first attach failed",
      );

      await harness.update({ ...baseArgs, isOpen: false });
      await harness.waitFor(
        (state) => !state.isAttachingLiveTranscript && state.liveTranscriptAttachError === null,
      );

      await harness.update(baseArgs);
      await harness.waitFor(
        (state) =>
          attachRuntimeTranscriptSession.mock.calls.length === 2 &&
          state.isAttachingLiveTranscript &&
          state.liveTranscriptAttachError === null,
      );

      await harness.run(async () => {
        retryAttach.resolve(undefined);
        await retryAttach.promise;
      });
      await harness.waitFor(
        (state) => !state.isAttachingLiveTranscript && state.liveTranscriptAttachError === null,
      );
    } finally {
      retryAttach.resolve(undefined);
      await harness.unmount();
    }
  });

  test("ignores stale attachment failures after the transcript identity changes", async () => {
    const firstAttach = createDeferred<void>();
    const secondAttach = createDeferred<void>();
    let attachCount = 0;
    const attachRuntimeTranscriptSession = mock(() => {
      attachCount += 1;
      if (attachCount === 1) {
        return firstAttach.promise;
      }
      return secondAttach.promise;
    });
    const baseArgs = createBaseArgs({ attachRuntimeTranscriptSession });
    const harness = createHookHarness(baseArgs);

    try {
      await harness.mount();
      await harness.waitFor(() => attachRuntimeTranscriptSession.mock.calls.length === 1);

      await harness.update({
        ...baseArgs,
        externalSessionId: "session-2",
        source: createSource({ runtimeRef: { kind: "opencode", runtimeId: "runtime-2" } }),
        sourceResolution: resolvedSource({ runtimeId: "runtime-2" }),
      });
      await harness.waitFor(() => attachRuntimeTranscriptSession.mock.calls.length === 2);

      await harness.run(async () => {
        firstAttach.reject(new Error("old attach failed"));
        await firstAttach.promise.catch(() => undefined);
      });

      expect(harness.getLatest().liveTranscriptAttachError).toBeNull();

      await harness.run(async () => {
        secondAttach.resolve(undefined);
        await secondAttach.promise;
      });
      await harness.waitFor((state) => !state.isAttachingLiveTranscript);
      expect(harness.getLatest().liveTranscriptAttachError).toBeNull();
    } finally {
      firstAttach.resolve(undefined);
      secondAttach.resolve(undefined);
      await harness.unmount();
    }
  });
});
