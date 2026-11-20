import { afterEach, describe, expect, test } from "bun:test";
import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { resolveRuntimeGoalAvailability } from "@openducktor/core";
import {
  goalCommandParts,
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  RUNTIME_DESCRIPTORS_BY_KIND,
} from "@openducktor/contracts";
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
    const pendingId = async () => {
      const live = await demo.client.agentSessionLiveRead(ref);
      return live.type === "live" ? live.session.pendingApprovals[0]?.requestId : undefined;
    };
    const requestId = await pendingId();
    if (!requestId) throw new Error("The run asked for no permission.");
    await expect(
      demo.client.agentSessionLiveReplyApproval({
        ...ref,
        requestId: "old-request",
        outcome: "approve_once",
      }),
    ).rejects.toThrow("already answered");
    expect(await pendingId()).toBe(requestId);
    await demo.client.agentSessionLiveReplyApproval({ ...ref, requestId, outcome: "approve_once" });
    expect(await pendingId()).toBeUndefined();
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

  test("refuses Reset Implementation while a Builder start waits for setup", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const ready = await taskOf(demo, "Restore focus after closing search");
    const launch = buildLaunch(demo, ready.id);
    await demo.advance(100);
    await expect(
      demo.client.taskApplyEvent(FIELDNOTES, ready.id, "reset-implementation"),
    ).rejects.toThrow("A session is starting in this task worktree");
    await demo.advance(5_000);
    expect((await launch).status).toBe("completed");
    await demo.advance(30_000);
    expect((await taskOf(demo, ready.title)).status).toBe("ai_review");
  });

  test("saves the start form target branch and bases the new worktree on it", async () => {
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
      targetBranch: { branch: "odt/tags-sync-fix" },
    });
    await demo.advance(1_000);
    expect((await taskOf(demo, ready.title)).targetBranch).toEqual({ branch: "odt/tags-sync-fix" });
    await demo.advance(5_000);
    await launch;
    const worktree = await demo.client.taskWorktreeGet(FIELDNOTES, ready.id);
    const status = await demo.client.gitGetWorktreeStatus(
      FIELDNOTES.repoPath,
      "refs/heads/odt/tags-sync-fix",
      "target",
      worktree?.workingDirectory ?? "",
    );
    expect(status.targetAheadBehind.behind).toBe(0);
  });

  test("closes the task terminals on Direct Merge and on Remove Worktree", async () => {
    const demo = openDemo();
    const terminalsOf = async (taskId: string) =>
      (
        await demo.client.terminalList({
          filter: { kind: "task", ...FIELDNOTES, taskId },
        })
      ).terminals;
    const reviewed = await taskOf(demo, "Open search with a keyboard shortcut");
    expect((await terminalsOf(reviewed.id)).length).toBeGreaterThan(0);
    const worktree = await demo.client.taskWorktreeGet(FIELDNOTES, reviewed.id);
    const branch = await demo.client.gitGetCurrentBranch(
      FIELDNOTES.repoPath,
      worktree?.workingDirectory ?? "",
    );
    await demo.client.taskDirectMerge(FIELDNOTES, reviewed.id, {
      expected: {
        taskStatus: "human_review",
        sourceBranch: branch.name ?? "",
        targetBranch: { remote: "origin", branch: "main" },
      },
      mergeMethod: "squash",
      removeWorktree: false,
    });
    expect(await terminalsOf(reviewed.id)).toEqual([]);

    const blocked = await taskOf(demo, "Keep search closed while typing in a note");
    const blockedTree = await demo.client.taskWorktreeGet(FIELDNOTES, blocked.id);
    await demo.client.terminalCreate({
      workingDir: blockedTree?.workingDirectory ?? "",
      context: { ...FIELDNOTES, taskId: blocked.id },
    });
    await demo.client.taskWorktreeRemove(FIELDNOTES, blocked.id);
    expect(await terminalsOf(blocked.id)).toEqual([]);
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
    const sent = await demo.client.agentSessionMessageSubmit({
      ...target,
      submissionId: "11111111-1111-4111-8111-000000000005",
      mode: "default",
      parts: goalCommandParts("Add a note about focus"),
    });
    expect(sent.kind).toBe("accepted");
    expect(await goalOf()).toBe("active");
    await demo.advance(15_000);
    const live = await demo.client.agentSessionLiveRead(ref);
    const requestId =
      live.type === "live" ? live.session.pendingApprovals[0]?.requestId : undefined;
    if (!requestId) throw new Error("The run asked for no permission.");
    await demo.client.agentSessionLiveReplyApproval({ ...ref, requestId, outcome: "reject" });
    await demo.advance(30_000);
    expect(await goalOf()).toBe("waiting_for_message");
  });

  test("leaves the task unchanged when Reset Implementation has no base branch", async () => {
    const demo = openDemo();
    const reviewed = await taskOf(demo, "Open search with a keyboard shortcut");
    await demo.client.taskUpdate(FIELDNOTES, reviewed.id, {
      targetBranch: { branch: "odt/missing" },
    });
    const filter = { kind: "task" as const, ...FIELDNOTES, taskId: reviewed.id };
    const terminals = async () => (await demo.client.terminalList({ filter })).terminals.length;
    const before = await terminals();
    expect(before).toBeGreaterThan(0);
    await expect(
      demo.client.taskApplyEvent(FIELDNOTES, reviewed.id, "reset-implementation"),
    ).rejects.toThrow("has no branch odt/missing");
    expect(await terminals()).toBe(before);
    const after = await taskOf(demo, reviewed.title);
    expect(after.status).toBe("human_review");
    expect(after.artifactSummary.qaReport?.present).toBe(true);

    // A reset that passes its checks closes the task terminals.
    await demo.client.taskUpdate(FIELDNOTES, reviewed.id, { targetBranch: { branch: "main" } });
    await demo.client.taskApplyEvent(FIELDNOTES, reviewed.id, "reset-implementation");
    expect(await terminals()).toBe(0);
  });

  test("runs /goal and /compact from the composer as local commands", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const { ref, target } = await chatOf(demo, "Why do tags drop on sync?");
    let submission = 10;
    const send = (parts: Parameters<typeof demo.client.agentSessionMessageSubmit>[0]["parts"]) =>
      demo.client.agentSessionMessageSubmit({
        ...target,
        submissionId: `11111111-1111-4111-8111-0000000000${submission++}`,
        mode: "default",
        parts,
      });
    const goalOf = async () => {
      const live = await demo.client.agentSessionLiveRead(ref);
      return live.type === "live" ? live.session.goal : undefined;
    };
    await send(goalCommandParts("Explain the tag sync"));
    expect(await goalOf()).toEqual({ objective: "Explain the tag sync", status: "active" });
    await demo.advance(30_000);
    expect((await goalOf())?.status).toBe("complete");
    const paused = await send(goalCommandParts("clear"));
    expect(paused.kind === "accepted" && paused.acceptedMessage.type).toBe("command_accepted");
    expect(await goalOf()).toBeUndefined();
    await expect(send(goalCommandParts("pause"))).rejects.toThrow("This session has no goal");
    const compacted = await send([
      { kind: "slash_command", command: { ...MANUAL_SESSION_COMPACTION_SLASH_COMMAND, hints: [] } },
    ]);
    expect(compacted.kind === "accepted" && compacted.acceptedMessage.type).toBe(
      "command_accepted",
    );
  });

  test("sends the next queued message after a command that starts no turn", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const { target } = await chatOf(demo, "How does search rank notes?");
    let submission = 30;
    const send = (parts: Parameters<typeof demo.client.agentSessionMessageSubmit>[0]["parts"]) =>
      demo.client.agentSessionMessageSubmit({
        ...target,
        submissionId: `11111111-1111-4111-8111-0000000000${submission++}`,
        mode: "default",
        parts,
      });
    await send([{ kind: "text", text: "First run" }]);
    await send([
      { kind: "slash_command", command: { ...MANUAL_SESSION_COMPACTION_SLASH_COMMAND, hints: [] } },
    ]);
    await send(goalCommandParts("pause"));
    await send([{ kind: "text", text: "After the commands" }]);
    await demo.advance(30_000);
    // `/goal pause` fails without a goal, so it stays first and holds the queue with its reason.
    const held = await demo.client.agentSessionMessageQueueManage({
      ...target,
      action: { kind: "resume" },
    });
    expect(held.queue.entries).toHaveLength(2);
    expect(held.queue.pause?.message).toContain("This session has no goal");
    const pauseEntry = held.queue.entries[0];
    if (!pauseEntry) throw new Error("The queue is empty.");
    await demo.client.agentSessionMessageQueueManage({
      ...target,
      action: { kind: "remove", submissionId: pauseEntry.submissionId },
    });
    const resumed = await demo.client.agentSessionMessageQueueManage({
      ...target,
      action: { kind: "resume" },
    });
    expect(resumed.queue.entries).toEqual([]);
    expect(
      resumed.acceptedMessage?.type === "user_message" && resumed.acceptedMessage.message,
    ).toBe("After the commands");
  });

  test("refuses a second start, a shared archive, and a worktree removal while others use it", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const ready = await taskOf(demo, "Restore focus after closing search");
    const first = buildLaunch(demo, ready.id);
    await demo.advance(100);
    await expect(buildLaunch(demo, ready.id)).rejects.toThrow("A session is starting");
    await demo.advance(5_000);
    await first;

    const { chat, ref } = await chatOf(demo, "Why do tags drop on sync?");
    await demo.client.workspaceSessionCreate({
      workspaceId: "fieldnotes",
      location: "existing_worktree",
      existingWorktree: { workingDirectory: chat.executionTarget.workingDirectory },
      runtimeKind: "claude",
      selectedModel: null,
      customAgentRoleId: null,
      manualTitle: "Shared",
      targetBranch: { remote: "origin", branch: "main" },
    });
    await demo.client.agentSessionMessageSubmit({
      ...ref,
      sessionScope: { kind: "repository", workspaceId: "fieldnotes" },
      submissionId: "11111111-1111-4111-8111-000000000040",
      mode: "default",
      parts: [{ kind: "text", text: "Explain the sync" }],
    });
    await expect(
      demo.client.workspaceSessionArchive({
        workspaceId: "fieldnotes",
        sessionId: chat.id,
        confirmStop: true,
        removeWorktree: true,
      }),
    ).rejects.toThrow("Other chats or tasks still use this worktree");
    const live = await demo.client.agentSessionLiveRead(ref);
    expect(live.type === "live" && live.session.activity).toBe("running");

    const reviewed = await taskOf(demo, "Open search with a keyboard shortcut");
    const worktree = await demo.client.taskWorktreeGet(FIELDNOTES, reviewed.id);
    await demo.client.workspaceSessionCreate({
      workspaceId: "fieldnotes",
      location: "existing_worktree",
      existingWorktree: { workingDirectory: worktree?.workingDirectory ?? "" },
      runtimeKind: "claude",
      selectedModel: null,
      customAgentRoleId: null,
      manualTitle: "On the task",
      targetBranch: { remote: "origin", branch: "main" },
    });
    await expect(demo.client.taskWorktreeRemove(FIELDNOTES, reviewed.id)).rejects.toThrow(
      "A session still works in this worktree",
    );
    expect(await demo.client.taskWorktreeGet(FIELDNOTES, reviewed.id)).toEqual(worktree);
  });

  test("keeps the changelog entries of two Direct Merges, and checks the target first", async () => {
    const demo = openDemo();
    const merge = async (title: string, branch = "main") => {
      const task = await taskOf(demo, title);
      return demo.client.taskDirectMerge(FIELDNOTES, task.id, {
        expected: { taskStatus: task.status, sourceBranch: "odt/any", targetBranch: { branch } },
        mergeMethod: "squash",
        removeWorktree: false,
      });
    };
    const changelog = async () => {
      const file = await demo.client.filesystemReadTextFile({
        rootPath: FIELDNOTES.repoPath,
        relativePath: "CHANGELOG.md",
      });
      return file.kind === "text" ? file.contents : "";
    };
    await merge("Open search with a keyboard shortcut");
    await merge("Show an error when sync fails offline");
    expect(await changelog()).toContain("- Open search with a keyboard shortcut");
    expect(await changelog()).toContain("- Show an error when sync fails offline");

    const blocked = await taskOf(demo, "Keep search closed while typing in a note");
    const tree = await demo.client.taskWorktreeGet(FIELDNOTES, blocked.id);
    await demo.client.terminalCreate({
      workingDir: tree?.workingDirectory ?? "",
      context: { ...FIELDNOTES, taskId: blocked.id },
    });
    const filter = { kind: "task" as const, ...FIELDNOTES, taskId: blocked.id };
    const before = (await demo.client.terminalList({ filter })).terminals.length;
    await expect(merge(blocked.title, "odt/gone")).rejects.toThrow("has no branch odt/gone");
    expect((await demo.client.terminalList({ filter })).terminals).toHaveLength(before);
    expect((await taskOf(demo, blocked.title)).status).toBe("blocked");
  });

  test("continues a stopped turn when the user resumes it", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const { ref, target } = await chatOf(demo, "Why do tags drop on sync?");
    await demo.client.agentSessionMessageSubmit({
      ...target,
      submissionId: "11111111-1111-4111-8111-000000000050",
      mode: "default",
      parts: [{ kind: "text", text: "Explain the ranking" }],
    });
    await demo.advance(1_000);
    await demo.client.agentSessionControlStop(ref);
    const resume = () =>
      demo.client.agentSessionControlResume({ ...target, resumeMode: "continue_interrupted_turn" });
    const resumed = await resume();
    expect(resumed.status).toBe("running");
    await demo.advance(30_000);
    const history = await demo.client.agentRuntimeLoadSessionHistory({
      ...ref,
      runtimeKind: "claude",
      runtimePolicy: { kind: "claude" },
      limit: 200,
    });
    expect(history.at(-1)?.role === "assistant" && history.at(-1)?.text).toContain(
      'About "Explain the ranking"',
    );
    await expect(resume()).rejects.toThrow("no stopped turn");
  });

  test("ends a running tool on Stop, so no tool stays running after Resume", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const { ref, target } = await chatOf(demo, "Why do tags drop on sync?");
    const history = () =>
      demo.client.agentRuntimeLoadSessionHistory({
        ...ref,
        runtimeKind: "claude",
        runtimePolicy: { kind: "claude" },
        limit: 200,
      });
    const toolStates = async () =>
      (await history()).flatMap((message) =>
        message.role === "assistant"
          ? message.parts.flatMap((part) => (part.kind === "tool" ? [part.status] : []))
          : [],
      );
    await demo.client.agentSessionMessageSubmit({
      ...target,
      submissionId: "11111111-1111-4111-8111-000000000052",
      mode: "default",
      parts: [{ kind: "text", text: "Explain the notebook ranking" }],
    });
    for (let step = 0; step < 100 && !(await toolStates()).includes("running"); step += 1)
      await demo.advance(50);
    expect(await toolStates()).toContain("running");
    await demo.client.agentSessionControlStop(ref);
    expect(await toolStates()).not.toContain("running");
    await demo.client.agentSessionControlResume({
      ...target,
      resumeMode: "continue_interrupted_turn",
    });
    await demo.advance(30_000);
    expect(await toolStates()).not.toContain("running");
    const live = await demo.client.agentSessionLiveRead(ref);
    expect(live.type === "live" && live.session.activity).toBe("idle");
  });

  test("keeps a rejected edit rejected when a stopped turn continues", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const { ref, target, chat } = await chatOf(demo, "Why do tags drop on sync?");
    const notes = async () => {
      const file = await demo.client.filesystemReadTextFile({
        rootPath: chat.executionTarget.workingDirectory,
        relativePath: "docs/agent-notes.md",
      });
      return file.kind === "text" ? file.contents : "";
    };
    const before = await notes();
    await demo.client.agentSessionMessageSubmit({
      ...target,
      submissionId: "11111111-1111-4111-8111-000000000051",
      mode: "default",
      parts: [{ kind: "text", text: "Add a note about focus" }],
    });
    await demo.advance(15_000);
    const live = await demo.client.agentSessionLiveRead(ref);
    const requestId =
      live.type === "live" ? live.session.pendingApprovals[0]?.requestId : undefined;
    if (!requestId) throw new Error("The run asked for no permission.");
    await demo.client.agentSessionLiveReplyApproval({ ...ref, requestId, outcome: "reject" });
    await demo.client.agentSessionControlStop(ref);
    await demo.client.agentSessionControlResume({
      ...target,
      resumeMode: "continue_interrupted_turn",
    });
    await demo.advance(30_000);
    expect(await notes()).toBe(before);
  });

  test("gives the blocked sample task a Builder session that its row opens", async () => {
    const demo = openDemo();
    const blocked = await taskOf(demo, "Keep search closed while typing in a note");
    expect(blocked.status).toBe("blocked");
    const [records] = await demo.client.agentSessionsListForTasks(FIELDNOTES, [blocked.id]);
    expect(records?.agentSessions.map((session) => session.role)).toEqual(["build"]);
  });

  test("never gives a deleted task ID to a new task", async () => {
    const demo = openDemo();
    const create = () =>
      demo.client.taskCreate(FIELDNOTES, { title: "Scratch", issueType: "task", priority: 2 });
    const first = await create();
    await demo.client.taskDelete(FIELDNOTES, first.id);
    expect((await create()).id).not.toBe(first.id);
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
