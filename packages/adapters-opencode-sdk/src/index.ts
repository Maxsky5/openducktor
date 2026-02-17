import type { RunEvent } from "@openblueprint/contracts";
import type {
  AgentEnginePort,
  EventUnsubscribe,
  SendMessageInput,
  StartSessionInput,
} from "@openblueprint/core";

type Listener = (event: RunEvent) => void;

type SessionRecord = {
  sessionId: string;
  mode: "planner" | "builder";
  repoPath: string;
  taskId: string;
  baseUrl?: string;
};

const now = (): string => new Date().toISOString();

export class OpencodeSdkAdapter implements AgentEnginePort {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly listeners = new Map<string, Set<Listener>>();

  async startPlanSession(input: Omit<StartSessionInput, "mode">): Promise<void> {
    this.registerSession({ ...input, mode: "planner" });
    this.emit(input.sessionId, {
      type: "run_started",
      runId: input.sessionId,
      message: "Planner session started",
      timestamp: now(),
    });
  }

  async startBuildSession(input: Omit<StartSessionInput, "mode">): Promise<void> {
    this.registerSession({ ...input, mode: "builder" });
    this.emit(input.sessionId, {
      type: "run_started",
      runId: input.sessionId,
      message: "Builder session started",
      timestamp: now(),
    });
  }

  async sendUserMessage(input: SendMessageInput): Promise<void> {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }

    this.emit(input.sessionId, {
      type: "agent_thought",
      runId: input.sessionId,
      message:
        session.mode === "planner"
          ? `Planner acknowledged: ${input.content}`
          : `Builder acknowledged: ${input.content}`,
      timestamp: now(),
    });
  }

  subscribeEvents(sessionId: string, listener: Listener): EventUnsubscribe {
    const set = this.listeners.get(sessionId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(sessionId, set);

    return () => {
      const active = this.listeners.get(sessionId);
      active?.delete(listener);
      if (active && active.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  async stopSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.emit(sessionId, {
      type: "run_finished",
      runId: sessionId,
      message: "Session stopped",
      timestamp: now(),
      success: true,
    });
    this.listeners.delete(sessionId);
  }

  private registerSession(input: StartSessionInput): void {
    const session: SessionRecord = {
      sessionId: input.sessionId,
      mode: input.mode,
      repoPath: input.repoPath,
      taskId: input.taskId,
    };

    if (input.baseUrl) {
      session.baseUrl = input.baseUrl;
    }

    this.sessions.set(input.sessionId, session);
  }

  private emit(sessionId: string, event: RunEvent): void {
    for (const listener of this.listeners.get(sessionId) ?? []) {
      listener(event);
    }
  }
}
