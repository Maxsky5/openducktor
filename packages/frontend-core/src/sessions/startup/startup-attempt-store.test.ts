import { expect, mock, test } from "bun:test";
import type {
  StartupOperationSnapshot,
  StartupOperationContext,
  WorkspaceSession,
} from "@openducktor/contracts";
import type { StartupProgressListener } from "../../connection/host-connection";
import { connectionReconnectedEvent } from "../../recovery/connection-control-events";
import { createTestHostConnection } from "../../test-support/test-client-connection";
import { createStartupAttemptStore } from "./startup-attempt-store";
import { HostInvokeError } from "@openducktor/host-client";
import { canOpenStartupSession } from "./startup-navigation";

const origin = {
  workspaceId: "workspace",
  repoPath: "/repo",
  scope: { kind: "workspace" as const },
};
const progress = (
  context: StartupOperationContext,
  revision: number,
  extra: Partial<StartupOperationSnapshot> = {},
): StartupOperationSnapshot => ({
  ...origin,
  context,
  hostInstanceId: "host",
  revision,
  phase: "running",
  steps: [],
  ownership: { state: "unknown" },
  ...extra,
});
const savedRecord = (): WorkspaceSession => ({
  id: "saved",
  runtimeKind: "codex",
  externalSessionId: "native",
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  selectedModel: null,
  roleSnapshot: null,
  generatedTitle: null,
  manualTitle: null,
  targetBranch: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
});
const preparedProgress = (
  context: StartupOperationContext,
  revision: number,
): StartupOperationSnapshot =>
  progress(context, revision, {
    phase: "completed",
    ownership: { state: "saved", target: { kind: "workspace", record: savedRecord() } },
    prepared: {
      ref: {
        repoPath: "/repo",
        runtimeKind: "codex",
        externalSessionId: "native",
        workingDirectory: "/repo",
      },
      runtimeId: "runtime",
      liveStateSequence: 1,
    },
  });
const harness = (
  preparation: Parameters<typeof createStartupAttemptStore>[1] = {
    adopt: async () => {},
    isCurrent: () => true,
    release: () => {},
  },
  instructionRequired = false,
) => {
  let listener: StartupProgressListener | null = null;
  let admit!: () => void;
  const admission = new Promise<void>((resolve) => {
    admit = resolve;
  });
  const store = createStartupAttemptStore(
    createTestHostConnection({
      subscribeStartupProgress: async (next) => {
        listener = next;
        await admission;
        return () => {};
      },
    }),
    preparation,
  );
  const id = store.begin({
    origin,
    label: "Start chat",
    presentation: "dialog",
    instructionRequired,
  });
  return {
    store,
    id,
    admit,
    event: (event: Parameters<StartupProgressListener>[0]) => listener?.(event),
  };
};

test("registers feedback before dispatch and keeps command order across a background transfer", async () => {
  const { store, id, admit } = harness();
  let dispatched = false;
  const first = store.operation(
    id,
    async (context) => {
      dispatched = true;
      return { startupProgress: progress(context, 2, { phase: "completed" }) };
    },
    { final: false },
  );
  expect(store.getAttempt(id)?.status.phase).toBe("submitting");
  expect(dispatched).toBe(false);
  admit();
  await first;
  // Workspace sessions keep their foreground presentation.
  store.continueInBackground(id);
  expect(store.getAttempt(id)?.presentation).toBe("dialog");
  await store.operation(id, async (context) => ({ startupProgress: progress(context, 1) }));
  expect(store.getAttempt(id)?.operations.map((operation) => operation.phase)).toEqual([
    "completed",
    "running",
  ]);
  store.dispose();
});

test("claims repair before observation and preserves its saved target when observation fails", async () => {
  const { store, id, admit } = harness();
  const ownership = {
    state: "saved" as const,
    target: { kind: "workspace" as const, record: savedRecord() },
  };
  store.setSaved(id, ownership);
  store.fail(id, "Preparation failed");
  store.setRecoveryActions(id, [{ kind: "repair", label: "Retry preparation", run: () => {} }]);
  const perform = mock(async () => ({}));
  const observation = mock(async () => {
    throw new Error("Reopen the workspace to observe session progress.");
  });
  const command = store.operation(id, perform, { beforeDispatch: observation });
  expect(store.getAttempt(id)?.status).toEqual({ phase: "submitting", confirmation: "current" });
  expect(store.getAttempt(id)?.recoveryActions).toBeUndefined();
  expect(observation).not.toHaveBeenCalled();
  admit();
  const failure = await command.catch((cause: unknown) => cause);
  expect(failure).toMatchObject({ message: "Reopen the workspace to observe session progress." });
  expect(perform).not.toHaveBeenCalled();
  expect(store.getAttempt(id)?.ownership).toEqual(ownership);
  expect(store.getAttempt(id)?.status).toEqual({ phase: "failed", confirmation: "current" });
  store.dispose();
});

test.each(["release", "dispose"] as const)(
  "%s during observation blocks repair dispatch and retains no attempt",
  async (release) => {
    const { store, id, admit } = harness();
    const observation = Promise.withResolvers<void>();
    const beforeDispatch = mock(() => observation.promise);
    const perform = mock(async () => ({}));
    const command = store
      .operation(id, perform, { beforeDispatch })
      .catch((cause: unknown) => cause);
    admit();
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(beforeDispatch).toHaveBeenCalledTimes(1);
      store[release](id);
      observation.resolve();
      expect(await command).toMatchObject({ message: "The session start connection changed." });
      expect(perform).not.toHaveBeenCalled();
      expect(store.getSnapshot()).toEqual([]);
    } finally {
      observation.resolve();
      await command;
      store.dispose();
    }
  },
);

test("only startup coverage loss marks outstanding work unconfirmed and host replacement releases it", async () => {
  const { store, id, admit, event } = harness();
  let context!: StartupOperationContext;
  const command = store.operation(id, async (captured) => {
    context = captured;
    return { startupProgress: progress(captured, 2) };
  });
  admit();
  await command;
  await event(connectionReconnectedEvent(true, { missedEventNames: ["run"], hostChanged: false }));
  expect(store.getAttempt(id)?.status.confirmation).toBe("current");
  await event(
    connectionReconnectedEvent(true, { missedEventNames: ["startup"], hostChanged: false }),
  );
  expect(store.getAttempt(id)?.status.confirmation).toBe("unconfirmed");
  await event({ channel: "openducktor://session-startup-progress", payload: progress(context, 1) });
  expect(store.getAttempt(id)?.status.confirmation).toBe("unconfirmed");
  await event({ channel: "openducktor://session-startup-progress", payload: progress(context, 3) });
  expect(store.getAttempt(id)?.status.confirmation).toBe("current");
  await event(connectionReconnectedEvent(false, { missedEventNames: [], hostChanged: true }));
  await event({ channel: "openducktor://session-startup-progress", payload: progress(context, 4) });
  expect(store.getSnapshot()).toEqual([]);
  store.dispose();
});

test("retains typed partial ownership after a lost event and never downgrades a saved record", async () => {
  const { store, id, admit } = harness();
  const record = { ...savedRecord(), externalSessionId: null };
  let createContext!: StartupOperationContext;
  const command = store.operation(id, async (context) => {
    createContext = context;
    throw new HostInvokeError("Preparation failed", {
      kind: "session_startup",
      startupProgress: progress(context, 2, {
        phase: "failed",
        ownership: { state: "saved", target: { kind: "workspace", record } },
      }),
    });
  });
  admit();
  try {
    await command;
  } catch {
    /* The retained trace owns this expected failure. */
  }
  expect(store.getAttempt(id)?.ownership).toEqual({
    state: "saved",
    target: { kind: "workspace", record },
  });
  await store.operation(id, async (context) => ({
    startupProgress: progress(context, 1, {
      phase: "failed",
      ownership: { state: "not_saved" },
    }),
  }));
  expect(store.getAttempt(id)?.ownership.state).toBe("saved");
  const preparedRecord = { ...record, externalSessionId: "native" };
  await store.operation(id, async (context) => ({
    startupProgress: progress(context, 1, {
      phase: "running",
      ownership: { state: "saved", target: { kind: "workspace", record: preparedRecord } },
    }),
  }));
  store.accept(
    progress(createContext, 3, {
      phase: "completed",
      ownership: { state: "saved", target: { kind: "workspace", record } },
    }),
  );
  expect(store.getAttempt(id)?.ownership).toEqual({
    state: "saved",
    target: { kind: "workspace", record: preparedRecord },
  });
  store.dispose();
});

test("records one absolute success deadline and drops expired feedback after hidden time", async () => {
  const { store, id, admit } = harness();
  const command = store.operation(id, async (context) => ({
    startupProgress: preparedProgress(context, 1),
  }));
  admit();
  await command;
  store.setPresentation(id, "notification");
  await store.complete(id);
  const deadline = store.getAttempt(id)!.status.successExpiresAt!;
  await store.complete(id);
  expect(store.getAttempt(id)?.status.successExpiresAt).toBe(deadline);
  store.expireSuccess(deadline - 1);
  expect(store.getAttempt(id)).not.toBeNull();
  store.expireSuccess(deadline + 20_000);
  expect(store.getAttempt(id)).toBeNull();
  store.dispose();
});

test("client completion waits for one owned adoption and automatic handoff requires current evidence", async () => {
  const prepared = Promise.withResolvers<void>();
  let current = true;
  const adopt = mock(() => prepared.promise);
  const { store, id, admit } = harness({ adopt, isCurrent: () => current, release: () => {} });
  try {
    let context!: StartupOperationContext;
    const command = store.operation(id, async (captured) => {
      context = captured;
      return { startupProgress: preparedProgress(captured, 1) };
    });
    admit();
    await command;
    const completion = store.complete(id);
    expect(store.isReadyForHandoff(id)).toBe(false);
    store.setWarning(id, "Session updates could not sync.");
    store.accept(preparedProgress(context, 2));
    expect(adopt).toHaveBeenCalledTimes(1);
    prepared.resolve();
    await completion;
    expect(store.isReadyForHandoff(id)).toBe(true);
    expect(store.getAttempt(id)?.error).toBe("Session updates could not sync.");
    current = false;
    expect(store.isReadyForHandoff(id)).toBe(false);
  } finally {
    prepared.resolve();
    store.dispose();
  }
});

test("an older adoption failure cannot settle or invalidate a newer operation", async () => {
  const prepared = Promise.withResolvers<void>();
  const { store, id, admit } = harness({
    adopt: () => prepared.promise,
    isCurrent: () => false,
    release: () => {},
  });
  try {
    const first = store.operation(id, async (context) => ({
      startupProgress: { ...preparedProgress(context, 1), phase: "failed" as const },
    }));
    admit();
    await first;
    const oldCompletion = store.complete(id);
    await store.operation(id, async (context) => ({
      startupProgress: progress(context, 1, { phase: "waiting" }),
    }));
    prepared.reject(new Error("Old observation released."));
    await oldCompletion;
    expect(store.getAttempt(id)?.status).toMatchObject({
      phase: "waiting",
      confirmation: "current",
    });
    expect(store.getAttempt(id)?.error).toBeUndefined();
    expect(store.isReadyForHandoff(id)).toBe(false);
  } finally {
    prepared.resolve();
    store.dispose();
  }
});

test("late action results stay in their old operation without changing a running repair", async () => {
  const { store, id, admit } = harness();
  try {
    let oldContext!: StartupOperationContext;
    const failed = store.operation(id, async (context) => {
      oldContext = context;
      return { startupProgress: { ...preparedProgress(context, 1), phase: "failed" as const } };
    });
    admit();
    await failed;
    let repairContext!: StartupOperationContext;
    await store.operation(id, async (context) => {
      repairContext = context;
      const next = preparedProgress(context, 1);
      return {
        startupProgress: {
          ...next,
          phase: "running" as const,
          prepared: { ...next.prepared!, liveStateSequence: 2 },
        },
      };
    });
    const old = preparedProgress(oldContext, 2);
    old.phase = "failed";
    old.steps = [
      {
        id: "install",
        label: "Install dependencies",
        state: "failed",
        details: [],
        action: {
          actionId: "install",
          command: "bun install",
          waitBeforeAgentStart: false,
          result: { type: "exited", exitCode: 1, signal: null, outputTail: ["Install failed."] },
        },
        failure: {
          stage: "install",
          code: "exit",
          message: "Install failed.",
          nextAction: "Fix the command.",
        },
      },
    ];
    store.accept(old);
    const current = store.getAttempt(id);
    expect(current?.status).toMatchObject({ phase: "running", confirmation: "current" });
    expect(current?.prepared?.liveStateSequence).toBe(2);
    expect(current?.error).toBeUndefined();
    expect(canOpenStartupSession(current)).toBe(false);
    expect(current?.operations.map((operation) => operation.context.operationId)).toEqual([
      oldContext.operationId,
      repairContext.operationId,
    ]);
    expect(current?.operations[0]?.steps[0]?.action?.result).toMatchObject({
      type: "exited",
      exitCode: 1,
    });
  } finally {
    store.dispose();
  }
});
