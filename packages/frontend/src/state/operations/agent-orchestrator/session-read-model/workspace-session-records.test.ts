import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveSnapshot, WorkspaceSession } from "@openducktor/contracts";
import {
  emptyAgentSessionCollection,
  getAgentSession,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import {
  applyAgentSessionLiveDelta,
  buildAgentSessionLiveCollection,
} from "./agent-session-live-projection";
import {
  applyWorkspaceSessionRecords,
  workspaceSessionIdentity,
  workspaceSessionTitle,
  reconcileWorkspaceSessionTargetFaults,
  workspaceSessionTargetFaultKey,
} from "./workspace-session-records";

const record = (): WorkspaceSession => ({
  id: "workspace-session-1",
  runtimeKind: "codex",
  externalSessionId: "native-1",
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: null,
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
});
const snapshot = (entry: WorkspaceSession): AgentSessionLiveSnapshot => ({
  ref: { ...workspaceSessionIdentity(entry)!, repoPath: "/repo" },
  repositoryScope: { kind: "repository" },
  activity: "running",
  title: "Runtime title",
  startedAt: new Date(1000).toISOString(),
  pendingApprovals: [],
  pendingQuestions: [],
  pendingAsyncQuestions: [],
  contextUsage: null,
});

describe("Workspace Session records in the shared read model", () => {
  test("does not project drafts as runtime sessions or target faults", () => {
    const draft = { ...record(), externalSessionId: null };
    const collection = emptyAgentSessionCollection();
    expect(workspaceSessionIdentity(draft)).toBeNull();
    expect(applyWorkspaceSessionRecords(collection, [draft])).toBe(collection);
    expect(
      reconcileWorkspaceSessionTargetFaults(new Map(), collection, [draft], "/repo").size,
    ).toBe(0);
  });
  test("hydrates idle sessions without runtime evidence and uses durable titles", () => {
    const entry = record();
    const collection = applyWorkspaceSessionRecords(emptyAgentSessionCollection(), [entry]);
    expect(getAgentSession(collection, workspaceSessionIdentity(entry))).toMatchObject({
      status: "idle",
      title: "Untitled session",
      historyLoadState: "not_requested",
      sessionAssociation: { kind: "repository" },
    });
    expect(
      workspaceSessionTitle({ ...entry, generatedTitle: "Generated", manualTitle: "Manual" }),
    ).toBe("Manual");
    expect(workspaceSessionTitle({ ...entry, generatedTitle: "Generated" })).toBe("Generated");
  });

  test("retains loaded history when an authoritative snapshot omits the session", () => {
    const entry = record();
    let current = applyWorkspaceSessionRecords(
      buildAgentSessionLiveCollection({
        current: emptyAgentSessionCollection(),
        snapshots: [snapshot(entry)],
      }),
      [entry],
    );
    const session = getAgentSession(current, workspaceSessionIdentity(entry))!;
    current = replaceAgentSession(current, {
      ...session,
      historyLoadState: "loaded",
      pendingUserMessageStartedAt: 2000,
    });
    const projected = buildAgentSessionLiveCollection({ current, snapshots: [] });
    const retained = getAgentSession(
      applyWorkspaceSessionRecords(projected, [entry], current),
      workspaceSessionIdentity(entry),
    );
    expect(retained).toMatchObject({
      status: "idle",
      livePresence: "absent",
      historyLoadState: "loaded",
      pendingUserMessageStartedAt: undefined,
    });
    expect(retained?.messages).toBe(session.messages);
  });

  test("durable model wins while a null record can use the live model without writing", () => {
    const entry = record();
    const live = {
      ...snapshot(entry),
      model: { runtimeKind: "codex" as const, providerId: "openai", modelId: "live" },
    };
    const current = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      snapshots: [live],
    });
    expect(
      getAgentSession(
        applyWorkspaceSessionRecords(current, [entry]),
        workspaceSessionIdentity(entry),
      )?.selectedModel?.modelId,
    ).toBe("live");
    entry.selectedModel = { runtimeKind: "codex", providerId: "openai", modelId: "saved" };
    expect(
      getAgentSession(
        applyWorkspaceSessionRecords(current, [entry]),
        workspaceSessionIdentity(entry),
      )?.selectedModel?.modelId,
    ).toBe("saved");
    expect(entry.updatedAt).toBe(1000);
  });

  test("reports a directory mismatch without changing the stored target", () => {
    const entry = record();
    const live = snapshot(entry);
    live.ref.workingDirectory = "/other";
    const current = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      snapshots: [live],
    });
    const selected = getAgentSession(
      applyWorkspaceSessionRecords(current, [entry]),
      workspaceSessionIdentity(entry),
    );
    expect(selected?.status).toBe("idle");
    const faults = reconcileWorkspaceSessionTargetFaults(new Map(), current, [entry], "/repo");
    expect(
      faults.get(workspaceSessionTargetFaultKey("/repo", workspaceSessionIdentity(entry)!))
        ?.message,
    ).toContain("does not match stored target '/repo'");
    expect(entry.executionTarget.workingDirectory).toBe("/repo");
  });

  test("a correct snapshot clears a target fault without retaining a terminal error", () => {
    const entry = record();
    const wrong = snapshot(entry);
    wrong.ref.workingDirectory = "/other";
    const mismatched = applyWorkspaceSessionRecords(
      buildAgentSessionLiveCollection({
        current: emptyAgentSessionCollection(),
        snapshots: [wrong],
      }),
      [entry],
    );
    const faults = reconcileWorkspaceSessionTargetFaults(
      new Map([["stream-fault", { message: "Unrelated fault" }]]),
      mismatched,
      [entry],
      "/repo",
    );
    expect(faults.size).toBe(2);
    const correct = applyWorkspaceSessionRecords(
      buildAgentSessionLiveCollection({
        current: mismatched,
        snapshots: [snapshot(entry)],
      }),
      [entry],
      mismatched,
    );
    expect(getAgentSession(correct, workspaceSessionIdentity(entry))?.status).toBe("running");
    const recovered = reconcileWorkspaceSessionTargetFaults(faults, correct, [entry], "/repo");
    expect([...recovered]).toEqual([["stream-fault", { message: "Unrelated fault" }]]);
  });

  test("keeps the shared live status and approvals during metadata changes", () => {
    const entry = record();
    const initial = applyWorkspaceSessionRecords(emptyAgentSessionCollection(), [entry]);
    const live = {
      ...snapshot(entry),
      activity: "waiting_for_permission" as const,
      pendingApprovals: [
        { requestId: "approval", requestType: "command_execution" as const, title: "Run command" },
      ],
    };
    const projected = applyAgentSessionLiveDelta({
      current: initial,
      envelope: { type: "session_upsert", session: live },
    });
    const selected = getAgentSession(
      applyWorkspaceSessionRecords(projected, [{ ...entry, manualTitle: "Renamed" }]),
      workspaceSessionIdentity(entry),
    );
    expect(selected?.status).toBe("idle");
    expect(selected?.pendingApprovals).toHaveLength(1);
    expect(selected?.title).toBe("Renamed");
  });
});
