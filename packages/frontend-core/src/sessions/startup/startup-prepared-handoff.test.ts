import { afterEach, expect, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
  StartupOperationSnapshot,
} from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import {
  adoptStartupPreparedHandoff,
  hasStartupPreparedHandoff,
  isStartupPreparedHandoffCurrent,
  observeStartupPreparation,
  registerStartupLiveSource,
  releaseStartupPreparationAttempt,
  releaseStartupPreparations,
} from "./startup-prepared-handoff";
import { hostRuntimeStatusQueryKeys } from "../../queries/host-runtime-status";
import type { HostStatusSnapshot } from "../../types/diagnostics";

const ref = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo",
  externalSessionId: "session",
};
const live: AgentSessionLiveSnapshot = {
  ref,
  activity: "idle",
  title: "Session",
  startedAt: "2026-10-26T00:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
};
const progress = (): StartupOperationSnapshot => ({
  context: { startupAttemptId: "attempt", operationId: "operation" },
  hostInstanceId: "host",
  workspaceId: "workspace",
  repoPath: "/repo",
  revision: 1,
  scope: { kind: "task", taskId: "task", role: "build" },
  phase: "completed",
  steps: [],
  ownership: { state: "not_saved" },
  prepared: { ref, runtimeId: "runtime", liveStateSequence: 10 },
});
const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) {
    releaseStartupPreparations(client);
    client.clear();
  }
});

async function setup() {
  const client = new QueryClient();
  clients.push(client);
  let receive: (envelope: AgentSessionLiveEnvelope) => void = () => {
    throw new Error("Not observed");
  };
  registerStartupLiveSource(client, {
    observeWorkspace: () => {
      throw new Error("Unexpected activity owner");
    },
    observeAgentSessionLive: async (_input, listener) => {
      receive = listener;
      listener({
        type: "snapshot",
        repoPath: "/repo",
        sequence: 5,
        sessions: [],
        messageQueues: [],
      });
      return () => {};
    },
  });
  await observeStartupPreparation(client, "/repo", "attempt");
  return { client, send: (envelope: AgentSessionLiveEnvelope) => receive(envelope) };
}

const runtimeStatus = (runtimeId: string, revision: number): HostStatusSnapshot => ({
  hostInstanceId: "host",
  mcpBridge: null,
  runtimes: [
    {
      kind: "codex",
      enabled: true,
      configuredExecutablePath: "codex",
      effectiveExecutablePath: "codex",
      version: null,
      state: "ready",
      trigger: null,
      runtimeId,
      startedAt: live.startedAt,
      updatedAt: live.startedAt,
      failure: null,
      revision,
    },
  ],
});

test.each(["continuous", "gap", "removed", "runtime"] as const)(
  "a newer receipt for the same session preserves only valid attempts after %s coverage",
  async (change) => {
    const h = await setup();
    h.client.setQueryData(hostRuntimeStatusQueryKeys.snapshot, runtimeStatus("runtime", 1));
    const old = progress();
    h.send({ type: "session_upsert", sequence: 10, session: live });
    await adoptStartupPreparedHandoff(h.client, old);
    expect(isStartupPreparedHandoffCurrent(h.client, "attempt", old.prepared!)).toBe(true);
    if (change === "gap")
      h.send({
        type: "snapshot",
        repoPath: "/repo",
        sequence: 11,
        sessions: [live],
        messageQueues: [],
        historyReplayGap: true,
      });
    else if (change === "removed") h.send({ type: "session_removed", sequence: 11, ref });
    else if (change === "runtime")
      h.client.setQueryData(hostRuntimeStatusQueryKeys.snapshot, runtimeStatus("replacement", 2));
    await observeStartupPreparation(h.client, "/repo", "new-attempt");
    h.send({ type: "session_upsert", sequence: 12, session: live });
    const next: StartupOperationSnapshot = {
      ...progress(),
      context: { startupAttemptId: "new-attempt", operationId: "new-operation" },
      prepared: {
        ref,
        runtimeId: change === "runtime" ? "replacement" : "runtime",
        liveStateSequence: 12,
      },
    };
    await adoptStartupPreparedHandoff(h.client, next);
    expect(hasStartupPreparedHandoff(h.client, ref)).toBe(true);
    expect(isStartupPreparedHandoffCurrent(h.client, "new-attempt", next.prepared!)).toBe(true);
    expect(isStartupPreparedHandoffCurrent(h.client, "attempt", old.prepared!)).toBe(
      change === "continuous",
    );
    releaseStartupPreparationAttempt(h.client, "attempt");
    expect(isStartupPreparedHandoffCurrent(h.client, "attempt", old.prepared!)).toBe(false);
    expect(isStartupPreparedHandoffCurrent(h.client, "new-attempt", next.prepared!)).toBe(true);
  },
);

test("a receipt waits for its target publication and later session activity keeps preparation ready", async () => {
  const h = await setup();
  let settled = false;
  const adopting = adoptStartupPreparedHandoff(h.client, progress()).then(() => {
    settled = true;
  });
  h.send({ type: "session_upsert", sequence: 9, session: live });
  await Promise.resolve();
  expect(settled).toBe(false);
  h.send({ type: "session_upsert", sequence: 10, session: live });
  await adopting;
  expect(hasStartupPreparedHandoff(h.client, ref)).toBe(true);
  h.send({ type: "session_upsert", sequence: 11, session: { ...live, activity: "running" } });
  expect(hasStartupPreparedHandoff(h.client, ref)).toBe(true);
});

test("a covering healthy baseline accepts the prepared target without a native command", async () => {
  const h = await setup();
  h.send({
    type: "snapshot",
    repoPath: "/repo",
    sequence: 12,
    sessions: [live],
    messageQueues: [],
  });
  await adoptStartupPreparedHandoff(h.client, progress());
  expect(hasStartupPreparedHandoff(h.client, ref)).toBe(true);
});

test.each(["removed", "omitted", "gap"] as const)(
  "late receipt cannot revive preparation after target %s",
  async (change) => {
    const h = await setup();
    h.send({ type: "session_upsert", sequence: 10, session: live });
    if (change === "removed") h.send({ type: "session_removed", sequence: 11, ref });
    else
      h.send({
        type: "snapshot",
        repoPath: "/repo",
        sequence: 11,
        sessions: change === "gap" ? [live] : [],
        messageQueues: [],
        ...(change === "gap" && { historyReplayGap: true }),
      });
    await expect(adoptStartupPreparedHandoff(h.client, progress())).rejects.toThrow(
      "could not be confirmed",
    );
    expect(hasStartupPreparedHandoff(h.client, ref)).toBe(false);
  },
);

test("owner release settles a pending handoff and cannot recreate preparation", async () => {
  const h = await setup();
  const adopting = adoptStartupPreparedHandoff(h.client, progress());
  const rejected = adopting.catch((cause: unknown) => cause);
  releaseStartupPreparations(h.client);
  expect(await rejected).toMatchObject({
    message: expect.stringContaining("could not be confirmed"),
  });
  h.send({ type: "session_upsert", sequence: 10, session: live });
  expect(hasStartupPreparedHandoff(h.client, ref)).toBe(false);
});

test("an unavailable status read keeps an already confirmed preparation", async () => {
  const h = await setup();
  h.send({ type: "session_upsert", sequence: 10, session: live });
  await adoptStartupPreparedHandoff(h.client, progress());
  h.send({
    type: "snapshot",
    repoPath: "/repo",
    sequence: 11,
    sessions: [{ ...live, statusUnavailableReason: "Status read failed" }],
    messageQueues: [],
  });
  expect(hasStartupPreparedHandoff(h.client, ref)).toBe(true);
});
