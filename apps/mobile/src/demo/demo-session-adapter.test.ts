import { afterEach, describe, expect, test } from "bun:test";
import {
  type AgentSessionLiveEnvelope,
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
  type TaskEventStreamFrame,
  type TerminalServerMessage,
  terminalServerMessageSchema,
} from "@openducktor/contracts";
import { createManualTimers } from "../test-support/manual-timers";
import { createDemoSessionAdapter } from "./demo-session-adapter";
import { SIMULATED_TERMINAL_NOTICE, UNKNOWN_COMMAND_TEXT } from "./demo-terminals";

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

/** Observes the live stream of Fieldnotes, as the workspace activity of the app does. */
const observeLive = async (demo: ReturnType<typeof openDemo>) => {
  const envelopes: AgentSessionLiveEnvelope[] = [];
  const stop = await demo.adapter.host.observeAgentSessionLive(
    { repoPath: FIELDNOTES.repoPath },
    (envelope) => envelopes.push(envelope),
  );
  await demo.advance(0);
  return { envelopes, stop };
};

const taskOf = async (demo: ReturnType<typeof openDemo>, title: string) => {
  const tasks = await demo.client.tasksListAll(FIELDNOTES);
  const task = tasks.find((candidate) => candidate.title === title);
  if (!task) throw new Error(`The sample has no task "${title}".`);
  return task;
};

const chatOf = async (demo: ReturnType<typeof openDemo>, title: string) => {
  const chats = await demo.client.workspaceSessionListActive("fieldnotes");
  const chat = chats.find((candidate) => candidate.manualTitle === title);
  if (!chat?.externalSessionId) throw new Error(`The sample has no chat "${title}".`);
  return { chat, externalSessionId: chat.externalSessionId };
};

describe("demo backend", () => {
  test("serves the sample data through the contract schemas of the host client", async () => {
    const demo = openDemo();
    const { client } = demo;
    const workspaces = await client.workspaceList();
    expect(workspaces.map((workspace) => workspace.workspaceId)).toEqual([
      "fieldnotes",
      "fable-api",
      "design-system",
    ]);
    const settings = await client.workspaceGetSettingsSnapshot();
    expect(settings.agentRuntimes.opencode.enabled).toBe(true);
    const status = await client.runtimeStatus();
    expect(status.runtimes.every((runtime) => runtime.state === "ready")).toBe(true);
    await client.workflowCatalogGet();
    for (const workspace of workspaces) {
      const scope = { workspaceId: workspace.workspaceId, repoPath: workspace.repoPath };
      const context = await client.workspaceWorkflowGet(scope);
      const tasks = await client.tasksList(scope);
      expect(tasks.length).toBeGreaterThan(0);
      for (const task of tasks)
        expect(context.board.states.some((state) => state.id === task.status)).toBe(true);
      await client.agentSessionsListForTasks(
        scope,
        tasks.map((task) => task.id),
      );
      await client.workspaceSessionListActive(workspace.workspaceId);
      await client.workspaceSessionListArchived(workspace.workspaceId);
      await client.agentSessionLiveAttach({ repoPath: workspace.repoPath });
      await client.workspaceGetRepoConfig(workspace.workspaceId);
    }
    for (const runtimeKind of ["opencode", "codex", "claude"] as const) {
      const catalog = await client.agentRuntimeLoadCatalog({
        repoPath: FIELDNOTES.repoPath,
        runtimeKind,
        workingDirectory: FIELDNOTES.repoPath,
      });
      expect(catalog.models?.status).toBe("available");
    }
    const statuses = new Set((await client.tasksListAll(FIELDNOTES)).map((task) => task.status));
    for (const state of [
      "open",
      "spec_ready",
      "ready_for_dev",
      "in_progress",
      "blocked",
      "ai_review",
      "human_review",
      "closed",
    ]) {
      expect(statuses.has(state)).toBe(true);
    }
    await client.pathCheck(false);
    await client.gitCheck();
    await client.taskStoreCheck(FIELDNOTES);
  });

  test("keeps branch changes, files, documents, and artifacts of a reviewed task consistent", async () => {
    const demo = openDemo();
    const { client } = demo;
    const task = await taskOf(demo, "Open search with a keyboard shortcut");
    const worktree = await client.taskWorktreeGet(FIELDNOTES, task.id);
    if (!worktree) throw new Error("The reviewed task has no worktree.");
    const branch = await client.gitGetCurrentBranch(FIELDNOTES.repoPath, worktree.workingDirectory);
    const target = await client.gitGetComparisonTarget(
      FIELDNOTES.repoPath,
      worktree.workingDirectory,
      { remote: "origin", branch: "main" },
    );
    if (target.kind !== "available") throw new Error("The comparison target is unavailable.");
    const branchChanges = await client.gitGetWorktreeStatus(
      FIELDNOTES.repoPath,
      target.reference,
      "target",
      worktree.workingDirectory,
    );
    expect(branchChanges.fileDiffs.length).toBeGreaterThan(0);
    const local = await client.gitGetLocalChanges(FIELDNOTES.repoPath, worktree.workingDirectory);
    expect(local.fileStatuses).toEqual([]);
    const tree = await client.filesystemRefreshTree({
      rootPath: worktree.workingDirectory,
      refreshId: "1",
      mode: "full",
    });
    if (tree.kind !== "snapshot") throw new Error("The file tree is not a snapshot.");
    expect(tree.context.branch).toBe(branch.name ?? null);
    const changed = branchChanges.fileDiffs.find((diff) => diff.type === "added")?.file ?? "";
    expect(tree.entries.find((entry) => entry.path === changed)?.gitStatus).toBe("added");
    const file = await client.filesystemReadTextFile({
      rootPath: worktree.workingDirectory,
      relativePath: changed,
    });
    expect(file.kind).toBe("text");
    const image = await client.filesystemReadTextFile({
      rootPath: worktree.workingDirectory,
      relativePath: "assets/logo.png",
    });
    expect(image.kind).toBe("image");
    const artifacts = await client.taskArtifactsList({ ...FIELDNOTES, taskId: task.id });
    expect(artifacts.artifacts.map((artifact) => artifact.name)).toContain("Search dialog mock");
    for (const artifact of artifacts.artifacts)
      await client.taskArtifactRead({
        ...FIELDNOTES,
        taskId: task.id,
        artifactId: artifact.artifactId,
      });
    const spec = await client.workflowArtifactGet(FIELDNOTES, task.id, "spec");
    expect(spec.markdown).toContain(task.title);
    const approval = await client.taskApprovalContextGet(FIELDNOTES, task.id);
    expect(approval.outcome).toBe("ready");
  });

  test("starts the task stream with a snapshot and publishes task changes", async () => {
    const demo = openDemo();
    const frames: TaskEventStreamFrame[] = [];
    await demo.adapter.host.subscribeTaskStream({ cursor: null }, (frame) => frames.push(frame));
    await demo.advance(0);
    expect(frames.map((frame) => frame.type)).toEqual(["snapshot_required"]);
    const created = await demo.client.taskCreate(FIELDNOTES, {
      title: "Add a reading mode",
      issueType: "feature",
      priority: 1,
      labels: ["editor"],
    });
    await demo.client.taskUpdate(FIELDNOTES, created.id, { title: "Add a quiet reading mode" });
    await demo.advance(0);
    const changes = frames.filter((frame) => frame.type === "change");
    expect(changes).toHaveLength(2);
    expect(changes.map((frame) => frame.cursor.sequence)).toEqual([1, 2]);
    const last = changes.at(-1);
    if (last?.type !== "change") throw new Error("No change frame.");
    expect(last.event.boardChanges?.cards[0]?.title).toBe("Add a quiet reading mode");
    await demo.client.taskDelete(FIELDNOTES, created.id);
    expect((await demo.client.taskIdsList(FIELDNOTES)).includes(created.id)).toBe(false);
  });

  test("runs a prompt that changes files after an approval and commits the change", async () => {
    const demo = openDemo();
    const { envelopes } = await observeLive(demo);
    const { chat, externalSessionId } = await chatOf(demo, "Why do tags drop on sync?");
    const ref = {
      repoPath: FIELDNOTES.repoPath,
      runtimeKind: chat.runtimeKind,
      workingDirectory: chat.executionTarget.workingDirectory,
      externalSessionId,
    };
    const result = await demo.client.agentSessionMessageSubmit({
      ...ref,
      sessionScope: { kind: "repository", workspaceId: "fieldnotes" },
      submissionId: "11111111-1111-4111-8111-111111111111",
      mode: "default",
      parts: [{ kind: "text", text: "Add a note about tag sync\nwith details" }],
    });
    expect(result.kind).toBe("accepted");
    await demo.advance(15_000);
    const waiting = envelopes.findLast((envelope) => envelope.type === "session_upsert");
    if (waiting?.type !== "session_upsert") throw new Error("No live update.");
    expect(waiting.session.activity).toBe("waiting_for_permission");
    const requestId = waiting.session.pendingApprovals[0]?.requestId ?? "";
    await demo.client.agentSessionLiveReplyApproval({ ...ref, requestId, outcome: "approve_once" });
    await demo.advance(15_000);
    const idle = envelopes.findLast((envelope) => envelope.type === "session_upsert");
    if (idle?.type !== "session_upsert") throw new Error("No live update.");
    expect(idle.session.activity).toBe("idle");
    expect(ref.runtimeKind).toBe("claude");
    const history = await demo.client.agentRuntimeLoadSessionHistory({
      ...ref,
      runtimeKind: "claude",
      runtimePolicy: { kind: "claude" },
      limit: 200,
    });
    const answer = history.at(-1);
    expect(answer?.text).toContain('Done: "Add a note about tag sync"');
    const status = await demo.client.gitGetWorktreeStatus(
      FIELDNOTES.repoPath,
      "refs/remotes/origin/main",
      "target",
      ref.workingDirectory,
    );
    expect(status.fileDiffs.map((diff) => diff.file)).toContain("docs/agent-notes.md");
  });

  test("answers the sample question and finishes the run", async () => {
    const demo = openDemo();
    const { envelopes } = await observeLive(demo);
    const snapshot = envelopes.find((envelope) => envelope.type === "snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("No snapshot.");
    const asking = snapshot.sessions.find((session) => session.pendingQuestions.length > 0);
    const permission = snapshot.sessions.find((session) => session.pendingApprovals.length > 0);
    expect(permission).toBeDefined();
    if (!asking) throw new Error("No session waits for a question.");
    await demo.client.agentSessionLiveReplyQuestion({
      ...asking.ref,
      requestId: asking.pendingQuestions[0]?.requestId ?? "",
      answers: [["Create a note"]],
    });
    await demo.advance(15_000);
    const last = envelopes.findLast(
      (envelope) =>
        envelope.type === "session_upsert" &&
        envelope.session.ref.externalSessionId === asking.ref.externalSessionId,
    );
    if (last?.type !== "session_upsert") throw new Error("No live update.");
    expect(last.session.activity).toBe("idle");
    expect(last.session.pendingQuestions).toEqual([]);
  });

  test("runs the Spec and Builder roles and applies their workflow outcomes", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const backlog = await taskOf(demo, "Pin notes to the top of a notebook");
    // Every task session works in the task worktree, so the Spec start sets it up first.
    const specLaunch = demo.client.agentSessionWorkflowLaunch({
      ...FIELDNOTES,
      taskId: backlog.id,
      startup: { startupAttemptId: "a1", operationId: "o1" },
      policy: {
        kind: "manual",
        actionId: "spec_initial",
        decision: {
          startMode: "fresh",
          selectedModel: { runtimeKind: "claude", providerId: "claude", modelId: "claude-lyra-3" },
        },
      },
      instruction: { kind: "kickoff" },
    });
    await demo.advance(5_000);
    const spec = await specLaunch;
    expect(spec.startupProgress?.prepared).toBeDefined();
    await demo.advance(15_000);
    expect((await taskOf(demo, backlog.title)).status).toBe("spec_ready");

    const ready = await taskOf(demo, "Restore focus after closing search");
    const launch = demo.client.agentSessionWorkflowLaunch({
      ...FIELDNOTES,
      taskId: ready.id,
      startup: { startupAttemptId: "a2", operationId: "o2" },
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
    await demo.advance(5_000);
    const build = await launch;
    expect(build.startupProgress?.steps.map((step) => step.id)).toEqual(["worktree", "setup"]);
    expect((await taskOf(demo, ready.title)).status).toBe("in_progress");
    await demo.advance(20_000);
    expect((await taskOf(demo, ready.title)).status).toBe("ai_review");
  });

  test("queues a reused PR launch behind the Builder's current turn and earlier messages", async () => {
    const demo = openDemo();
    const { envelopes } = await observeLive(demo);
    const task = await taskOf(demo, "Open search with a keyboard shortcut");
    const [records] = await demo.client.agentSessionsListForTasks(FIELDNOTES, [task.id]);
    const builder = records?.agentSessions.find(({ role }) => role === "build");
    if (!builder) throw new Error("The sample task has no Builder session.");
    const sourceSession = {
      runtimeKind: builder.runtimeKind,
      workingDirectory: builder.workingDirectory,
      externalSessionId: builder.externalSessionId,
    };
    const target = {
      repoPath: FIELDNOTES.repoPath,
      ...sourceSession,
      sessionScope: {
        kind: "workflow" as const,
        workspaceId: FIELDNOTES.workspaceId,
        taskId: task.id,
        role: "build",
      },
    };
    const send = (submissionId: string, text: string) =>
      demo.client.agentSessionMessageSubmit({
        ...target,
        submissionId,
        mode: "default",
        parts: [{ kind: "text", text }],
      });
    const first = "Where is search?";
    const earlier = "How does ranking work?";
    const kickoff = "Generate the pull request.";
    expect((await send("11111111-1111-4111-8111-000000000001", first)).kind).toBe("accepted");
    expect((await send("11111111-1111-4111-8111-000000000002", earlier)).kind).toBe("queued");

    const launch = await demo.client.agentSessionWorkflowLaunch({
      ...FIELDNOTES,
      taskId: task.id,
      startup: { startupAttemptId: "pr-reuse", operationId: "pr-reuse-operation" },
      policy: {
        kind: "manual",
        actionId: "pull_request",
        role: "build",
        decision: { startMode: "reuse", sourceSession },
      },
      instruction: { kind: "kickoff", text: kickoff },
    });
    expect(launch.acceptedMessage).toBeUndefined();
    expect(launch.startupProgress?.instruction).toEqual({ state: "queued" });
    expect((await taskOf(demo, task.title)).pullRequest).toBeUndefined();

    const snapshot = await demo.client.agentSessionLiveAttach({ repoPath: FIELDNOTES.repoPath });
    const queue = snapshot.messageQueues.find(
      ({ target }) => target.externalSessionId === builder.externalSessionId,
    );
    const pending = queue?.entries.find(({ parts }) =>
      parts.some((part) => part.kind === "text" && part.text === kickoff),
    );
    if (!pending) throw new Error("The PR instruction did not enter the queue.");
    await expect(
      demo.client.agentSessionMessageQueueManage({
        ...target,
        action: { kind: "steer", submissionId: pending.submissionId },
      }),
    ).rejects.toThrow("This workflow action needs its own turn.");

    await demo.advance(45_000);

    const turns = envelopes.flatMap((envelope) => {
      if (
        envelope.type !== "transcript_event" ||
        envelope.event.externalSessionId !== builder.externalSessionId
      )
        return [];
      const event = envelope.event;
      if (event.type === "user_message") return [event.message];
      if (event.type === "session_idle") return [event.turnOutcome];
      return [];
    });
    expect(turns).toEqual([first, "completed", earlier, "completed", kickoff, "completed"]);
    expect((await taskOf(demo, task.title)).pullRequest?.state).toBe("open");
  });

  test("stops a role run without its outcome", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const backlog = await taskOf(demo, "Add a print style for notes");
    const launch = demo.client.agentSessionWorkflowLaunch({
      ...FIELDNOTES,
      taskId: backlog.id,
      policy: {
        kind: "manual",
        actionId: "spec_initial",
        decision: {
          startMode: "fresh",
          selectedModel: { runtimeKind: "claude", providerId: "claude", modelId: "claude-lyra-3" },
        },
      },
      instruction: { kind: "kickoff" },
    });
    await demo.advance(5_000);
    const started = await launch;
    const session = started.session;
    if (!session) throw new Error("No session.");
    await demo.advance(2_000);
    await demo.client.agentSessionControlStop({
      repoPath: FIELDNOTES.repoPath,
      runtimeKind: session.runtimeKind,
      workingDirectory: session.workingDirectory,
      externalSessionId: session.externalSessionId,
    });
    await demo.advance(30_000);
    expect((await taskOf(demo, backlog.title)).status).toBe("open");
  });

  test("ends every event and command with the demo, except the connection cleanup", async () => {
    const demo = openDemo();
    const { envelopes } = await observeLive(demo);
    const backlog = await taskOf(demo, "Pin notes to the top of a notebook");
    const launch = demo.client.agentSessionWorkflowLaunch({
      ...FIELDNOTES,
      taskId: backlog.id,
      policy: {
        kind: "manual",
        actionId: "spec_initial",
        decision: {
          startMode: "fresh",
          selectedModel: { runtimeKind: "claude", providerId: "claude", modelId: "claude-lyra-3" },
        },
      },
      instruction: { kind: "kickoff" },
    });
    await demo.advance(5_000);
    await launch;
    await demo.advance(1_000);
    demo.lifetime.abort();
    const count = envelopes.length;
    await demo.advance(30_000);
    expect(envelopes).toHaveLength(count);
    expect(demo.pendingCount()).toBe(0);
    await expect(demo.client.workspaceList()).rejects.toThrow("The demo ended");
    const assetIds = ["00000000-0000-4000-8000-000000000001"];
    await demo.client.taskAssetDiscardStaged({ workspaceId: "fieldnotes", assetIds });
    await demo.adapter.dispose();
    await expect(
      demo.client.taskAssetDiscardStaged({ workspaceId: "fieldnotes", assetIds }),
    ).rejects.toThrow("The demo ended");
  });

  test("simulates terminals with the demo commands only", async () => {
    const demo = openDemo();
    const frames: { message: TerminalServerMessage; text: string }[] = [];
    const connection = await demo.adapter.terminalBridge.connect(
      (frame) => {
        const decoded = decodeTerminalProtocolFrame(frame);
        frames.push({
          message: terminalServerMessageSchema.parse(decoded.message),
          text: new TextDecoder().decode(decoded.payload),
        });
      },
      () => {},
      () => {},
    );
    const send = (
      message: Parameters<typeof encodeTerminalProtocolFrame>[0]["message"],
      text = "",
    ) =>
      connection.send(
        encodeTerminalProtocolFrame({ message, payload: new TextEncoder().encode(text) }),
      );
    const created = await demo.client.terminalCreate({
      workingDir: FIELDNOTES.repoPath,
      context: {},
    });
    const terminalId = created.ref.terminalId;
    await send({
      version: TERMINAL_PROTOCOL_VERSION,
      type: "attach",
      terminalId,
      lastConsumedSequence: null,
    });
    await send({ version: TERMINAL_PROTOCOL_VERSION, type: "input", terminalId }, "help\r");
    await send({ version: TERMINAL_PROTOCOL_VERSION, type: "input", terminalId }, "rm -rf /\r");
    await demo.advance(0);
    expect(frames[0]?.message.type).toBe("snapshot");
    const output = frames
      .filter((frame) => frame.message.type === "output")
      .map((frame) => frame.text)
      .join("");
    expect(output).toContain(SIMULATED_TERMINAL_NOTICE);
    expect(output).toContain("Demo commands:");
    expect(output).toContain(UNKNOWN_COMMAND_TEXT);
  });

  test("closes a task with a direct merge and imports a GitHub issue as a Backlog task", async () => {
    const demo = openDemo();
    const reviewed = await taskOf(demo, "Open search with a keyboard shortcut");
    const merged = await demo.client.taskDirectMerge(FIELDNOTES, reviewed.id, {
      expected: {
        taskStatus: reviewed.status,
        sourceBranch: "odt/branch",
        targetBranch: { remote: "origin", branch: "main" },
      },
      mergeMethod: "squash",
      removeWorktree: true,
    });
    expect(merged.outcome === "completed" && merged.task.status).toBe("closed");
    expect(await demo.client.taskWorktreeGet(FIELDNOTES, reviewed.id)).toBeNull();

    const issues = await demo.client.issueItemsList({ ...FIELDNOTES, search: "accents" });
    const issue = issues.items[0];
    if (!issue) throw new Error("The sample has no matching issue.");
    const imported = await demo.client.issueItemsImport({
      ...FIELDNOTES,
      items: [
        {
          sourceId: issue.sourceId,
          revision: issue.revision,
          issueType: "bug",
          priority: 1,
          labels: [],
        },
      ],
    });
    const result = imported.results[0];
    if (result?.outcome !== "created") throw new Error("The issue was not imported.");
    const task = await taskOf(demo, issue.title);
    expect(task).toMatchObject({ id: result.taskId, status: "open", issueType: "bug" });
    expect(task.sourceIssue?.number).toBe(issue.number);
  });

  test("forks, renames, archives, and restores a chat", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const { chat, externalSessionId } = await chatOf(demo, "Why do tags drop on sync?");
    const historyOf = (sessionId: string, workingDirectory: string) =>
      demo.client.agentRuntimeLoadSessionHistory({
        repoPath: FIELDNOTES.repoPath,
        runtimeKind: "claude",
        workingDirectory,
        externalSessionId: sessionId,
        runtimePolicy: { kind: "claude" },
        limit: 200,
      });
    const source = await historyOf(externalSessionId, chat.executionTarget.workingDirectory);
    const answer = source.findLast((message) => message.role === "assistant");
    if (!answer) throw new Error("The sample chat has no answer.");
    const fork = await demo.client.workspaceSessionFork({
      workspaceId: "fieldnotes",
      sessionId: chat.id,
      forkPoint: { messageId: answer.messageId },
      destination: { kind: "same_folder" },
    });
    const forkHistory = await historyOf(
      fork.runtimeSession.externalSessionId,
      fork.runtimeSession.workingDirectory,
    );
    expect(forkHistory.map((message) => message.messageId)).toEqual(
      source.map((message) => message.messageId),
    );
    const renamed = await demo.client.workspaceSessionRename({
      workspaceId: "fieldnotes",
      sessionId: chat.id,
      manualTitle: "Tag sync",
    });
    expect(renamed.manualTitle).toBe("Tag sync");
    await demo.client.workspaceSessionArchive({
      workspaceId: "fieldnotes",
      sessionId: chat.id,
      confirmStop: false,
      removeWorktree: false,
    });
    const archived = await demo.client.workspaceSessionListArchived("fieldnotes");
    expect(archived.map((session) => session.id)).toContain(chat.id);
    await demo.client.workspaceSessionRestore({ workspaceId: "fieldnotes", sessionId: chat.id });
    const active = await demo.client.workspaceSessionListActive("fieldnotes");
    expect(active.map((session) => session.id)).toContain(chat.id);
  });

  test("queues a message during a run and sends it after the run ends", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const { chat, externalSessionId } = await chatOf(demo, "How does search rank notes?");
    const target = {
      repoPath: FIELDNOTES.repoPath,
      runtimeKind: chat.runtimeKind,
      workingDirectory: chat.executionTarget.workingDirectory,
      externalSessionId,
      sessionScope: { kind: "repository" as const, workspaceId: "fieldnotes" },
    };
    const send = (submissionId: string, text: string) =>
      demo.client.agentSessionMessageSubmit({
        ...target,
        submissionId,
        mode: "default",
        parts: [{ kind: "text", text }],
      });
    expect((await send("11111111-1111-4111-8111-000000000001", "Where is search?")).kind).toBe(
      "accepted",
    );
    const queued = await send("11111111-1111-4111-8111-000000000002", "And the ranking?");
    expect(queued.kind).toBe("queued");
    await demo.advance(30_000);
    const { sessionScope: _scope, ...ref } = target;
    const live = await demo.client.agentSessionLiveRead(ref);
    // The queued message left the queue: the session ran it after the first turn.
    const queue = await demo.client.agentSessionMessageQueueManage({
      ...target,
      action: { kind: "resume" },
    });
    expect(queue.queue.entries).toEqual([]);
    expect(queue.queue.revision).toBeGreaterThan(1);
    expect(live.type === "live" && live.session.activity).toBe("idle");
  });

  test("launches a deferred workspace session with auto-named worktree and structured steps", async () => {
    const demo = openDemo();
    await observeLive(demo);
    const launchPromise = demo.client.workspaceSessionLaunch({
      workspaceId: FIELDNOTES.workspaceId,
      repoPath: FIELDNOTES.repoPath,
      draftId: "draft-demo-1",
      runtimeKind: "codex",
      selectedModel: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-6-astra" },
      customAgentRoleId: null,
      targetBranch: { remote: "origin", branch: "main" },
      location: "local_worktree",
      worktree: { mode: "from_name", name: "", branchName: null },
      parts: [{ kind: "text", text: "Audit markdown indexing latency" }],
      startup: { startupAttemptId: "attempt-demo-1", operationId: "op-demo-1" },
    });
    await demo.advance(5_000);
    const result = await launchPromise;
    expect(result.status).toBe("completed");
    expect(result.sessionId).toBeDefined();
    expect(result.record?.executionTarget.kind).toBe("local_worktree");
    if (result.record?.executionTarget.kind === "local_worktree") {
      expect(result.record.executionTarget.branchName).toContain("audit-markdown-indexing-latency");
    }
    expect(result.acceptedMessage).toBeDefined();
    const stepIds = result.startupProgress?.steps.map((step) => step.id) ?? [];
    expect(stepIds).toContain("naming");
    expect(stepIds).toContain("checkout");
    expect(stepIds).toContain("prepare");
    expect(stepIds).toContain("instruction");
  });
});
