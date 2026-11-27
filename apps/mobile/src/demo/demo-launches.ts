import {
  type AgentSessionModelSelection,
  type AgentWorkflowSessionForkResult,
  goalCommandParts,
  type RuntimeKind,
  type StartupOperationContext,
  type StartupOperationSnapshot,
  type StartupStep,
  type WorkflowLaunchResult,
  type WorkspaceSession,
  type WorkspaceSessionForkResult,
  type WorkspaceSessionLaunchResult,
  type WorkspaceSessionStartResult,
} from "@openducktor/contracts";
import { toAgentUserMessageParts } from "@openducktor/frontend-core/sessions/start/session-start-workflow";
import type { HostClient } from "@openducktor/host-client";
import { specPlanBuildWorkflow } from "@openducktor/workflows";
import type { DemoCheckout } from "./demo-repository";
import { DEMO_MODELS, isDemoRuntimeKind } from "./demo-models";
import { type DemoRoleOutcomes, kickoffText, promptRun, roleRun } from "./demo-runs";
import type { DemoSession, DemoSessionEngine } from "./demo-sessions";
import { runtimeIdOf } from "./demo-sessions";
import type { DemoTaskStore } from "./demo-tasks";
import type { DemoTerminals } from "./demo-terminals";
import {
  DEMO_HOST_INSTANCE_ID,
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

type TaskStore = DemoRoleOutcomes & Pick<DemoTaskStore, "ensureWorktree" | "setTargetBranch">;

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
    if (world.startingTasks.has(task))
      throw new Error("A session is starting in this task worktree. Wait until it starts.");
    const pullRequest = request.policy.actionId === "pull_request";
    const role = workflow.launchAction(request.policy.actionId, request.policy.role).role;
    if (request.beforeStartAction)
      tasks.applyEvent(workspace, task.record.id, request.beforeStartAction.eventId);
    // The start form chooses the target branch, which also becomes the base of a new worktree.
    if (request.targetBranch)
      tasks.setTargetBranch(workspace, task.record.id, request.targetBranch);
    const startEvent = pullRequest ? undefined : workflow.roleStartEvent(role);
    if (startEvent && workflow.isEventAvailable(startEvent, task.record))
      tasks.applyEvent(workspace, task.record.id, startEvent);

    const scope = { kind: "task" as const, taskId: task.record.id, role };
    // Every agent session of a task works in the task worktree, as on a host.
    let steps: StartupStep[] = [];
    const worktree = tasks.ensureWorktree(workspace, task.record.id);
    const checkout = worktree.checkout;
    const workingDirectory = checkout.workingDirectory;
    if (worktree.created) {
      world.startingTasks.add(task);
      try {
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
      } finally {
        world.startingTasks.delete(task);
      }
    }
    // A reset, close, or delete during the setup removes the worktree, so the start ends here.
    if (workspace.tasks.get(task.record.id)?.worktree?.workingDirectory !== workingDirectory)
      throw new Error("The task changed during the worktree setup. Start the session again.");

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
    // Goal mode: the runtime sets the goal with the first instruction.
    if (request.goal) session.goal = { objective: request.goal.objective, status: "active" };
    engine.publishTaskRecords(workspace, task.record.id, session);
    const liveStateSequence = engine.upsert(session);

    // Goal mode sets the goal instead of a first message, as the runtime `/goal` command does.
    const instruction = request.instruction;
    const parts = request.goal
      ? goalCommandParts(request.goal.objective)
      : instruction.kind === "message"
        ? instruction.parts
        : instruction.kind === "kickoff"
          ? [{ kind: "text" as const, text: kickoffText(role, pullRequest, instruction) }]
          : null;
    let acceptedMessage: ReturnType<DemoSessionEngine["acceptUserMessage"]> | undefined;
    if (parts) {
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
    manualTitle?: string | null;
    generatedTitle?: string | null;
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
      generatedTitle: input.generatedTitle ?? null,
      manualTitle: input.manualTitle !== undefined ? input.manualTitle : input.title,
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
    if (!isDemoRuntimeKind(runtimeKind)) throw new Error(`The demo has no ${runtimeKind} runtime.`);
    // A new session starts at the default effort of its model, so it takes no variant.
    const { variant: _variant, ...model } = DEMO_MODELS[runtimeKind];
    return model;
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

  const handlers = {
    agentSessionWorkflowLaunch: launch,
    agentSessionControlResume: async (input) => {
      const session = engine.find(input);
      if (input.resumeMode === "continue_interrupted_turn") engine.continueRun(session);
      return engine.summaryOf(session);
    },
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
    workspaceSessionLaunch: async (input) => {
      const workspace = findWorkspace(world, input.workspaceId);
      const firstText = input.parts
        .filter((part) => part.kind === "text")
        .map((part) => part.text)
        .join(" ")
        .trim();
      const slug =
        firstText
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 32) || `session-${chatNumber}`;
      const title = firstText.slice(0, 48) || "New session";
      const scope = { kind: "workspace" as const, draftId: input.draftId };
      const steps: StartupStep[] = [];
      let executionTarget: WorkspaceSession["executionTarget"];

      if (input.location === "local_repo_root") {
        executionTarget = { kind: "local_repo_root", workingDirectory: workspace.record.repoPath };
        steps.push({
          id: "checkout",
          label: "Use current checkout",
          state: "completed",
          details: [workspace.record.repoPath],
        });
      } else if (input.location === "existing_worktree") {
        const checkout = workspace.repository.findCheckout(input.existingWorktree.workingDirectory);
        if (!checkout) {
          throw new Error("This worktree is not in the demo repository. Choose another worktree.");
        }
        executionTarget = {
          kind: "local_worktree",
          workingDirectory: checkout.workingDirectory,
          branchName: checkout.branch,
          worktreeState: "present",
        };
        steps.push({
          id: "checkout",
          label: "Use existing worktree",
          state: "completed",
          details: [checkout.workingDirectory],
        });
      } else {
        const autoNamed =
          input.worktree.mode === "from_name" &&
          !input.worktree.name.trim() &&
          !input.worktree.branchName?.trim();
        const dirName = input.worktree.name.trim() || slug;
        const branchPrefix = workspace.repoConfig.branchPrefix || "odt";
        const branch =
          input.worktree.mode === "from_branch"
            ? input.worktree.branchName
            : input.worktree.branchName?.trim() || `${branchPrefix}/${dirName}`;
        const workingDirectory = `${workspace.worktreeRoot}/${dirName}`;
        if (autoNamed) {
          steps.push({
            id: "naming",
            label: "Choose directory and branch name",
            state: "completed",
            details: [`Directory: ${dirName}`, `Branch: ${branch}`],
          });
        }
        const checkout = workspace.repository.addWorktree({
          workingDirectory,
          branch,
          base: input.targetBranch.branch,
        });
        executionTarget = {
          kind: "local_worktree",
          workingDirectory,
          branchName: branch,
          worktreeState: "present",
        };
        const worktreeSteps = await setUpWorktree({
          workspace,
          checkout,
          context: input.startup,
          scope,
          terminalContext: {},
        });
        for (const step of worktreeSteps) {
          steps.push(step.id === "worktree" ? { ...step, id: "checkout" } : step);
        }
      }

      const role = input.customAgentRoleId
        ? (world.customRoles.find((candidate) => candidate.id === input.customAgentRoleId) ?? null)
        : null;
      const chat = openChat({
        workspace,
        runtimeKind: input.runtimeKind,
        model: input.selectedModel,
        executionTarget,
        title,
        manualTitle: null,
        generatedTitle: title,
        roleSnapshot: role,
        targetBranch: input.targetBranch,
      });
      const liveStateSequence = engine.upsert(chat);
      const acceptedMessage = engine.acceptUserMessage(chat, toAgentUserMessageParts(input.parts));
      engine.startRun(
        chat,
        promptRun(
          {
            workspace,
            checkout: workspace.repository.checkout(chat.ref.workingDirectory),
            outcomes,
          },
          firstText,
        ),
      );
      steps.push(
        {
          id: "prepare",
          label: "Start agent session",
          state: "completed",
          details: [chat.ref.workingDirectory],
        },
        {
          id: "instruction",
          label: "Send first message",
          state: "completed",
          details: [],
        },
      );
      const startupProgress = progress(input.startup, {
        workspaceId: workspace.record.workspaceId,
        repoPath: workspace.record.repoPath,
        scope: { kind: "workspace", sessionId: chat.owner.record.id, draftId: input.draftId },
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
        prepared: {
          ref: chat.ref,
          runtimeId: runtimeIdOf(chat.ref.runtimeKind),
          liveStateSequence,
        },
        instruction: { state: "accepted", messageId: acceptedMessage.messageId },
      });
      const result: WorkspaceSessionLaunchResult = {
        workspaceId: workspace.record.workspaceId,
        repoPath: workspace.record.repoPath,
        status: "completed",
        sessionId: chat.owner.record.id,
        record: chat.owner.record,
        session: engine.summaryOf(chat),
        acceptedMessage,
      };
      if (startupProgress) result.startupProgress = startupProgress;
      return result;
    },
    workspaceSessionStart: async ({ workspaceId, sessionId, startup }) => {
      const chat = findChat(workspaceId, sessionId);
      const startupProgress = preparedChat(chat, startup, []);
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
      const target = chat.owner.record.executionTarget;
      let executionTarget = target;
      if (removeWorktree && target.kind === "local_worktree") {
        const owners = worktreeOwners(chat);
        if (owners.sharedWith.length > 0 || owners.taskOwners.length > 0)
          throw new Error(
            "Other chats or tasks still use this worktree. Archive them first, or keep the worktree.",
          );
      }
      // A refused archive keeps the run; an accepted one stops it before any removal.
      engine.stopRun(chat);
      if (removeWorktree && target.kind === "local_worktree") {
        chat.workspace.repository.removeWorktree(target.workingDirectory);
        executionTarget = { ...target, worktreeState: "removed" };
      }
      const record = saveChat(chat, { archivedAt: clock.now(), executionTarget });
      engine.retire(chat);
      return record;
    },
    workspaceSessionRestore: async ({ workspaceId, sessionId }) => {
      const chat = findChat(workspaceId, sessionId);
      const target = chat.owner.record.executionTarget;
      // Another chat can remove a shared worktree, so the checkout itself decides.
      if (
        target.kind === "local_worktree" &&
        (target.worktreeState === "removed" ||
          !chat.workspace.repository.findCheckout(target.workingDirectory))
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
