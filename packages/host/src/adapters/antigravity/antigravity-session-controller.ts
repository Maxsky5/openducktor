import { randomUUID } from "node:crypto";
import {
  type LoadSessionRequest,
  methods,
  type SessionInfo,
} from "@agentclientprotocol/sdk/unstable";
import type {
  AgentSessionLiveRef,
  AgentSessionScope,
  AgentSessionTranscriptEvent,
  AntigravityMode,
} from "@openducktor/contracts";
import type {
  AgentModelSelection,
  AgentSessionHistoryMessage,
  AgentSessionSummary,
  ManagedMcpServer,
  WorkflowRolePolicyResolver,
} from "@openducktor/core";
import {
  type SystemPromptHistoryContext,
  historyTail,
  withSystemPromptHistoryMessage,
} from "../agent-sessions/system-prompt-history-message";
import type { AntigravityAgentConnection } from "./antigravity-agent-connection";
import type { AntigravityLivePublisher } from "./antigravity-live-change";
import {
  AntigravityLiveSession,
  type AntigravityLiveSessionInput,
} from "./antigravity-live-session";
import { antigravitySystemPromptMeta } from "./antigravity-native-contract";
import {
  antigravityManagedMcpServer,
  replayAntigravitySession,
} from "./antigravity-native-sessions";
import { readAntigravityUserBlocks, toAntigravityUserMessage } from "./antigravity-prompt";
import { toAntigravitySessionApprovals } from "./antigravity-session-mode";
import type { AntigravitySessionRegistry } from "./antigravity-session-registry";
import { AntigravityTranscript } from "./antigravity-transcript";

/** Stop waits this long for the runtime to end the turn. */
const STOP_DEADLINE_MS = 10_000;

export type AntigravitySessionControllerOptions = {
  readonly connection: AntigravityAgentConnection;
  readonly sessions: AntigravitySessionRegistry;
  readonly attachmentStageDirectory: string;
  readonly resolveWorkflowRolePolicy: WorkflowRolePolicyResolver;
  readonly publish: AntigravityLivePublisher;
  readonly stopDeadlineMs?: number;
};

export type AntigravityStartInput = {
  readonly repoPath: string;
  readonly workingDirectory: string;
  readonly sessionScope: AgentSessionScope;
  readonly systemPrompt: string;
  readonly model?: AgentModelSelection | undefined;
  readonly managedMcpServer: ManagedMcpServer;
  /** The session mode that the runtime setting gives the session scope. */
  readonly mode: AntigravityMode;
};

export type AntigravityReattachInput = AgentSessionLiveRef & {
  readonly sessionScope: AgentSessionScope;
  readonly systemPrompt?: string | undefined;
  readonly model?: AgentModelSelection | undefined;
  /** The listed entry. Antigravity does not list a session that got no message. */
  readonly nativeSession: SessionInfo | null;
  readonly managedMcpServer: ManagedMcpServer;
  /** The session mode that the runtime setting gives the session scope. */
  readonly mode: AntigravityMode;
};

/**
 * Opens, reopens, and closes the live sessions of one shared `agy acp` process. Each session owns
 * its state, and the registry routes the native updates and requests to it.
 */
export class AntigravitySessionController {
  private readonly connection: AntigravityAgentConnection;
  private readonly sessions: AntigravitySessionRegistry;

  constructor(private readonly options: AntigravitySessionControllerOptions) {
    this.connection = options.connection;
    this.sessions = options.sessions;
  }

  /** A transcript that reads replayed user messages in the directory of its session. */
  private newTranscript(sessionId: string, workingDirectory: string): AntigravityTranscript {
    return new AntigravityTranscript(
      sessionId,
      (blocks) =>
        toAntigravityUserMessage(
          readAntigravityUserBlocks(
            blocks,
            workingDirectory,
            this.options.attachmentStageDirectory,
          ),
        ),
      () => this.connection.now(),
    );
  }

  private isReadOnly(sessionScope: AgentSessionScope, externalSessionId: string): boolean {
    return (
      sessionScope.kind === "workflow" &&
      this.options.resolveWorkflowRolePolicy({ ...sessionScope, externalSessionId }).readOnly
    );
  }

  private createSession({
    mode,
    ...input
  }: Omit<AntigravityLiveSessionInput, "readOnly" | "transcript" | "approvals"> & {
    mode: AntigravityMode;
  }): AntigravityLiveSession {
    const readOnly = this.isReadOnly(input.sessionScope, input.ref.externalSessionId);
    const session = new AntigravityLiveSession(
      {
        ...input,
        approvals: toAntigravitySessionApprovals(mode, readOnly),
        readOnly,
        transcript: this.newTranscript(input.ref.externalSessionId, input.ref.workingDirectory),
      },
      this.connection,
      this.options.publish,
    );
    this.sessions.add(session);
    return session;
  }

  private mcpServers(
    input: Pick<AntigravityStartInput, "managedMcpServer" | "sessionScope">,
    callerBindingId: string,
    externalSessionId: string | null,
  ) {
    return [
      antigravityManagedMcpServer(
        input.managedMcpServer,
        input.sessionScope,
        this.options.resolveWorkflowRolePolicy,
        callerBindingId,
        externalSessionId,
      ),
    ];
  }

  /**
   * Finishes the setup of a native session, or closes it again after a failure. The setup error
   * is the cause that the user needs, so a failed close does not replace it.
   */
  private async finishSetup(
    session: AntigravityLiveSession,
    setup: () => Promise<void>,
  ): Promise<AgentSessionSummary> {
    try {
      await setup();
    } catch (cause) {
      this.sessions.drop(session);
      // An update during the setup can have published the session, so it leaves the live state.
      await this.options
        .publish({ snapshots: [], removedRefs: [session.ref], events: [] })
        .catch(() => undefined);
      if (!this.connection.isReleased && !this.connection.transportClosed()) {
        await this.connection
          .agent()
          .request(methods.agent.session.close, { sessionId: session.ref.externalSessionId })
          .catch(() => undefined);
      }
      throw cause;
    }
    return session.summary();
  }

  async startSession(input: AntigravityStartInput): Promise<AgentSessionSummary> {
    const agent = this.connection.agent();
    const callerBindingId = randomUUID();
    const { result: response, earlyUpdates } = await this.sessions.openNativeSession(
      () =>
        this.connection.request(() =>
          agent.request(methods.agent.session.new, {
            cwd: input.workingDirectory,
            mcpServers: this.mcpServers(input, callerBindingId, null),
            _meta: antigravitySystemPromptMeta(input.systemPrompt),
          }),
        ),
      (result) => result.sessionId,
    );
    const ref: AgentSessionLiveRef = {
      repoPath: input.repoPath,
      runtimeKind: "antigravity",
      workingDirectory: input.workingDirectory,
      externalSessionId: response.sessionId,
    };
    const session = this.createSession({
      ref,
      sessionScope: input.sessionScope,
      systemPrompt: input.systemPrompt,
      title:
        input.sessionScope.kind === "repository" && input.sessionScope.title
          ? input.sessionScope.title
          : response.sessionId,
      startedAt: this.connection.now(),
      callerBindingId,
      mode: input.mode,
    });
    session.open(response.configOptions);
    for (const notification of earlyUpdates) session.applyUpdate(notification.update);
    return this.finishSetup(session, async () => {
      await session.applyMode(response.configOptions);
      await session.completeSetup(input.model, {
        admittedRoot: { ...ref, sessionScope: input.sessionScope },
      });
    });
  }

  /** Opens a saved session in its saved directory, with its role instructions and tools. */
  reattachSession(input: AntigravityReattachInput): Promise<AgentSessionSummary> {
    return this.sessions.withGate(input.externalSessionId, async () => {
      this.sessions.assertNotHeldElsewhere(input);
      const existing = this.sessions.get(input.externalSessionId);
      if (existing && !existing.loading) return existing.summary();
      const entry = input.nativeSession;
      const callerBindingId = randomUUID();
      const loadRequest: LoadSessionRequest = {
        sessionId: input.externalSessionId,
        cwd: input.workingDirectory,
        mcpServers: this.mcpServers(input, callerBindingId, input.externalSessionId),
      };
      const systemPrompt = input.systemPrompt ?? "";
      if (systemPrompt.trim()) loadRequest._meta = antigravitySystemPromptMeta(systemPrompt);
      const session = this.createSession({
        ref: {
          repoPath: input.repoPath,
          runtimeKind: "antigravity",
          workingDirectory: input.workingDirectory,
          externalSessionId: input.externalSessionId,
        },
        sessionScope: input.sessionScope,
        systemPrompt,
        title:
          (input.sessionScope.kind === "repository" ? input.sessionScope.title : undefined) ??
          entry?.title ??
          input.externalSessionId,
        startedAt: entry?.updatedAt ?? this.connection.now(),
        callerBindingId,
        mode: input.mode,
      });
      return this.finishSetup(session, async () => {
        const agent = this.connection.agent();
        // The loading session is registered, so its replay goes to it and nothing waits.
        const { result: loaded } = await this.sessions.openNativeSession(
          () =>
            this.connection.request(() => agent.request(methods.agent.session.load, loadRequest)),
          () => input.externalSessionId,
        );
        session.open(loaded.configOptions);
        session.finishReplay();
        await session.applyMode(loaded.configOptions);
        // The session stays in setup until its saved model applies, so no update publishes it.
        await session.completeSetup(input.model, { provenance: "baseline" });
      });
    });
  }

  /**
   * Reads the history of a session that this runtime does not hold: it loads the session with no
   * MCP servers and closes it again. The caller checked the saved directory of the session.
   */
  replayHistory(
    input: AgentSessionLiveRef & {
      systemPromptContext?: SystemPromptHistoryContext | undefined;
      limit?: number | undefined;
    },
  ): Promise<AgentSessionHistoryMessage[]> {
    return this.sessions.withGate(input.externalSessionId, async () => {
      const held = this.sessions.find(input);
      if (held) return held.history(input.limit);
      // A load and close here would end the live session that another ref holds.
      this.sessions.assertNotHeldElsewhere(input);
      const transcript = this.newTranscript(input.externalSessionId, input.workingDirectory);
      await replayAntigravitySession(this.connection, this.sessions, input, transcript);
      return withSystemPromptHistoryMessage(
        `antigravity-system-prompt:${input.externalSessionId}`,
        input.systemPromptContext,
        historyTail(transcript.history, input.limit),
      );
    });
  }

  /** Stops the turn of the exact session. Other sessions continue. */
  async stopSession(ref: Pick<AgentSessionLiveRef, "externalSessionId">): Promise<void> {
    await this.sessions
      .get(ref.externalSessionId)
      ?.stop(this.options.stopDeadlineMs ?? STOP_DEADLINE_MS);
  }

  /** Closes the native session and removes it from the live state. */
  releaseSession(ref: AgentSessionLiveRef): Promise<void> {
    return this.sessions.withGate(ref.externalSessionId, async () => {
      this.sessions.assertNotHeldElsewhere(ref);
      const session = this.sessions.get(ref.externalSessionId);
      if (!session) return;
      this.sessions.drop(session);
      session.close("Antigravity released the session.");
      await this.options.publish({ snapshots: [], removedRefs: [session.ref], events: [] });
      const agent = this.connection.agent();
      await this.connection.request(() =>
        agent.request(methods.agent.session.close, { sessionId: ref.externalSessionId }),
      );
    });
  }

  /**
   * Settles every live turn after the runtime stopped or exited. It returns the terminal events,
   * and the caller publishes them before it removes the sessions.
   */
  settleRuntime(reason: string): AgentSessionTranscriptEvent[] {
    return this.sessions.values().flatMap((session) => session.settle(reason));
  }

  /** Clears all sessions of this runtime. */
  releaseRuntime(reason: string): void {
    this.connection.release();
    for (const session of this.sessions.values()) {
      this.sessions.drop(session);
      session.close(reason);
    }
  }
}
