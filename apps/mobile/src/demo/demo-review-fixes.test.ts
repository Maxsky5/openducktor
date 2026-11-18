import { afterEach, describe, expect, test } from "bun:test";
import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { resolveRuntimeGoalAvailability } from "@openducktor/core";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { createManualTimers } from "../test-support/manual-timers";
import { createDemoSessionAdapter } from "./demo-session-adapter";

const FIELDNOTES = { workspaceId: "fieldnotes", repoPath: "/Users/sam/code/fieldnotes" };
const lifetimes: AbortController[] = [];
afterEach(() => {
  for (const lifetime of lifetimes.splice(0)) lifetime.abort();
});

const openDemo = () => {
  const lifetime = new AbortController();
  lifetimes.push(lifetime);
  const manual = createManualTimers();
  const adapter = createDemoSessionAdapter(lifetime.signal, manual.timers);
  return { adapter, client: adapter.host.client, lifetime, ...manual };
};
type Demo = ReturnType<typeof openDemo>;

const observeLive = async (demo: Demo) => {
  const envelopes: AgentSessionLiveEnvelope[] = [];
  await demo.adapter.host.observeAgentSessionLive({ repoPath: FIELDNOTES.repoPath }, (envelope) =>
    envelopes.push(envelope),
  );
  await demo.advance(0);
  return envelopes;
};

const chatOf = async (demo: Demo, title: string) => {
  const chats = await demo.client.workspaceSessionListActive("fieldnotes");
  const chat = chats.find((candidate) => candidate.manualTitle === title);
  if (!chat?.externalSessionId) throw new Error(`The sample has no chat "${title}".`);
  const ref = {
    repoPath: FIELDNOTES.repoPath,
    runtimeKind: chat.runtimeKind,
    workingDirectory: chat.executionTarget.workingDirectory,
    externalSessionId: chat.externalSessionId,
  };
  return {
    chat,
    ref,
    target: { ...ref, sessionScope: { kind: "repository" as const, workspaceId: "fieldnotes" } },
  };
};

const taskOf = async (demo: Demo, title: string) => {
  const task = (await demo.client.tasksListAll(FIELDNOTES)).find((item) => item.title === title);
  if (!task) throw new Error(`The sample has no task "${title}".`);
  return task;
};

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z8AAAAMBAQBQ3ap3AAAAAElFTkSuQmCC";

describe("demo backend review fixes", () => {
  test("never reuses a staged asset ID after a discard", async () => {
    const demo = openDemo();
    const stage = () =>
      demo.client.taskAssetStage({
        workspaceId: "fieldnotes",
        scope: "description",
        originalName: "a.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG,
      });
    const first = await stage();
    const second = await stage();
    await demo.client.taskAssetDiscardStaged({
      workspaceId: "fieldnotes",
      assetIds: [first.assetId],
    });
    const third = await stage();
    expect(new Set([first.assetId, second.assetId, third.assetId]).size).toBe(3);
  });

  test("keeps a shared worktree on archive and forks a new worktree with the source commits", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const { chat } = await chatOf(demo, "Why do tags drop on sync?");
    const history = await demo.client.agentRuntimeLoadSessionHistory({
      repoPath: FIELDNOTES.repoPath,
      runtimeKind: "claude",
      workingDirectory: chat.executionTarget.workingDirectory,
      externalSessionId: chat.externalSessionId ?? "",
      runtimePolicy: { kind: "claude" },
      limit: 200,
    });
    const forkPoint = { messageId: history.at(-1)?.messageId ?? "" };
    await demo.client.workspaceSessionFork({
      workspaceId: "fieldnotes",
      sessionId: chat.id,
      forkPoint,
      destination: { kind: "same_folder" },
    });
    const preview = await demo.client.workspaceSessionArchivePreview({
      workspaceId: "fieldnotes",
      sessionId: chat.id,
    });
    expect(preview.sharedWith).toHaveLength(1);
    await expect(
      demo.client.workspaceSessionArchive({
        workspaceId: "fieldnotes",
        sessionId: chat.id,
        confirmStop: false,
        removeWorktree: true,
      }),
    ).rejects.toThrow("Other chats or tasks still use this worktree");

    const forked = demo.client.workspaceSessionFork({
      workspaceId: "fieldnotes",
      sessionId: chat.id,
      forkPoint,
      destination: { kind: "new_worktree", name: "tags-sync-copy", branchName: "odt/tags-copy" },
    });
    await demo.advance(5_000);
    const result = await forked;
    const status = await demo.client.gitGetWorktreeStatus(
      FIELDNOTES.repoPath,
      "refs/remotes/origin/main",
      "target",
      result.runtimeSession.workingDirectory,
    );
    expect(status.fileDiffs.map((diff) => diff.file)).toContain("src/tags/tags.ts");
  });

  test("removes the sessions of a deleted task and clears free artifacts on Reset Task", async () => {
    const demo = openDemo();
    const envelopes = await observeLive(demo);
    const reviewed = await taskOf(demo, "Open search with a keyboard shortcut");
    await demo.client.taskReset(FIELDNOTES, reviewed.id);
    const artifacts = await demo.client.taskArtifactsList({ ...FIELDNOTES, taskId: reviewed.id });
    expect(artifacts.artifacts).toEqual([]);

    const offline = await taskOf(demo, "Show an error when sync fails offline");
    await demo.client.taskDelete(FIELDNOTES, offline.id);
    await demo.advance(0);
    const snapshot = await demo.client.agentSessionLiveAttach({ repoPath: FIELDNOTES.repoPath });
    expect(snapshot.sessions.some((session) => session.title.includes(offline.title))).toBe(false);
    expect(envelopes.some((envelope) => envelope.type === "session_removed")).toBe(true);
  });

  test("keeps the worktree on Reset Implementation and drops the Builder and QA sessions", async () => {
    const demo = openDemo();
    const reviewed = await taskOf(demo, "Open search with a keyboard shortcut");
    const worktree = await demo.client.taskWorktreeGet(FIELDNOTES, reviewed.id);
    await demo.client.taskApplyEvent(FIELDNOTES, reviewed.id, "reset-implementation");
    expect(await demo.client.taskWorktreeGet(FIELDNOTES, reviewed.id)).toEqual(worktree);
    const [records] = await demo.client.agentSessionsListForTasks(FIELDNOTES, [reviewed.id]);
    expect(records?.agentSessions.map((session) => session.role).sort()).toEqual([
      "planner",
      "spec",
    ]);
    expect((await taskOf(demo, reviewed.title)).status).toBe("ready_for_dev");
  });

  test("keeps queue order while the first message is edited, and steers the chosen message", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const { target } = await chatOf(demo, "How does search rank notes?");
    const send = (submissionId: string, text: string) =>
      demo.client.agentSessionMessageSubmit({
        ...target,
        submissionId,
        mode: "default",
        parts: [{ kind: "text", text }],
      });
    await send("11111111-1111-4111-8111-000000000001", "First run");
    await send("11111111-1111-4111-8111-000000000002", "Queued A");
    await send("11111111-1111-4111-8111-000000000003", "Queued B");
    const editing = await demo.client.agentSessionMessageQueueManage({
      ...target,
      action: { kind: "begin_edit", submissionId: "11111111-1111-4111-8111-000000000002" },
    });
    const entry = editing.queue.entries[0];
    if (entry?.state !== "editing") throw new Error("The edit did not start.");
    await demo.advance(30_000);
    const waiting = await demo.client.agentSessionMessageQueueManage({
      ...target,
      action: { kind: "resume" },
    });
    expect(waiting.queue.entries.map((item) => item.submissionId)).toEqual([
      "11111111-1111-4111-8111-000000000002",
      "11111111-1111-4111-8111-000000000003",
    ]);
    await expect(
      demo.client.agentSessionMessageQueueManage({
        ...target,
        action: { kind: "cancel_edit", submissionId: entry.submissionId, editId: "edit-stale" },
      }),
    ).rejects.toThrow("This edit is no longer current");
    const steered = await demo.client.agentSessionMessageQueueManage({
      ...target,
      action: { kind: "steer", submissionId: "11111111-1111-4111-8111-000000000003" },
    });
    expect(
      steered.acceptedMessage?.type === "user_message" && steered.acceptedMessage.message,
    ).toBe("Queued B");
  });

  test("accepts an approval only for the pending request, and saves a chat model choice", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const { ref, target } = await chatOf(demo, "Why do tags drop on sync?");
    await demo.client.agentSessionMessageSubmit({
      ...target,
      submissionId: "11111111-1111-4111-8111-000000000004",
      mode: "default",
      parts: [{ kind: "text", text: "Add a note" }],
    });
    await demo.advance(15_000);
    await expect(
      demo.client.agentSessionLiveReplyApproval({
        ...ref,
        requestId: "old-request",
        outcome: "approve_once",
      }),
    ).rejects.toThrow("already answered");
    await demo.client.agentSessionControlUpdateModel({
      ...ref,
      sessionScope: target.sessionScope,
      model: { providerId: "claude", modelId: "claude-wren-3" },
    });
    const chats = await demo.client.workspaceSessionListActive("fieldnotes");
    expect(
      chats.find((chat) => chat.externalSessionId === ref.externalSessionId)?.selectedModel
        ?.modelId,
    ).toBe("claude-wren-3");
  });

  test("ends a worktree setup when the demo ends", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const ready = await taskOf(demo, "Restore focus after closing search");
    const launch = demo.client.agentSessionWorkflowLaunch({
      ...FIELDNOTES,
      taskId: ready.id,
      policy: {
        kind: "manual",
        actionId: "build_implementation_start",
        decision: {
          startMode: "fresh",
          selectedModel: { runtimeKind: "opencode", providerId: "vega", modelId: "vega-2-pro" },
        },
      },
      instruction: { kind: "kickoff" },
    });
    await demo.advance(100);
    demo.lifetime.abort();
    await expect(launch).rejects.toThrow("The demo ended");
  });
});

describe("demo task worktree owners", () => {
  test("lists the chats that work in a task worktree", async () => {
    const demo = openDemo();
    const reviewed = await taskOf(demo, "Open search with a keyboard shortcut");
    const worktree = await demo.client.taskWorktreeGet(FIELDNOTES, reviewed.id);
    if (!worktree) throw new Error("The task has no worktree.");
    await demo.client.workspaceSessionCreate({
      workspaceId: "fieldnotes",
      location: "existing_worktree",
      existingWorktree: { workingDirectory: worktree.workingDirectory },
      runtimeKind: "claude",
      selectedModel: null,
      customAgentRoleId: null,
      manualTitle: "Shared chat",
      targetBranch: { remote: "origin", branch: "main" },
    });
    const owners = await demo.client.taskWorktreeOwnersGet({
      ...FIELDNOTES,
      taskIds: [reviewed.id],
      operation: "reset_task",
    });
    expect(owners.owners.chats.map((chat) => chat.title)).toEqual(["Shared chat"]);
  });
});

describe("demo QA fixes", () => {
  const buildLaunch = (demo: Demo, taskId: string, extra: { goal?: { objective: string } } = {}) =>
    demo.client.agentSessionWorkflowLaunch({
      ...FIELDNOTES,
      taskId,
      policy: {
        kind: "manual",
        actionId: "build_implementation_start",
        decision: {
          startMode: "fresh",
          selectedModel: { runtimeKind: "opencode", providerId: "vega", modelId: "vega-2-pro" },
        },
      },
      instruction: { kind: "kickoff" },
      ...extra,
    });

  test("Reset Task closes the task terminals and ends a Builder start that waits for setup", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const reviewed = await taskOf(demo, "Open search with a keyboard shortcut");
    const worktree = await demo.client.taskWorktreeGet(FIELDNOTES, reviewed.id);
    if (!worktree) throw new Error("The task has no worktree.");
    const taskTerminals = { kind: "task" as const, ...FIELDNOTES, taskId: reviewed.id };
    await demo.client.terminalCreate({
      workingDir: worktree.workingDirectory,
      context: { ...FIELDNOTES, taskId: reviewed.id },
    });
    expect(
      (await demo.client.terminalList({ filter: taskTerminals })).terminals.length,
    ).toBeGreaterThan(1);
    await demo.client.taskReset(FIELDNOTES, reviewed.id);
    expect((await demo.client.terminalList({ filter: taskTerminals })).terminals).toEqual([]);

    const ready = await taskOf(demo, "Restore focus after closing search");
    const launch = buildLaunch(demo, ready.id);
    await demo.advance(100);
    await demo.client.taskReset(FIELDNOTES, ready.id);
    await expect(launch).rejects.toThrow("Worktree setup stopped");
    await demo.advance(5_000);
    const [records] = await demo.client.agentSessionsListForTasks(FIELDNOTES, [ready.id]);
    expect(records?.agentSessions).toEqual([]);
  });

  test("lets an issue be imported again after its task is deleted", async () => {
    const demo = openDemo();
    const [issue] = (await demo.client.issueItemsList({ ...FIELDNOTES, search: "" })).items;
    if (!issue) throw new Error("The sample has no issue.");
    const importIssue = () =>
      demo.client.issueItemsImport({
        ...FIELDNOTES,
        items: [
          {
            sourceId: issue.sourceId,
            revision: issue.revision,
            issueType: "bug",
            priority: 2,
            labels: [],
          },
        ],
      });
    const first = (await importIssue()).results[0];
    if (first?.outcome !== "created") throw new Error("The issue was not imported.");
    await demo.client.taskDelete(FIELDNOTES, first.taskId);
    const listed = await demo.client.issueItemGet({ ...FIELDNOTES, sourceId: issue.sourceId });
    expect(listed.linkedTaskId).toBeUndefined();
    expect((await importIssue()).results[0]?.outcome).toBe("created");
  });

  test("offers goals on every demo runtime", async () => {
    const demo = openDemo();
    const { runtimes } = await demo.client.runtimeStatus();
    for (const runtime of runtimes) {
      expect(
        resolveRuntimeGoalAvailability(RUNTIME_DESCRIPTORS_BY_KIND[runtime.kind], runtime.version),
      ).toEqual({ available: true });
    }
  });

  test("sets the goal of a Goal mode launch and writes a generated goal", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const ready = await taskOf(demo, "Restore focus after closing search");
    const generated = await demo.client.agentRuntimeGenerateText({
      repoPath: FIELDNOTES.repoPath,
      model: { runtimeKind: "opencode", providerId: "vega", modelId: "vega-2-pro" },
      instructions: "Write the goal.",
      prompt: `<task_material>\n\n# Task ${ready.id}: ${ready.title}\n\n</task_material>`,
    });
    expect(generated.text).toContain(ready.title);
    const launch = buildLaunch(demo, ready.id, { goal: { objective: generated.text } });
    await demo.advance(5_000);
    const { session, acceptedMessage } = await launch;
    if (!session) throw new Error("The launch started no session.");
    expect(acceptedMessage?.type === "user_message" && acceptedMessage.message).toContain(
      generated.text,
    );
    const live = await demo.client.agentSessionLiveRead({
      repoPath: FIELDNOTES.repoPath,
      runtimeKind: session.runtimeKind,
      workingDirectory: session.workingDirectory,
      externalSessionId: session.externalSessionId,
    });
    expect(live.type === "live" && live.session.goal).toEqual({
      objective: generated.text,
      status: "active",
    });
  });

  test("opens the sample subagent session and shows a deleted file in review", async () => {
    const demo = openDemo();
    const { chat } = await chatOf(demo, "Why do tags drop on sync?");
    const historyOf = (externalSessionId: string) =>
      demo.client.agentRuntimeLoadSessionHistory({
        repoPath: FIELDNOTES.repoPath,
        runtimeKind: "claude",
        workingDirectory: chat.executionTarget.workingDirectory,
        externalSessionId,
        runtimePolicy: { kind: "claude" },
        limit: 200,
      });
    const parts = (await historyOf(chat.externalSessionId ?? "")).flatMap((message) =>
      message.role === "assistant" ? message.parts : [],
    );
    const subagent = parts.find((part) => part.kind === "subagent");
    if (subagent?.kind !== "subagent" || !subagent.externalSessionId)
      throw new Error("The subagent has no session.");
    const child = await historyOf(subagent.externalSessionId);
    expect(child.at(-1)?.role).toBe("assistant");

    const reviewed = await taskOf(demo, "Open search with a keyboard shortcut");
    const worktree = await demo.client.taskWorktreeGet(FIELDNOTES, reviewed.id);
    const status = await demo.client.gitGetWorktreeStatus(
      FIELDNOTES.repoPath,
      "refs/remotes/origin/main",
      "target",
      worktree?.workingDirectory ?? "",
    );
    expect(status.fileDiffs.map((diff) => diff.type)).toContain("deleted");
  });

  test("keeps a goal unmet after a rejected edit", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const ready = await taskOf(demo, "Restore focus after closing search");
    const launch = buildLaunch(demo, ready.id, { goal: { objective: "Restore the focus." } });
    await demo.advance(30_000);
    const { session } = await launch;
    if (!session) throw new Error("The launch started no session.");
    const ref = {
      repoPath: FIELDNOTES.repoPath,
      runtimeKind: session.runtimeKind,
      workingDirectory: session.workingDirectory,
      externalSessionId: session.externalSessionId,
    };
    const target = {
      ...ref,
      sessionScope: {
        kind: "workflow" as const,
        workspaceId: "fieldnotes",
        taskId: ready.id,
        role: "build",
      },
    };
    const goalOf = async () => {
      const live = await demo.client.agentSessionLiveRead(ref);
      return live.type === "live" ? live.session.goal?.status : undefined;
    };
    expect(await goalOf()).toBe("complete");
    await demo.client.agentSessionGoalControl({ ...target, action: "resume" });
    expect(await goalOf()).toBe("waiting_for_message");
    await demo.client.agentSessionMessageSubmit({
      ...target,
      submissionId: "11111111-1111-4111-8111-000000000005",
      mode: "default",
      parts: [{ kind: "text", text: "Add a note" }],
    });
    await demo.advance(15_000);
    const live = await demo.client.agentSessionLiveRead(ref);
    const requestId =
      live.type === "live" ? live.session.pendingApprovals[0]?.requestId : undefined;
    if (!requestId) throw new Error("The run asked for no permission.");
    await demo.client.agentSessionLiveReplyApproval({ ...ref, requestId, outcome: "reject" });
    await demo.advance(30_000);
    expect(await goalOf()).toBe("waiting_for_message");
  });

  test("starts a new chat worktree from the selected target branch", async () => {
    const demo = openDemo();
    const reviewed = await taskOf(demo, "Open search with a keyboard shortcut");
    const worktree = await demo.client.taskWorktreeGet(FIELDNOTES, reviewed.id);
    const branch = await demo.client.gitGetCurrentBranch(
      FIELDNOTES.repoPath,
      worktree?.workingDirectory ?? "",
    );
    const created = demo.client.workspaceSessionCreate({
      workspaceId: "fieldnotes",
      location: "local_worktree",
      worktree: { mode: "from_name", name: "on-shortcut", branchName: null },
      runtimeKind: "claude",
      selectedModel: null,
      customAgentRoleId: null,
      manualTitle: "On the shortcut branch",
      targetBranch: { branch: branch.name ?? "" },
    });
    await demo.advance(5_000);
    const { session } = await created;
    const status = await demo.client.gitGetWorktreeStatus(
      FIELDNOTES.repoPath,
      `refs/heads/${branch.name}`,
      "target",
      session.executionTarget.workingDirectory,
    );
    expect(status.fileDiffs).toEqual([]);
    expect(status.targetAheadBehind).toEqual({ ahead: 0, behind: 0 });
  });

  test("refuses to restore a chat whose shared worktree another chat removed", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const { chat } = await chatOf(demo, "Why do tags drop on sync?");
    await demo.client.workspaceSessionCreate({
      workspaceId: "fieldnotes",
      location: "existing_worktree",
      existingWorktree: { workingDirectory: chat.executionTarget.workingDirectory },
      runtimeKind: "claude",
      selectedModel: null,
      customAgentRoleId: null,
      manualTitle: "Second chat",
      targetBranch: { remote: "origin", branch: "main" },
    });
    const second = (await demo.client.workspaceSessionListActive("fieldnotes")).find(
      (item) => item.manualTitle === "Second chat",
    );
    if (!second) throw new Error("The second chat is missing.");
    const archive = (sessionId: string, removeWorktree: boolean) =>
      demo.client.workspaceSessionArchive({
        workspaceId: "fieldnotes",
        sessionId,
        confirmStop: true,
        removeWorktree,
      });
    await archive(chat.id, false);
    await archive(second.id, true);
    await expect(
      demo.client.workspaceSessionRestore({ workspaceId: "fieldnotes", sessionId: chat.id }),
    ).rejects.toThrow("The worktree of this chat was removed");
  });

  test("compares a forked chat with the branch of its source", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const { chat } = await chatOf(demo, "Why do tags drop on sync?");
    const history = await demo.client.agentRuntimeLoadSessionHistory({
      repoPath: FIELDNOTES.repoPath,
      runtimeKind: "claude",
      workingDirectory: chat.executionTarget.workingDirectory,
      externalSessionId: chat.externalSessionId ?? "",
      runtimePolicy: { kind: "claude" },
      limit: 200,
    });
    const forked = demo.client.workspaceSessionFork({
      workspaceId: "fieldnotes",
      sessionId: chat.id,
      forkPoint: { messageId: history.at(-1)?.messageId ?? "" },
      destination: { kind: "new_worktree", name: "tags-copy", branchName: "odt/tags-copy" },
    });
    await demo.advance(5_000);
    const { runtimeSession } = await forked;
    const status = await demo.client.gitGetWorktreeStatus(
      FIELDNOTES.repoPath,
      "refs/heads/odt/tags-sync-fix",
      "target",
      runtimeSession.workingDirectory,
    );
    expect(status.fileDiffs).toEqual([]);
    expect(status.targetAheadBehind).toEqual({ ahead: 0, behind: 0 });
  });
});
