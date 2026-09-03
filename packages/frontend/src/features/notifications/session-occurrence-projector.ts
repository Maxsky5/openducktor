import type {
  AgentRole,
  AgentSessionAssociation,
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
  AgentSessionTranscriptEvent,
  NotificationNavigationTarget,
  NotificationOccurrence,
  NotificationSessionIdentity,
} from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { pendingInputIdentity } from "@/lib/pending-input-identity";

type NotificationTaskIdentity = {
  id: string;
  title?: string;
};

type CreateSessionOccurrenceProjectorOptions = {
  repositoryLabel: string;
  resolveTask(taskId: string): NotificationTaskIdentity | null;
};

type SessionProjection = {
  association: AgentSessionAssociation;
  cycle: number;
  errorNotified: boolean;
  idleNotified: boolean;
  isSubagent: boolean;
  pendingApprovals: Set<string>;
  pendingQuestions: Set<string>;
  running: boolean;
  ref: AgentSessionLiveSnapshot["ref"];
};

const toSessionIdentity = (ref: AgentSessionLiveSnapshot["ref"]): NotificationSessionIdentity => ({
  externalSessionId: ref.externalSessionId,
});

const taskIdForAssociation = (association: AgentSessionAssociation): string | undefined =>
  association.kind === "workflow" ? association.taskId : undefined;

const roleForAssociation = (association: AgentSessionAssociation): AgentRole | undefined =>
  association.kind === "workflow" ? association.role : undefined;

const createProjection = (snapshot: AgentSessionLiveSnapshot): SessionProjection => ({
  association: snapshot.sessionAssociation,
  cycle: snapshot.activity === "running" ? 1 : 0,
  errorNotified: false,
  idleNotified: false,
  isSubagent: snapshot.parentExternalSessionId !== undefined,
  pendingApprovals: new Set(snapshot.pendingApprovals.map(pendingInputIdentity)),
  pendingQuestions: new Set(snapshot.pendingQuestions.map(pendingInputIdentity)),
  running: snapshot.activity === "running",
  ref: snapshot.ref,
});

const isExpectedUserStop = (
  event: Extract<AgentSessionTranscriptEvent, { type: "session_finished" }>,
): boolean => event.message.trim().toLowerCase() === "session stopped";

export const createSessionOccurrenceProjector = ({
  repositoryLabel,
  resolveTask,
}: CreateSessionOccurrenceProjectorOptions) => {
  const sessions = new Map<string, SessionProjection>();

  const sessionOccurrence = (
    projection: SessionProjection,
    input: {
      kind:
        | "agent.permission_requested"
        | "agent.question_asked"
        | "agent.session_error"
        | "agent.session_idle";
      suffix: string;
      status: string;
      navigationTarget: NotificationNavigationTarget;
    },
  ): NotificationOccurrence => {
    const taskId = taskIdForAssociation(projection.association);
    const task = taskId ? (resolveTask(taskId) ?? { id: taskId }) : undefined;
    const occurrence: NotificationOccurrence = {
      occurrenceId: `${input.kind}:${agentSessionIdentityKey(projection.ref)}:${input.suffix}`,
      kind: input.kind,
      repoPath: projection.ref.repoPath,
      repositoryLabel,
      status: input.status,
      navigationTarget: input.navigationTarget,
    };
    if (task) occurrence.task = task;
    const role = roleForAssociation(projection.association);
    if (role) occurrence.role = role;
    return occurrence;
  };

  const sessionTarget = (
    projection: SessionProjection,
  ): Omit<Extract<NotificationNavigationTarget, { type: "agent_session" }>, "type"> => {
    const taskId = taskIdForAssociation(projection.association);
    const target: Omit<Extract<NotificationNavigationTarget, { type: "agent_session" }>, "type"> = {
      repoPath: projection.ref.repoPath,
      session: toSessionIdentity(projection.ref),
    };
    if (taskId) target.taskId = taskId;
    return target;
  };

  const startRunningCycle = (projection: SessionProjection): void => {
    if (projection.running) {
      return;
    }
    projection.cycle += 1;
    projection.running = true;
    projection.errorNotified = false;
    projection.idleNotified = false;
  };

  const finishIdleCycle = (projection: SessionProjection): NotificationOccurrence[] => {
    if (!projection.running || projection.errorNotified || projection.idleNotified) {
      return [];
    }
    projection.running = false;
    projection.idleNotified = true;
    return [
      sessionOccurrence(projection, {
        kind: "agent.session_idle",
        suffix: `cycle-${projection.cycle}`,
        status: "Agent Session is idle.",
        navigationTarget: { type: "agent_session", ...sessionTarget(projection) },
      }),
    ];
  };

  const finishErrorEpisode = (
    projection: SessionProjection,
    errorId: string,
  ): NotificationOccurrence[] => {
    if (projection.errorNotified) {
      return [];
    }
    if (projection.cycle === 0) {
      projection.cycle = 1;
    }
    projection.running = false;
    projection.errorNotified = true;
    const cycleId = `cycle-${projection.cycle}`;
    return [
      sessionOccurrence(projection, {
        kind: "agent.session_error",
        suffix: cycleId,
        status: "Agent Session reported an error.",
        navigationTarget: { type: "session_error", ...sessionTarget(projection), errorId },
      }),
    ];
  };

  const projectPendingInput = (
    projection: SessionProjection,
    input: {
      inputKind: "permission" | "question";
      requestIdentity: string;
    },
  ): NotificationOccurrence => {
    const kind =
      input.inputKind === "permission" ? "agent.permission_requested" : "agent.question_asked";
    const status =
      input.inputKind === "permission"
        ? "Permission Prompt is Waiting for Input."
        : "Structured Question is Waiting for Input.";
    return sessionOccurrence(projection, {
      kind,
      suffix: input.requestIdentity,
      status,
      navigationTarget: {
        type: "pending_input",
        ...sessionTarget(projection),
        inputKind: input.inputKind,
        requestId: input.requestIdentity,
      },
    });
  };

  const applyUpsert = (snapshot: AgentSessionLiveSnapshot): NotificationOccurrence[] => {
    const key = agentSessionIdentityKey(snapshot.ref);
    const projection = sessions.get(key);
    if (!projection) {
      sessions.set(key, createProjection(snapshot));
      return [];
    }

    projection.association = snapshot.sessionAssociation;
    projection.isSubagent = snapshot.parentExternalSessionId !== undefined;
    projection.ref = snapshot.ref;
    if (projection.isSubagent) {
      projection.pendingApprovals = new Set(snapshot.pendingApprovals.map(pendingInputIdentity));
      projection.pendingQuestions = new Set(snapshot.pendingQuestions.map(pendingInputIdentity));
      return [];
    }

    const occurrences: NotificationOccurrence[] = [];
    const nextApprovals = new Set(snapshot.pendingApprovals.map(pendingInputIdentity));
    const nextQuestions = new Set(snapshot.pendingQuestions.map(pendingInputIdentity));
    for (const identity of nextApprovals) {
      if (!projection.pendingApprovals.has(identity)) {
        occurrences.push(
          projectPendingInput(projection, { inputKind: "permission", requestIdentity: identity }),
        );
      }
    }
    for (const identity of nextQuestions) {
      if (!projection.pendingQuestions.has(identity)) {
        occurrences.push(
          projectPendingInput(projection, { inputKind: "question", requestIdentity: identity }),
        );
      }
    }
    projection.pendingApprovals = nextApprovals;
    projection.pendingQuestions = nextQuestions;

    if (snapshot.activity === "running") {
      startRunningCycle(projection);
    } else if (snapshot.activity === "idle") {
      occurrences.push(...finishIdleCycle(projection));
    }
    return occurrences;
  };

  const applyTranscriptEvent = (event: AgentSessionTranscriptEvent): NotificationOccurrence[] => {
    const projection = sessions.get(agentSessionIdentityKey(event.sessionRef));
    if (!projection || projection.isSubagent) {
      return [];
    }

    if (event.type === "session_status") {
      if (event.status.type === "busy") {
        startRunningCycle(projection);
      }
      if (event.status.type === "idle") {
        return finishIdleCycle(projection);
      }
      return [];
    }
    if (event.type === "session_idle") {
      return finishIdleCycle(projection);
    }
    if (event.type === "session_finished") {
      if (isExpectedUserStop(event)) {
        projection.running = false;
        return [];
      }
      return finishIdleCycle(projection);
    }
    if (event.type === "turn_error" || event.type === "session_error") {
      return finishErrorEpisode(projection, event.timestamp);
    }
    return [];
  };

  return {
    accept(envelope: AgentSessionLiveEnvelope): NotificationOccurrence[] {
      if (envelope.type === "snapshot") {
        sessions.clear();
        for (const snapshot of envelope.sessions) {
          sessions.set(agentSessionIdentityKey(snapshot.ref), createProjection(snapshot));
        }
        return [];
      }
      if (envelope.type === "session_upsert") {
        return applyUpsert(envelope.session);
      }
      if (envelope.type === "session_removed") {
        sessions.delete(agentSessionIdentityKey(envelope.ref));
        return [];
      }
      if (envelope.type === "transcript_event") {
        return applyTranscriptEvent(envelope.event);
      }
      return [];
    },
  };
};
