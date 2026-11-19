import {
  type AcceptedAgentInput,
  type AcceptedAgentUserMessage,
  type AgentMessageQueueSnapshot,
  type AgentQueuedMessage,
  type AgentSessionActivity,
  type AgentSessionControlSummary,
  type AgentSessionGoal,
  type AgentSessionHistoryMessage,
  type AgentSessionLiveEnvelope,
  type AgentSessionLivePendingApprovalRequest,
  type AgentSessionLivePendingQuestionRequest,
  type AgentSessionLiveRef,
  type AgentSessionLiveSnapshot,
  type AgentSessionLiveSnapshotEnvelope,
  type AgentSessionModelSelection,
  type AgentSessionRecord,
  type AgentSessionScope,
  type AgentSessionTranscriptEvent,
  type AgentToolPart,
  type AgentTranscriptSessionTodoItem,
  type AgentTranscriptStreamPart,
  type AgentTranscriptUserMessageDisplayPart,
  GOAL_SLASH_COMMAND,
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  type RuntimeKind,
  type WorkspaceSession,
} from "@openducktor/contracts";
import {
  type AgentSessionGoalCommand,
  type AgentUserMessagePart,
  classifySystemSlashCommandInvocation,
  goalCommandStartsWork,
} from "@openducktor/core";
import type { HostClient } from "@openducktor/host-client";
import type { DemoRunScript, DemoRunStep } from "./demo-script";
import {
  type DemoWorkspace,
  type DemoWorld,
  findWorkspace,
  findWorkspaceByRepo,
} from "./demo-world";

/** The time between two steps of a scripted run. A run of eight steps ends within 15 seconds. */
const DEMO_STEP_MS = 1300;
const TOOL_RUN_MS = 700;
const CONTEXT_WINDOW = 200_000;
const QUEUE_STOPPED = "The run stopped. Resume the queue to send the next message.";

type UserMessagePart = Parameters<HostClient["agentSessionMessageSubmit"]>[0]["parts"][number];

export type DemoSessionOwner =
  | { kind: "chat"; record: WorkspaceSession }
  | { kind: "task"; taskId: string; role: string }
  /** A finished subagent: its history opens read-only from the card in its parent session. */
  | { kind: "subagent"; parent: DemoSession };

type Run = {
  messageId: string;
  steps: DemoRunStep[];
  index: number;
  script: DemoRunScript;
  startedAtMs: number;
  cancel: (() => void) | null;
  waiting: "permission" | "question" | null;
  rejected: boolean;
  partNumber: number;
};

export type DemoSession = {
  ref: AgentSessionLiveRef;
  workspace: DemoWorkspace;
  owner: DemoSessionOwner;
  title: string;
  startedAt: string;
  model: AgentSessionModelSelection;
  activity: AgentSessionActivity;
  history: AgentSessionHistoryMessage[];
  todos: AgentTranscriptSessionTodoItem[];
  pendingApprovals: AgentSessionLivePendingApprovalRequest[];
  pendingQuestions: AgentSessionLivePendingQuestionRequest[];
  /** The queued messages. `pause` holds the reason while the queue waits for the user. */
  queue: { revision: number; entries: AgentQueuedMessage[]; pause: string | null };
  run: Run | null;
  contextTokens: number;
  lastActivityAt: number;
  /** True while the sample data builds the session, so it sends no live events. */
  quiet: boolean;
  /** The goal of Goal mode, which the runtime reports in the live state. */
  goal?: AgentSessionGoal;
  /** The run that Stop cut off, and its first step that did not finish, for a continuation. */
  interrupted?: { script: DemoRunScript; index: number; rejected: boolean };
};

export const runtimeIdOf = (runtimeKind: RuntimeKind): string => `demo-${runtimeKind}-1`;

const textOf = (parts: readonly UserMessagePart[]): string =>
  parts
    .map((part) => {
      switch (part.kind) {
        case "text":
          return part.text;
        case "slash_command":
          return `/${part.command.trigger}`;
        case "file_reference":
          return `@${part.file.path}`;
        case "skill_mention":
          return `$${part.skill.name}`;
        case "subagent_reference":
          return `@${part.subagent.name}`;
        case "attachment":
          return "";
      }
    })
    .filter(Boolean)
    .join(" ");

const displayPartsOf = (
  parts: readonly UserMessagePart[],
): AgentTranscriptUserMessageDisplayPart[] =>
  parts.map((part): AgentTranscriptUserMessageDisplayPart => {
    switch (part.kind) {
      case "text":
        return { kind: "text", text: part.text };
      case "slash_command":
        return { kind: "text", text: `/${part.command.trigger}` };
      case "file_reference":
        return { kind: "file_reference", file: part.file };
      case "skill_mention":
        return { kind: "skill_mention", skill: part.skill };
      case "subagent_reference":
        return { kind: "subagent_reference", subagent: part.subagent };
      case "attachment":
        return { kind: "attachment", attachment: part.attachment };
    }
  });

/**
 * The agent sessions of the demo: their records, their live state, their history, and their
 * scripted runs. Every change goes out on the live stream of its repository, so the Sessions
 * list, the session screen, and the task views show the same state.
 */
export const createDemoSessionEngine = (world: DemoWorld) => {
  const { clock, events } = world;
  const sessions = new Map<string, DemoSession>();
  const liveSequence = new Map<string, number>();
  let messageNumber = 1;
  let editNumber = 1;

  const nextSequence = (repoPath: string): number => {
    const next = (liveSequence.get(repoPath) ?? 0) + 1;
    liveSequence.set(repoPath, next);
    return next;
  };

  const keyOf = (ref: Pick<AgentSessionLiveRef, "externalSessionId">) => ref.externalSessionId;

  const find = (ref: Pick<AgentSessionLiveRef, "externalSessionId">): DemoSession => {
    const session = sessions.get(keyOf(ref));
    if (!session) throw new Error("This session is no longer in the demo. Refresh the list.");
    return session;
  };

  const isLive = (session: DemoSession): boolean =>
    session.owner.kind === "task" ||
    (session.owner.kind === "chat" && session.owner.record.archivedAt === null);

  const snapshotOf = (session: DemoSession): AgentSessionLiveSnapshot => {
    const snapshot: AgentSessionLiveSnapshot = {
      ref: session.ref,
      activity: session.activity,
      foregroundTurnActive: session.run !== null,
      title: session.title,
      startedAt: session.startedAt,
      pendingApprovals: session.pendingApprovals,
      pendingQuestions: session.pendingQuestions,
      contextUsage: {
        totalTokens: session.contextTokens,
        contextWindow: CONTEXT_WINDOW,
        providerId: session.model.providerId,
        modelId: session.model.modelId,
      },
      model: { ...session.model },
    };
    if (session.goal) snapshot.goal = { ...session.goal };
    // Only a chat names its workspace. A task session belongs to its task records.
    if (session.owner.kind === "chat")
      snapshot.repositoryScope = {
        kind: "repository",
        workspaceId: session.workspace.record.workspaceId,
        title: session.title,
      };
    return snapshot;
  };

  const queueOf = (session: DemoSession): AgentMessageQueueSnapshot => ({
    target: { ...session.ref, sessionScope: scopeOf(session) },
    revision: session.queue.revision,
    entries: session.queue.entries,
    pause: session.queue.pause === null ? null : { message: session.queue.pause },
  });

  const scopeOf = (session: DemoSession): AgentSessionScope => {
    switch (session.owner.kind) {
      case "chat":
        return {
          kind: "repository",
          workspaceId: session.workspace.record.workspaceId,
          title: session.title,
        };
      case "task":
        return {
          kind: "workflow",
          workspaceId: session.workspace.record.workspaceId,
          taskId: session.owner.taskId,
          role: session.owner.role,
        };
      case "subagent":
        return scopeOf(session.owner.parent);
    }
  };

  /** Publishes the live state of a session. Returns its live sequence. */
  const upsert = (session: DemoSession): number => {
    const sequence = nextSequence(session.ref.repoPath);
    if (!session.quiet)
      events.live({ type: "session_upsert", session: snapshotOf(session), sequence });
    return sequence;
  };

  const publishQueue = (session: DemoSession) => {
    session.queue.revision += 1;
    if (!session.quiet) events.live({ type: "message_queue_updated", queue: queueOf(session) });
  };

  type TaskSessionRecordsEnvelope = Extract<
    AgentSessionLiveEnvelope,
    { type: "task_session_records_updated" }
  >;

  type TranscriptBody = AgentSessionTranscriptEvent extends infer Event
    ? Event extends AgentSessionTranscriptEvent
      ? Omit<Event, "externalSessionId" | "timestamp" | "sessionRef">
      : never
    : never;

  const transcript = (session: DemoSession, body: TranscriptBody) => {
    if (session.quiet) return;
    // SAFETY: each body is one transcript event without the three fields that this adds.
    events.live({
      type: "transcript_event",
      event: {
        ...body,
        externalSessionId: session.ref.externalSessionId,
        timestamp: clock.nowIso(),
        sessionRef: session.ref,
      } as AgentSessionTranscriptEvent,
    });
  };

  /** The saved chat changes, as the host reports chat record updates. */
  const publishChat = (session: DemoSession) => {
    if (session.owner.kind !== "chat" || session.quiet) return;
    session.owner.record = {
      ...session.owner.record,
      lastActivityAt: session.lastActivityAt,
      updatedAt: Math.max(session.owner.record.updatedAt, session.lastActivityAt),
    };
    events.workspaceSessionUpdated({
      workspaceId: session.workspace.record.workspaceId,
      session: session.owner.record,
    });
  };

  const assistantEntry = (session: DemoSession, run: Run) => {
    const found = session.history.find(
      (message) => message.role === "assistant" && message.messageId === run.messageId,
    );
    if (found?.role !== "assistant") throw new Error("The demo run lost its message.");
    return found;
  };

  const addPart = (session: DemoSession, run: Run, part: AgentTranscriptStreamPart) => {
    const entry = assistantEntry(session, run);
    const at = entry.parts.findIndex((existing) => existing.partId === part.partId);
    if (at >= 0) entry.parts[at] = part;
    else entry.parts.push(part);
    if (part.kind === "text") entry.text = part.text;
    transcript(session, { type: "assistant_part", part });
  };

  const partId = (run: Run) => `${run.messageId}-p${run.partNumber++}`;

  const schedule = (session: DemoSession, run: Run, delayMs: number, next: () => void) => {
    if (session.quiet) {
      next();
      return;
    }
    run.cancel = clock.after(delayMs, () => {
      run.cancel = null;
      if (session.run === run) next();
    });
  };

  const executeStep = (session: DemoSession, run: Run, step: DemoRunStep) => {
    switch (step.kind) {
      case "reasoning":
        addPart(session, run, {
          kind: "reasoning",
          messageId: run.messageId,
          partId: partId(run),
          text: step.text,
          completed: true,
        });
        advance(session, run);
        return;
      case "todos":
        session.todos = step.todos;
        transcript(session, { type: "session_todos_updated", todos: step.todos });
        advance(session, run);
        return;
      case "tool": {
        if (step.needsApproval && run.rejected) {
          advance(session, run, 0);
          return;
        }
        const id = partId(run);
        const startedAtMs = clock.now();
        const running: AgentToolPart = {
          kind: "tool",
          messageId: run.messageId,
          partId: id,
          callId: `call-${id}`,
          tool: step.tool,
          toolType: step.toolType,
          title: step.title,
          status: "running",
          startedAtMs,
        };
        if (step.input) running.input = step.input;
        addPart(session, run, running);
        schedule(session, run, TOOL_RUN_MS, () => {
          const fileDiffs = step.edit?.();
          const completed: AgentToolPart = {
            ...running,
            status: "completed",
            endedAtMs: clock.now(),
          };
          if (step.output) completed.output = step.output;
          if (fileDiffs && fileDiffs.length > 0) completed.fileDiffs = fileDiffs;
          addPart(session, run, completed);
          advance(session, run);
        });
        return;
      }
      case "permission": {
        run.waiting = "permission";
        session.pendingApprovals = [
          {
            requestId: `${run.messageId}-permission`,
            requestType: "file_change",
            title: step.title,
            summary: "The agent wants to change files in its worktree.",
            affectedPaths: step.paths,
            tool: { name: "edit", title: step.title },
            mutation: "mutating",
            supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
          },
        ];
        session.activity = "waiting_for_permission";
        upsert(session);
        return;
      }
      case "question":
        run.waiting = "question";
        session.pendingQuestions = [
          { requestId: `${run.messageId}-question`, questions: step.questions, blocking: true },
        ];
        session.activity = "waiting_for_question";
        upsert(session);
        return;
      case "text":
        addPart(session, run, {
          kind: "text",
          messageId: run.messageId,
          partId: partId(run),
          text: run.rejected && run.script.rejectedText ? run.script.rejectedText : step.text,
          completed: true,
        });
        advance(session, run, 0);
        return;
    }
  };

  const advance = (session: DemoSession, run: Run, delayMs = DEMO_STEP_MS) => {
    if (run.waiting) return;
    const step = run.steps[run.index];
    run.index += 1;
    if (!step) {
      schedule(session, run, 0, () => finishRun(session, run));
      return;
    }
    schedule(session, run, delayMs, () => executeStep(session, run, step));
  };

  const finishRun = (session: DemoSession, run: Run) => {
    // A finish step with the stop reason marks the final answer of a turn, as runtimes report it.
    addPart(session, run, {
      kind: "step",
      messageId: run.messageId,
      partId: partId(run),
      phase: "finish",
      reason: "stop",
    });
    const entry = assistantEntry(session, run);
    const durationMs = clock.now() - run.startedAtMs;
    entry.forkPoint = { messageId: run.messageId };
    entry.durationMs = durationMs;
    entry.timestamp = clock.nowIso();
    transcript(session, {
      type: "assistant_message",
      messageId: run.messageId,
      forkPoint: { messageId: run.messageId },
      message: entry.text,
      durationMs,
      model: { ...session.model },
    });
    // The role outcome applies only when the run ends normally, inside the turn, as the workflow
    // tool call of a real agent does. A refused outcome fails the turn and shows its reason.
    let failure: string | null = null;
    try {
      run.script.onComplete?.();
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      transcript(session, { type: "session_error", message: failure });
    }
    transcript(session, { type: "session_idle", turnOutcome: failure ? "failed" : "completed" });
    session.run = null;
    session.activity = "idle";
    // A rejected edit or a failed outcome leaves the goal unmet until the next message.
    if (session.goal?.status === "active")
      session.goal.status = run.rejected || failure ? "waiting_for_message" : "complete";
    session.contextTokens += 2_400 + entry.text.length * 3;
    session.lastActivityAt = clock.now();
    if (failure && session.queue.entries.length > 0) {
      session.queue.pause = QUEUE_STOPPED;
      publishQueue(session);
    }
    upsert(session);
    publishChat(session);
    drainQueue(session);
  };

  /** Starts a scripted run. The session shows as working at once. */
  const startRun = (session: DemoSession, script: DemoRunScript, rejected = false) => {
    const run: Run = {
      messageId: `a-${messageNumber++}`,
      steps: script.steps,
      index: 0,
      script,
      startedAtMs: clock.now(),
      cancel: null,
      waiting: null,
      rejected,
      partNumber: 1,
    };
    session.history.push({
      role: "assistant",
      messageId: run.messageId,
      timestamp: clock.nowIso(),
      text: "",
      parts: [],
      model: { ...session.model },
    });
    session.run = run;
    session.activity = "running";
    delete session.interrupted;
    if (session.goal?.status === "waiting_for_message") session.goal.status = "active";
    upsert(session);
    transcript(session, { type: "session_status", status: { type: "busy", message: null } });
    advance(session, run, session.quiet ? 0 : DEMO_STEP_MS / 2);
  };

  /** Adds a user message to the history and the transcript. */
  const acceptUserMessage = (
    session: DemoSession,
    parts: readonly UserMessagePart[],
    submissionId?: string,
  ): AcceptedAgentUserMessage => {
    const messageId = `u-${messageNumber++}`;
    const timestamp = clock.nowIso();
    const message = textOf(parts);
    const displayParts = displayPartsOf(parts);
    session.history.push({
      role: "user",
      messageId,
      timestamp,
      text: message,
      displayParts,
      state: "read",
      parts: [],
    });
    session.lastActivityAt = clock.now();
    const accepted: AcceptedAgentUserMessage = {
      type: "user_message",
      externalSessionId: session.ref.externalSessionId,
      timestamp,
      sessionRef: session.ref,
      messageId,
      message,
      parts: displayParts,
      state: "read",
      model: { ...session.model },
    };
    if (submissionId) accepted.submissionId = submissionId;
    const {
      type: _type,
      externalSessionId: _id,
      timestamp: _at,
      sessionRef: _ref,
      ...body
    } = accepted;
    transcript(session, { type: "user_message", ...body });
    return accepted;
  };

  /** Builds the scripted answer to a prompt. The world sets it, because it knows the files. */
  let promptScript: (session: DemoSession, text: string) => DemoRunScript = () => ({
    steps: [{ kind: "text", text: "Done." }],
  });

  const requireGoal = (session: DemoSession): AgentSessionGoal => {
    if (!session.goal)
      throw new Error("This session has no goal. Send /goal with an objective first.");
    return session.goal;
  };

  /**
   * Applies a goal command, as the runtime does. `set` and `resume` start work when the session
   * is idle; the goal drives that run.
   */
  const controlGoal = (session: DemoSession, command: AgentSessionGoalCommand) => {
    if (command.kind === "set") session.goal = { objective: command.objective, status: "active" };
    else {
      const goal = requireGoal(session);
      if (command.kind === "clear") delete session.goal;
      else
        session.goal = {
          objective: goal.objective,
          status: command.kind === "pause" ? "paused" : "active",
        };
    }
    upsert(session);
  };

  /** The system command of message parts, as the host classifies `/goal` and `/compact`. */
  const systemCommandOf = (parts: readonly UserMessagePart[]) =>
    // SAFETY: parsed contract parts differ from core parts only by optional fields that are absent.
    classifySystemSlashCommandInvocation([...parts] as AgentUserMessagePart[]);

  /** Throws the reason why `deliver` would refuse these parts now. */
  const checkDeliverable = (session: DemoSession, parts: readonly UserMessagePart[]) => {
    const invocation = systemCommandOf(parts);
    if (invocation.kind === "goal" && invocation.command.kind !== "set") requireGoal(session);
  };

  /** Sends a message that the session can take now: a system command or a prompt. */
  const deliver = (
    session: DemoSession,
    parts: readonly UserMessagePart[],
    submissionId?: string,
  ): AcceptedAgentInput => {
    const invocation = systemCommandOf(parts);
    if (invocation.kind === "manual_session_compaction") {
      // Compaction summarizes the transcript, so the context gets small again.
      session.contextTokens = 9_800;
      upsert(session);
      return {
        type: "command_accepted",
        commandName: MANUAL_SESSION_COMPACTION_SLASH_COMMAND.trigger,
      };
    }
    if (invocation.kind === "goal") {
      const { command } = invocation;
      controlGoal(session, command);
      if (!goalCommandStartsWork(command))
        return { type: "command_accepted", commandName: GOAL_SLASH_COMMAND.trigger };
      const accepted = acceptUserMessage(session, parts, submissionId);
      startRun(session, promptScript(session, session.goal?.objective ?? accepted.message));
      return accepted;
    }
    const accepted = acceptUserMessage(session, parts, submissionId);
    startRun(session, promptScript(session, accepted.message));
    return accepted;
  };

  /** Continues the turn that Stop cut off, as a runtime resumes an interrupted turn. */
  const continueRun = (session: DemoSession) => {
    if (session.run) throw new Error("This session is already working.");
    const stopped = session.interrupted;
    if (!stopped)
      throw new Error("This session has no stopped turn to continue. Send a message instead.");
    // A rejected edit stays rejected, so the continuation does not make it.
    startRun(
      session,
      { ...stopped.script, steps: stopped.script.steps.slice(stopped.index) },
      stopped.rejected,
    );
  };

  /** Only a normal end sends the next queued message, as on a real host. */
  const drainQueue = (session: DemoSession) => {
    // A command that starts no turn lets the next message go at once.
    while (!session.run && session.queue.pause === null) {
      // The queue keeps its order: a first message that the user edits holds the others.
      const next = session.queue.entries[0];
      if (next?.state !== "queued") return;
      try {
        checkDeliverable(session, next.parts);
      } catch (error) {
        // The message stays, so the user can edit or remove it.
        const reason = error instanceof Error ? error.message : String(error);
        session.queue.pause = `${reason} Edit or remove the first message, then resume the queue.`;
        publishQueue(session);
        return;
      }
      session.queue.entries = session.queue.entries.filter(
        (entry) => entry.submissionId !== next.submissionId,
      );
      publishQueue(session);
      deliver(session, next.parts, next.submissionId);
    }
  };

  /** Stops the run at once and drops its pending requests. The outcome does not apply. */
  const stopRun = (session: DemoSession) => {
    const run = session.run;
    if (!run) return;
    run.cancel?.();
    // A tool that ran when Stop came ends there, so no part stays running after the turn.
    for (const part of assistantEntry(session, run).parts) {
      if (part.kind === "tool" && (part.status === "running" || part.status === "pending"))
        addPart(session, run, {
          ...part,
          status: "error",
          error: "Stopped by the user.",
          endedAtMs: clock.now(),
        });
    }
    session.run = null;
    // The step that ran or waited when Stop came runs again on a continuation.
    session.interrupted = {
      script: run.script,
      index: Math.max(run.index - 1, 0),
      rejected: run.rejected,
    };
    session.pendingApprovals = [];
    session.pendingQuestions = [];
    session.activity = "idle";
    if (session.goal?.status === "active")
      session.goal = { ...session.goal, status: "paused", reason: "Stopped by the user" };
    const entry = assistantEntry(session, run);
    if (!entry.text) entry.text = "Stopped.";
    transcript(session, { type: "session_idle", turnOutcome: "interrupted" });
    if (session.queue.entries.length > 0) {
      session.queue.pause = QUEUE_STOPPED;
      publishQueue(session);
    }
    upsert(session);
    publishChat(session);
  };

  const summaryOf = (session: DemoSession): AgentSessionControlSummary => ({
    externalSessionId: session.ref.externalSessionId,
    runtimeKind: session.ref.runtimeKind,
    workingDirectory: session.ref.workingDirectory,
    title: session.title,
    startedAt: session.startedAt,
    status: session.run ? "running" : "idle",
    firstTurnCompleted: session.history.some((message) => message.role === "assistant"),
    model: { ...session.model },
  });

  const taskRecordOf = (session: DemoSession): AgentSessionRecord => {
    if (session.owner.kind !== "task") throw new Error("This session belongs to no task.");
    return {
      externalSessionId: session.ref.externalSessionId,
      role: session.owner.role,
      startedAt: session.startedAt,
      lastActivityAt: session.lastActivityAt,
      runtimeKind: session.ref.runtimeKind,
      workingDirectory: session.ref.workingDirectory,
      selectedModel: { ...session.model, runtimeKind: session.ref.runtimeKind },
    };
  };

  const taskSessions = (workspace: DemoWorkspace, taskId: string) =>
    [...sessions.values()].filter(
      (session) =>
        session.workspace === workspace &&
        session.owner.kind === "task" &&
        session.owner.taskId === taskId,
    );

  /** Publishes the session records of a task, with the live state of one of its sessions. */
  const publishTaskRecords = (workspace: DemoWorkspace, taskId: string, live?: DemoSession) => {
    const sequence = nextSequence(workspace.record.repoPath);
    const envelope: TaskSessionRecordsEnvelope = {
      type: "task_session_records_updated",
      workspaceId: workspace.record.workspaceId,
      repoPath: workspace.record.repoPath,
      taskId,
      agentSessions: taskSessions(workspace, taskId).map(taskRecordOf),
      sequence,
    };
    if (live) envelope.liveSession = snapshotOf(live);
    events.live(envelope);
    return sequence;
  };

  const create = <Owner extends DemoSessionOwner>(input: {
    externalSessionId: string;
    workspace: DemoWorkspace;
    owner: Owner;
    runtimeKind: RuntimeKind;
    workingDirectory: string;
    title: string;
    model: AgentSessionModelSelection;
    startedAtMs: number;
    quiet?: boolean;
  }): DemoSession & { owner: Owner } => {
    const session: DemoSession & { owner: Owner } = {
      ref: {
        repoPath: input.workspace.record.repoPath,
        runtimeKind: input.runtimeKind,
        workingDirectory: input.workingDirectory,
        externalSessionId: input.externalSessionId,
      },
      workspace: input.workspace,
      owner: input.owner,
      title: input.title,
      startedAt: new Date(input.startedAtMs).toISOString(),
      model: { ...input.model, runtimeKind: input.runtimeKind },
      activity: "idle",
      history: [],
      todos: [],
      pendingApprovals: [],
      pendingQuestions: [],
      queue: { revision: 0, entries: [], pause: null },
      run: null,
      contextTokens: 9_800,
      lastActivityAt: input.startedAtMs,
      quiet: input.quiet ?? false,
    };
    sessions.set(input.externalSessionId, session);
    return session;
  };

  /** Ends the live state of a session, as an archive does. The record stays. */
  const retire = (session: DemoSession) => {
    stopRun(session);
    const sequence = nextSequence(session.ref.repoPath);
    events.live({ type: "session_removed", ref: session.ref, sequence });
  };

  /** Removes a session and its live state, as a task reset does. */
  const forget = (session: DemoSession) => {
    retire(session);
    sessions.delete(keyOf(session.ref));
  };

  const snapshotEnvelope = (repoPath: string): AgentSessionLiveSnapshotEnvelope => {
    const inRepo = [...sessions.values()].filter(
      (session) => session.ref.repoPath === repoPath && isLive(session),
    );
    return {
      type: "snapshot",
      repoPath,
      sessions: inRepo.map(snapshotOf),
      messageQueues: inRepo.filter((session) => session.queue.revision > 0).map(queueOf),
      sequence: liveSequence.get(repoPath) ?? 0,
    };
  };

  /** Copies the history of a session up to and including `messageId`, as a fork does. */
  const copyHistory = (session: DemoSession, messageId: string): AgentSessionHistoryMessage[] => {
    const end = session.history.findIndex((message) => message.messageId === messageId);
    if (end < 0) throw new Error("This message is not in the session. Choose another message.");
    return structuredClone(session.history.slice(0, end + 1));
  };

  const historyOf = (session: DemoSession) => structuredClone(session.history);

  const handlers = {
    agentSessionLiveAttach: async ({ repoPath }) => snapshotEnvelope(repoPath),
    agentSessionLiveList: async ({ repoPath }) => snapshotEnvelope(repoPath).sessions,
    agentSessionLiveRefresh: async () => {},
    agentSessionLiveRead: async (ref) => {
      const session = sessions.get(keyOf(ref));
      return session && isLive(session)
        ? { type: "live", session: snapshotOf(session) }
        : { type: "missing", ref };
    },
    agentSessionLiveLoadContext: async (ref) => {
      const session = find(ref);
      return {
        totalTokens: session.contextTokens,
        contextWindow: CONTEXT_WINDOW,
        providerId: session.model.providerId,
        modelId: session.model.modelId,
      };
    },
    agentSessionLiveLoadDiff: async (ref) => diffsOf(find(ref)),
    agentRuntimeLoadSessionDiff: async (ref) => diffsOf(find(ref)),
    agentRuntimeFileStatus: async () => [],
    agentRuntimeLoadSessionHistory: async (input) => historyOf(find(input)),
    agentRuntimeLoadSessionTodos: async (input) => find(input).todos,
    agentRuntimeLoadSessionToolPart: async (input) => {
      const session = find(input);
      for (const message of session.history) {
        for (const part of message.parts) {
          if (part.kind === "tool" && part.partId === input.partId) return part;
        }
      }
      throw new Error("This tool call is not in the session history. Refresh the session.");
    },
    agentSessionMessageSubmit: async (input) => {
      const session = find(input);
      // A command that the host refuses fails at submit, before it waits in the queue.
      const invocation = systemCommandOf(input.parts);
      if (invocation.kind !== "not_system" && input.mode === "steer" && session.run)
        throw new Error("A slash command cannot join running work.");
      // Steering adds the message to the running turn at once.
      if (input.mode === "steer" && session.run)
        return {
          kind: "accepted",
          acceptedMessage: acceptUserMessage(session, input.parts, input.submissionId),
        };
      if (session.run || session.queue.entries.length > 0 || session.queue.pause !== null) {
        session.queue.entries = [
          ...session.queue.entries,
          {
            submissionId: input.submissionId,
            parts: input.parts,
            queuedAt: clock.nowIso(),
            state: "queued",
          },
        ];
        publishQueue(session);
        return { kind: "queued", queue: queueOf(session) };
      }
      return {
        kind: "accepted",
        acceptedMessage: deliver(session, input.parts, input.submissionId),
      };
    },
    agentSessionMessageQueueManage: async (input) => {
      const session = find(input);
      const { action } = input;
      const entries = session.queue.entries;
      const at =
        "submissionId" in action
          ? entries.findIndex((entry) => entry.submissionId === action.submissionId)
          : -1;
      const entry = at >= 0 ? entries[at] : undefined;
      const currentEdit = (editId: string) => {
        if (entry?.state !== "editing" || entry.editId !== editId)
          throw new Error("This edit is no longer current. Open the queued message again.");
        return entry;
      };
      let steered: AcceptedAgentUserMessage | undefined;
      switch (action.kind) {
        case "begin_edit":
          if (entry?.state !== "queued") throw new Error("This message already left the queue.");
          entries[at] = { ...entry, state: "editing", editId: `edit-${editNumber++}` };
          break;
        case "save_edit": {
          const edited = currentEdit(action.editId);
          entries[at] = {
            submissionId: edited.submissionId,
            parts: action.parts,
            queuedAt: edited.queuedAt,
            state: "queued",
          };
          break;
        }
        case "cancel_edit": {
          const edited = currentEdit(action.editId);
          entries[at] = {
            submissionId: edited.submissionId,
            parts: edited.parts,
            queuedAt: edited.queuedAt,
            state: "queued",
          };
          break;
        }
        case "remove":
          session.queue.entries = entries.filter((_, index) => index !== at);
          break;
        case "steer":
          if (entry?.state !== "queued") throw new Error("This message already left the queue.");
          if (session.run && systemCommandOf(entry.parts).kind !== "not_system")
            throw new Error("A slash command cannot join running work.");
          if (!session.run) checkDeliverable(session, entry.parts);
          session.queue.entries = entries.filter((_, index) => index !== at);
          session.queue.pause = null;
          if (session.run) steered = acceptUserMessage(session, entry.parts, entry.submissionId);
          else {
            const delivered = deliver(session, entry.parts, entry.submissionId);
            // A command that starts no work has no message to show.
            if (delivered.type === "user_message") steered = delivered;
          }
          break;
        case "resume":
          session.queue.pause = null;
          break;
      }
      if (steered) {
        publishQueue(session);
        return { queue: queueOf(session), acceptedMessage: steered };
      }
      publishQueue(session);
      const before = session.history.length;
      drainQueue(session);
      const delivered = session.history[before];
      return delivered?.role === "user"
        ? {
            queue: queueOf(session),
            acceptedMessage: {
              type: "user_message",
              externalSessionId: session.ref.externalSessionId,
              timestamp: delivered.timestamp,
              sessionRef: session.ref,
              messageId: delivered.messageId,
              message: delivered.text,
              parts: delivered.displayParts,
              state: "read",
            },
          }
        : { queue: queueOf(session) };
    },
    agentSessionControlStop: async (ref) => stopRun(find(ref)),
    agentSessionGoalControl: async (input) => {
      const session = find(input);
      const command: AgentSessionGoalCommand = { kind: input.action };
      controlGoal(session, command);
      if (goalCommandStartsWork(command) && !session.run && session.goal)
        startRun(session, promptScript(session, session.goal.objective));
    },
    agentSessionControlRelease: async () => {},
    agentSessionUsageLimitAutoResumeCancel: async () => {},
    agentSessionControlUpdateModel: async (input) => {
      const session = find(input);
      if (input.model) session.model = { ...input.model, runtimeKind: session.ref.runtimeKind };
      if (session.owner.kind === "chat") {
        session.owner.record = {
          ...session.owner.record,
          selectedModel: { ...session.model, runtimeKind: session.ref.runtimeKind },
        };
        publishChat(session);
      }
      upsert(session);
    },
    agentSessionLiveReplyApproval: async (input) => {
      const session = find(input);
      const run = session.run;
      if (
        !run ||
        run.waiting !== "permission" ||
        session.pendingApprovals[0]?.requestId !== input.requestId
      )
        throw new Error("This request was already answered. Refresh the session.");
      run.waiting = null;
      run.rejected = input.outcome === "reject";
      session.pendingApprovals = [];
      session.activity = "running";
      upsert(session);
      advance(session, run);
    },
    agentSessionLiveReplyQuestion: async (input) => {
      const session = find(input);
      const run = session.run;
      if (
        !run ||
        run.waiting !== "question" ||
        session.pendingQuestions[0]?.requestId !== input.requestId
      )
        throw new Error("This question was already answered. Refresh the session.");
      run.waiting = null;
      session.pendingQuestions = [];
      session.activity = "running";
      const answer = input.answers.map((answers) => answers.join(", ")).join("; ");
      addPart(session, run, {
        kind: "text",
        messageId: run.messageId,
        partId: partId(run),
        text: `You chose: ${answer}.`,
        completed: true,
      });
      upsert(session);
      advance(session, run);
    },
  } satisfies Partial<HostClient>;

  const diffsOf = (session: DemoSession) =>
    session.history.flatMap((message) =>
      message.parts.flatMap((part) => (part.kind === "tool" ? (part.fileDiffs ?? []) : [])),
    );

  return {
    sessions,
    handlers,
    find,
    create,
    forget,
    retire,
    upsert,
    startRun,
    stopRun,
    continueRun,
    acceptUserMessage,
    deliver,
    copyHistory,
    summaryOf,
    taskRecordOf,
    taskSessions,
    publishTaskRecords,
    publishChat,
    snapshotOf,
    scopeOf,
    setPromptScript(build: typeof promptScript) {
      promptScript = build;
    },
    findWorkspace: (workspaceId: string) => findWorkspace(world, workspaceId),
    findWorkspaceByRepo: (repoPath: string) => findWorkspaceByRepo(world, repoPath),
    /** Ends the sample data setup: the session sends live events from now on. */
    goLive(session: DemoSession) {
      session.quiet = false;
    },
  };
};

export type DemoSessionEngine = ReturnType<typeof createDemoSessionEngine>;
