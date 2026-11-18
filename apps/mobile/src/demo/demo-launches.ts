import type {
  AgentSessionModelSelection,
  AgentWorkflowSessionForkResult,
  RuntimeKind,
  StartupOperationContext,
  StartupOperationSnapshot,
  StartupStep,
  WorkflowLaunchResult,
  WorkspaceSession,
  WorkspaceSessionForkResult,
  WorkspaceSessionStartResult,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { specPlanBuildWorkflow } from "@openducktor/workflows";
import type { DemoCheckout } from "./demo-repository";
import { type DemoRoleOutcomes, kickoffText, promptRun, roleRun } from "./demo-runs";
import type { DemoSession, DemoSessionEngine } from "./demo-sessions";
import { runtimeIdOf } from "./demo-sessions";
import type { DemoTerminals } from "./demo-terminals";
import {
  DEMO_HOST_INSTANCE_ID,
  type DemoTask,
  type DemoWorkspace,
  type DemoWorld,
  findTask,
  findWorkspace,
} from "./demo-world";

const workflow = specPlanBuildWorkflow;

/** A startup snapshot without the fields that `progress` adds. */
type StartupSnapshotBody = Omit<
  StartupOperationSnapshot,
  "context" | "hostInstanceId" | "revision"
>;

/** The time that the scripted worktree setup takes. */
const SETUP_MS = 1800;

type TaskStore = DemoRoleOutcomes & {
  ensureWorktree(
    workspace: DemoWorkspace,
    taskId: string,
  ): { created: boolean; checkout: DemoCheckout };
};

/**
 * Session starts: workflow launches of tasks, and the creation, start, and fork of chats. A start
 * that creates a worktree shows the scripted setup steps, as a real host shows its progress.
 */
export const createDemoLaunches = ({
  world,
  engine,
  tasks,
  terminals,
}: {
  world: DemoWorld;
  engine: DemoSessionEngine;
  tasks: TaskStore;
  terminals: DemoTerminals;
}) => {
  const { clock, events } = world;
  let sessionNumber = 100;
  let chatNumber = 100;
  const revisions = new Map<string, number>();

  const nextSessionId = (runtimeKind: RuntimeKind) => `${runtimeKind}-ses-${sessionNumber++}`;

  const progress = (
    context: StartupOperationContext | undefined,
    snapshot: StartupSnapshotBody,
  ): StartupOperationSnapshot | undefined => {
    if (!context) return undefined;
    const revision = (revisions.get(context.operationId) ?? 0) + 1;
    revisions.set(context.operationId, revision);
    const full: StartupOperationSnapshot = {
      ...snapshot,
      context,
      hostInstanceId: DEMO_HOST_INSTANCE_ID,
      revision,
    };
    events.startupProgress({ channel: "openducktor://session-startup-progress", payload: full });
    return full;
  };

  /** Runs the worktree setup action in a host terminal and reports its steps. */
  const setUpWorktree = async (input: {
    workspace: DemoWorkspace;
    checkout: DemoCheckout;
    context: StartupOperationContext | undefined;
    scope: StartupOperationSnapshot["scope"];
    terminalContext: Parameters<DemoTerminals["runHostAction"]>[0]["context"];
  }): Promise<StartupStep[]> => {
    const { workspace, checkout } = input;
    const worktreeStep: StartupStep = {
      id: "worktree",
      label: "Create worktree",
      state: "completed",
      details: [checkout.workingDirectory],
      resources: [
        { kind: "worktree", value: checkout.workingDirectory, state: "created" },
        { kind: "branch", value: checkout.branch, state: "created" },
      ],
    };
    const setup = workspace.actionOutput.get("setup");
    if (!setup) return [worktreeStep];
    const started = terminals.runHostAction({
      action: setup,
      context: input.terminalContext,
      workingDir: checkout.workingDirectory,
      delayMs: SETUP_MS,
    });
    const action = {
      actionId: "setup",
      command: setup.command,
      waitBeforeAgentStart: true,
      terminalId: started.terminalId,
    };
    const base = {
      workspaceId: workspace.record.workspaceId,
      repoPath: workspace.record.repoPath,
      scope: input.scope,
      ownership: { state: "not_saved" as const },
    };
    progress(input.context, {
      ...base,
      phase: "running",
      steps: [
        worktreeStep,
        { id: "setup", label: setup.name, state: "running", details: [], action },
      ],
    });
    const outputTail = await started.finished;
    return [
      worktreeStep,
      {
        id: "setup",
        label: setup.name,
        state: "completed",
        details: [],
        action: { ...action, result: { type: "exited", exitCode: 0, signal: null, outputTail } },
      },
    ];
  };

  const selectedModelOf = (session: DemoSession): AgentSessionModelSelection => ({
    ...session.model,
    runtimeKind: session.ref.runtimeKind,
  });

  const outcomes: DemoRoleOutcomes = tasks;

  const roleRounds = new Map<string, number>();

  // Workflow launch ------------------------------------------------------------------------------

  const launch: HostClient["agentSessionWorkflowLaunch"] = async (request) => {
    const workspace = findWorkspace(world, request.workspaceId);
    const task = findTask(workspace, request.taskId);
    const pullRequest = request.policy.actionId === "pull_request";
    const role = workflow.launchAction(request.policy.actionId, request.policy.role).role;
    if (request.beforeStartAction)
      tasks.applyEvent(workspace, task.record.id, request.beforeStartAction.eventId);
    const startEvent = pullRequest ? undefined : workflow.roleStartEvent(role);
    if (startEvent && workflow.isEventAvailable(startEvent, task.record))
      tasks.applyEvent(workspace, task.record.id, startEvent);

    const scope = { kind: "task" as const, taskId: task.record.id, role };
    let steps: StartupStep[] = [];
    let workingDirectory = workspace.record.repoPath;
    let checkout = workspace.repository.checkout(workspace.record.repoPath);
    if (workflow.usesWorktree(role) || request.policy.decision.startMode !== "fresh") {
      const worktree = tasks.ensureWorktree(workspace, task.record.id);
      checkout = worktree.checkout;
      workingDirectory = checkout.workingDirectory;
      if (worktree.created)
        steps = await setUpWorktree({
          workspace,
          checkout,
          context: request.startup,
          scope,
          terminalContext: {
            workspaceId: workspace.record.workspaceId,
            repoPath: workspace.record.repoPath,
            taskId: task.record.id,
          },
        });
    }

    const decision = request.policy.decision;
    let session: DemoSession;
    if (decision.startMode === "reuse") {
      session = engine.find(decision.sourceSession);
    } else {
      session = engine.create({
        externalSessionId: nextSessionId(decision.selectedModel.runtimeKind),
        workspace,
        owner: { kind: "task", taskId: task.record.id, role },
        runtimeKind: decision.selectedModel.runtimeKind,
        workingDirectory:
          decision.startMode === "fork"
            ? decision.sourceSession.workingDirectory
            : workingDirectory,
        title: `${workflow.role(role).label}: ${task.record.title}`,
        model: decision.selectedModel,
        startedAtMs: clock.now(),
      });
      if (decision.startMode === "fork") {
        const source = engine.find(decision.sourceSession);
        session.history = engine.copyHistory(source, source.history.at(-1)?.messageId ?? "");
      }
    }
    engine.publishTaskRecords(workspace, task.record.id, session);
    const liveStateSequence = engine.upsert(session);

    let acceptedMessage: ReturnType<DemoSessionEngine["acceptUserMessage"]> | undefined;
    if (request.instruction.kind !== "none") {
      const parts =
        request.instruction.kind === "message"
          ? request.instruction.parts
          : [
              {
                kind: "text" as const,
                text: kickoffText(role, pullRequest, request.instruction),
              },
            ];
      acceptedMessage = engine.acceptUserMessage(session, parts);
      const round = (roleRounds.get(`${task.record.id}:${role}`) ?? 0) + 1;
      roleRounds.set(`${task.record.id}:${role}`, round);
      engine.startRun(
        session,
        roleRun({ workspace, checkout, outcomes }, task, role, { pullRequest, round }),
      );
    }

    const record = engine.taskRecordOf(session);
    const snapshot: StartupSnapshotBody = {
      workspaceId: workspace.record.workspaceId,
      repoPath: workspace.record.repoPath,
      scope,
      phase: "completed",
      steps,
      ownership: {
        state: "saved",
        target: { kind: "task", record, runtimeSession: engine.summaryOf(session) },
      },
      prepared: {
        ref: session.ref,
        runtimeId: runtimeIdOf(session.ref.runtimeKind),
        liveStateSequence,
      },
    };
    if (acceptedMessage)
      snapshot.instruction = { state: "accepted", messageId: acceptedMessage.messageId };
    const startupProgress = progress(request.startup, snapshot);
    const result: WorkflowLaunchResult = {
      workspaceId: workspace.record.workspaceId,
      repoPath: workspace.record.repoPath,
      status: "completed",
      session: engine.summaryOf(session),
      model: selectedModelOf(session),
      taskId: task.record.id,
      role,
      startMode: decision.startMode,
    };
    if (acceptedMessage) result.acceptedMessage = acceptedMessage;
    if (startupProgress) result.startupProgress = startupProgress;
    return result;
  };

  // Chats ----------------------------------------------------------------------------------------

  const chats = (workspace: DemoWorkspace) =>
    [...engine.sessions.values()].filter(
      (session): session is DemoSession & { owner: { kind: "chat"; record: WorkspaceSession } } =>
        session.workspace === workspace && session.owner.kind === "chat",
    );

  const findChat = (workspaceId: string, sessionId: string) => {
    const chat = chats(findWorkspace(world, workspaceId)).find(
      (session) => session.owner.record.id === sessionId,
    );
    if (!chat) throw new Error("This chat is no longer in the demo. Refresh the list.");
    return chat;
  };

  const saveChat = (
    chat: DemoSession & { owner: { kind: "chat"; record: WorkspaceSession } },
    patch: Partial<WorkspaceSession>,
  ) => {
    chat.owner.record = { ...chat.owner.record, ...patch, updatedAt: clock.now() };
    if (patch.manualTitle !== undefined) chat.title = patch.manualTitle ?? chat.title;
    events.workspaceSessionUpdated({
      workspaceId: chat.workspace.record.workspaceId,
      session: chat.owner.record,
    });
    return chat.owner.record;
  };

  /** Starts a chat in a checkout and publishes its live state. Returns the live sequence. */
  const openChat = (input: {
    workspace: DemoWorkspace;
    runtimeKind: RuntimeKind;
    model: AgentSessionModelSelection | null;
    executionTarget: WorkspaceSession["executionTarget"];
    title: string;
    roleSnapshot: WorkspaceSession["roleSnapshot"];
    targetBranch: WorkspaceSession["targetBranch"];
  }) => {
    const now = clock.now();
    const externalSessionId = nextSessionId(input.runtimeKind);
    const model = input.model ?? defaultModel(input.workspace, input.runtimeKind);
    const record: WorkspaceSession = {
      id: `chat-${chatNumber++}`,
      runtimeKind: input.runtimeKind,
      externalSessionId,
      executionTarget: input.executionTarget,
      roleSnapshot: input.roleSnapshot,
      selectedModel: { ...model, runtimeKind: input.runtimeKind },
      generatedTitle: null,
      manualTitle: input.title,
      targetBranch: input.targetBranch,
      createdAt: now,
      lastActivityAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    const session = engine.create({
      externalSessionId,
      workspace: input.workspace,
      owner: { kind: "chat", record },
      runtimeKind: input.runtimeKind,
      workingDirectory: input.executionTarget.workingDirectory,
      title: input.title,
      model,
      startedAtMs: now,
    });
    events.workspaceSessionUpdated({
      workspaceId: input.workspace.record.workspaceId,
      session: record,
    });
    return session;
  };

  const defaultModel = (
    workspace: DemoWorkspace,
    runtimeKind: RuntimeKind,
  ): AgentSessionModelSelection => {
    const fallback = workspace.repoConfig.defaultModel;
    if (fallback && fallback.runtimeKind === runtimeKind) return fallback;
    return runtimeKind === "claude"
      ? { runtimeKind, providerId: "claude", modelId: "claude-lyra-3" }
      : runtimeKind === "codex"
        ? { runtimeKind, providerId: "openai", modelId: "gpt-6-astra" }
        : { runtimeKind, providerId: "vega", modelId: "vega-2-pro" };
  };

  const preparedChat = (
    chat: DemoSession & { owner: { kind: "chat"; record: WorkspaceSession } },
    context: StartupOperationContext | undefined,
    steps: StartupStep[],
  ) => {
    const liveStateSequence = engine.upsert(chat);
    return progress(context, {
      workspaceId: chat.workspace.record.workspaceId,
      repoPath: chat.workspace.record.repoPath,
      scope: { kind: "workspace", sessionId: chat.owner.record.id },
      phase: "completed",
      steps,
      ownership: {
        state: "saved",
        target: {
          kind: "workspace",
          record: chat.owner.record,
          runtimeSession: engine.summaryOf(chat),
        },
      },
      prepared: { ref: chat.ref, runtimeId: runtimeIdOf(chat.ref.runtimeKind), liveStateSequence },
    });
  };

  /** The other active chats and the tasks that use the worktree of a chat. */
  const worktreeOwners = (
    chat: DemoSession & { owner: { kind: "chat"; record: WorkspaceSession } },
  ) => {
    const folder = chat.owner.record.executionTarget.workingDirectory;
    const workspaceId = chat.workspace.record.workspaceId;
    return {
      sharedWith: chats(chat.workspace)
        .filter(
          (other) =>
            other !== chat &&
            other.owner.record.archivedAt === null &&
            other.owner.record.executionTarget.workingDirectory === folder,
        )
        .map((other) => ({ workspaceId, sessionId: other.owner.record.id, title: other.title })),
      taskOwners: [...chat.workspace.tasks.values()]
        .filter((task) => task.worktree?.workingDirectory === folder)
        .map((task) => ({ workspaceId, taskId: task.record.id, title: task.record.title })),
    };
  };

  /** Chats that wait for their start keep the steps of their new worktree. */
  const pendingSteps = new Map<string, StartupStep[]>();

  const handlers = {
    agentSessionWorkflowLaunch: launch,
    agentSessionControlResume: async (input) => engine.summaryOf(engine.find(input)),
    agentSessionWorkflowFork: async (input) => {
      const source = engine.find(input);
      if (source.owner.kind !== "task") throw new Error("Only a task session can fork here.");
      const fork = engine.create({
        externalSessionId: nextSessionId(source.ref.runtimeKind),
        workspace: source.workspace,
        owner: { ...source.owner },
        runtimeKind: source.ref.runtimeKind,
        workingDirectory: source.ref.workingDirectory,
        title: `${source.title} (fork)`,
        model: source.model,
        startedAtMs: clock.now(),
      });
      fork.history = engine.copyHistory(source, input.forkPoint.messageId);
      engine.publishTaskRecords(source.workspace, source.owner.taskId, fork);
      const liveStateSequence = engine.upsert(fork);
      const record = engine.taskRecordOf(fork);
      const startupProgress = progress(input.startup, {
        workspaceId: source.workspace.record.workspaceId,
        repoPath: source.workspace.record.repoPath,
        scope: { kind: "task", taskId: source.owner.taskId, role: source.owner.role },
        phase: "completed",
        steps: [],
        ownership: {
          state: "saved",
          target: { kind: "task", record, runtimeSession: engine.summaryOf(fork) },
        },
        prepared: {
          ref: fork.ref,
          runtimeId: runtimeIdOf(fork.ref.runtimeKind),
          liveStateSequence,
        },
      });
      const result: AgentWorkflowSessionForkResult = {
        record,
        runtimeSession: engine.summaryOf(fork),
      };
      if (startupProgress) result.startupProgress = startupProgress;
      return result;
    },
    agentSessionsListForTasks: async (scope, taskIds) => {
      const workspace = findWorkspace(world, scope.workspaceId);
      return taskIds.map((taskId) => ({
        taskId,
        agentSessions: engine.taskSessions(workspace, taskId).map(engine.taskRecordOf),
      }));
    },
    agentSessionsList: async (scope, taskId) =>
      engine.taskSessions(findWorkspace(world, scope.workspaceId), taskId).map(engine.taskRecordOf),
    workspaceSessionListActive: async (workspaceId) =>
      chats(findWorkspace(world, workspaceId))
        .map((chat) => chat.owner.record)
        .filter((record) => record.archivedAt === null),
    workspaceSessionListArchived: async (workspaceId) =>
      chats(findWorkspace(world, workspaceId))
        .map((chat) => chat.owner.record)
        .filter((record) => record.archivedAt !== null),
    workspaceSessionIdsList: async (workspaceId) =>
      chats(findWorkspace(world, workspaceId)).map((chat) => chat.owner.record.id),
    workspaceSessionGet: async ({ workspaceId, sessionId }) =>
      findChat(workspaceId, sessionId).owner.record,
    workspaceSessionWorktreesList: async (workspaceId) => ({
      worktrees: findWorkspace(world, workspaceId)
        .repository.worktrees()
        .map((checkout) => ({
          workingDirectory: checkout.workingDirectory,
          branchName: checkout.branch,
        })),
    }),
    workspaceSessionCreate: async (input) => {
      const workspace = findWorkspace(world, input.workspaceId);
      let executionTarget: WorkspaceSession["executionTarget"];
      let steps: StartupStep[] = [];
      if (input.location === "local_repo_root") {
        executionTarget = { kind: "local_repo_root", workingDirectory: workspace.record.repoPath };
      } else if (input.location === "existing_worktree") {
        const checkout = workspace.repository.findCheckout(input.existingWorktree.workingDirectory);
        if (!checkout)
          throw new Error("This worktree is not in the demo repository. Choose another worktree.");
        executionTarget = {
          kind: "local_worktree",
          workingDirectory: checkout.workingDirectory,
          branchName: checkout.branch,
          worktreeState: "present",
        };
      } else {
        const branch = input.worktree.branchName ?? `odt/${input.worktree.name}`;
        const workingDirectory = `${workspace.worktreeRoot}/${input.worktree.name}`;
        const checkout = workspace.repository.addWorktree({ workingDirectory, branch });
        executionTarget = {
          kind: "local_worktree",
          workingDirectory,
          branchName: branch,
          worktreeState: "present",
        };
        steps = await setUpWorktree({
          workspace,
          checkout,
          context: input.startup,
          scope: { kind: "workspace" },
          terminalContext: {},
        });
      }
      const role = input.customAgentRoleId
        ? (world.customRoles.find((candidate) => candidate.id === input.customAgentRoleId) ?? null)
        : null;
      const chat = openChat({
        workspace,
        runtimeKind: input.runtimeKind,
        model: input.selectedModel,
        executionTarget,
        title: input.manualTitle?.trim() || "New chat",
        roleSnapshot: role,
        targetBranch: input.targetBranch,
      });
      pendingSteps.set(chat.owner.record.id, steps);
      return { session: chat.owner.record };
    },
    workspaceSessionStart: async ({ workspaceId, sessionId, startup }) => {
      const chat = findChat(workspaceId, sessionId);
      const steps = pendingSteps.get(sessionId) ?? [];
      pendingSteps.delete(sessionId);
      const startupProgress = preparedChat(chat, startup, steps);
      const result: WorkspaceSessionStartResult = {
        session: chat.owner.record,
        runtimeSession: engine.summaryOf(chat),
      };
      if (startupProgress) result.startupProgress = startupProgress;
      return result;
    },
    workspaceSessionFork: async (input) => {
      const source = findChat(input.workspaceId, input.sessionId);
      let executionTarget = source.owner.record.executionTarget;
      let steps: StartupStep[] = [];
      if (input.destination.kind === "new_worktree") {
        const workingDirectory = `${source.workspace.worktreeRoot}/${input.destination.name}`;
        // The fork branch starts from the commits of the source chat.
        const checkout = source.workspace.repository.addWorktree({
          workingDirectory,
          branch: input.destination.branchName,
          from: source.workspace.repository.checkout(source.ref.workingDirectory),
        });
        executionTarget = {
          kind: "local_worktree",
          workingDirectory,
          branchName: input.destination.branchName,
          worktreeState: "present",
        };
        steps = await setUpWorktree({
          workspace: source.workspace,
          checkout,
          context: input.startup,
          scope: { kind: "workspace" },
          terminalContext: {},
        });
      }
      const fork = openChat({
        workspace: source.workspace,
        runtimeKind: source.ref.runtimeKind,
        model: selectedModelOf(source),
        executionTarget,
        title: `${source.title} (fork)`,
        roleSnapshot: source.owner.record.roleSnapshot,
        targetBranch: source.owner.record.targetBranch,
      });
      fork.history = engine.copyHistory(source, input.forkPoint.messageId);
      const startupProgress = preparedChat(fork, input.startup, steps);
      const result: WorkspaceSessionForkResult = {
        record: fork.owner.record,
        runtimeSession: engine.summaryOf(fork),
      };
      if (startupProgress) result.startupProgress = startupProgress;
      return result;
    },
    workspaceSessionRename: async ({ workspaceId, sessionId, manualTitle }) => {
      const chat = findChat(workspaceId, sessionId);
      const record = saveChat(chat, { manualTitle });
      engine.upsert(chat);
      return record;
    },
    workspaceSessionSetTargetBranch: async ({ workspaceId, sessionId, targetBranch }) =>
      saveChat(findChat(workspaceId, sessionId), { targetBranch }),
    workspaceSessionSetDraftModel: async ({ workspaceId, sessionId, selectedModel }) =>
      saveChat(findChat(workspaceId, sessionId), { selectedModel }),
    workspaceSessionArchivePreview: async ({ workspaceId, sessionId }) => {
      const chat = findChat(workspaceId, sessionId);
      const target = chat.owner.record.executionTarget;
      const checkout = chat.workspace.repository.findCheckout(target.workingDirectory);
      return {
        branchName: target.kind === "local_worktree" ? target.branchName : null,
        worktreeExists: target.kind === "local_worktree" && checkout !== null,
        hasUncommittedChanges: (checkout?.uncommitted.size ?? 0) > 0,
        ...worktreeOwners(chat),
      };
    },
    workspaceSessionArchive: async ({ workspaceId, sessionId, removeWorktree }) => {
      const chat = findChat(workspaceId, sessionId);
      engine.stopRun(chat);
      const target = chat.owner.record.executionTarget;
      let executionTarget = target;
      if (removeWorktree && target.kind === "local_worktree") {
        const owners = worktreeOwners(chat);
        if (owners.sharedWith.length > 0 || owners.taskOwners.length > 0)
          throw new Error(
            "Other chats or tasks still use this worktree. Archive them first, or keep the worktree.",
          );
        chat.workspace.repository.removeWorktree(target.workingDirectory);
        executionTarget = { ...target, worktreeState: "removed" };
      }
      const record = saveChat(chat, { archivedAt: clock.now(), executionTarget });
      engine.retire(chat);
      return record;
    },
    workspaceSessionRestore: async ({ workspaceId, sessionId }) => {
      const chat = findChat(workspaceId, sessionId);
      if (
        chat.owner.record.executionTarget.kind === "local_worktree" &&
        chat.owner.record.executionTarget.worktreeState === "removed"
      )
        throw new Error(
          "The worktree of this chat was removed, so it cannot continue. Start a new chat.",
        );
      const record = saveChat(chat, { archivedAt: null });
      engine.upsert(chat);
      return record;
    },
  } satisfies Partial<HostClient>;

  /** Answers a prompt in the session where it was sent. */
  engine.setPromptScript((session, prompt) =>
    promptRun(
      {
        workspace: session.workspace,
        checkout: session.workspace.repository.checkout(session.ref.workingDirectory),
        outcomes,
      },
      prompt,
    ),
  );

  return { handlers, launch };
};

export type { DemoTask };
