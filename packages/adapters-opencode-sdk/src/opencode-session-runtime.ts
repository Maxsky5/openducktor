import type {
  AgentSessionBackgroundTaskStopInput,
  AgentToolDenialSource,
} from "@openducktor/contracts";
import {
  AgentSessionMessageAcceptanceUnknownError,
  AgentSessionMessageRefusedError,
  AgentSessionTurnActiveError,
  agentSessionRefsEqual,
  goalCommandStartsWork,
  resolveRuntimeGoalAvailability,
} from "@openducktor/core";
import type { SessionInfo, V2Event, OpenCodeClient } from "@opencode/client";
import {
  isManualSessionCompactionSlashCommand,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type AgentSessionAuthorizedRoot,
} from "@openducktor/contracts";
import type {
  AgentEvent,
  ManagedMcpServerResolver,
  AgentCatalogPort,
  AgentSessionHistoryPort,
  AgentSessionQueryParentPort,
  AgentWorkspaceInspectionPort,
  RuntimeSessionImportPort,
  SessionRef,
} from "@openducktor/core";
import {
  OpenCodeOperationError,
  nativeRequest,
  operationError,
  readMigration,
  type OpenCodeRequestDraft,
} from "./opencode-client";
import { createOpenCodeGenerationModels } from "./opencode-generation-model";
import { createOpenCodeCatalogReadiness } from "./opencode-catalog-readiness";
import { readCatalog } from "./opencode-catalog";
import { createOpenCodeMcpBridge } from "./opencode-mcp-bridge";
import {
  OpencodeSdkAdapter,
  type OpenCodeGoalControlInput,
  type OpenCodeSessionBinding,
} from "./opencode-sdk-adapter";
import {
  OPENCODE_GOAL_CHANGED_EVENT,
  readOpenCodeGoal,
  readOpenCodeGoalChange,
} from "./opencode-goals";
import { installOpenCodePolicy } from "./opencode-permissions";
import { createOpenCodeBackgroundSession } from "./opencode-background-session";
import {
  permissionDecision,
  projectApproval,
  projectQuestion,
  replyForm,
} from "./opencode-pending";
import {
  iso,
  modelSelection,
  readMessages,
  projectVisibleInboxUser,
  projectContextUsage,
} from "./opencode-message-projection";
import { OpenCodeLiveMessageProjector } from "./opencode-live-message-projector";
import { readOpenCodeTranscript } from "./opencode-session-transcript";
import type {
  OpencodeRuntimeSnapshotRead,
  OpencodeRuntimeSnapshotSource,
  OpencodeRuntimeSnapshotFailure,
} from "./live-session-snapshots";
import type {
  OpencodeSessionRuntimeSignal,
  OpencodeSessionContextUsage,
} from "./opencode-session-runtime-signals";
import type {
  OpenCodeRuntimeConnection,
  OpencodeSdkAdapterOptions,
  ReadOpencodeDirectory,
} from "./types";

export type PrepareOpencodeSessionRuntimeInput = {
  readonly runtimeId: string;
  readonly runtimeEndpoint: string;
  readonly connection: OpenCodeRuntimeConnection;
  readonly signal?: AbortSignal;
};
export type OpencodeNativeApprovalReply = {
  onIssued?: (() => void) | undefined;
  /** The host rejects the prompt for the read-only role, not for the user. */
  denialSource?: Extract<AgentToolDenialSource, "read_only_role"> | undefined;
  ref: SessionRef;
  nativeRequestId: string;
  outcome: import("@openducktor/contracts").RuntimeApprovalReplyOutcome;
  message?: string;
};
export type OpencodeNativeQuestionReply = {
  ref: SessionRef;
  nativeRequestId: string;
  answers: string[][];
};
export type OpencodeSessionRuntimeConnection = Pick<
  OpencodeSdkAdapter,
  | "startSession"
  | "resumeSession"
  | "continueInterruptedTurn"
  | "forkSession"
  | "sendUserMessage"
  | "updateSessionModel"
  | "updateSessionTitle"
  | "generateText"
  | "generateJson"
> & {
  /** Interrupts the conversation and stops the background work of its session tree. */
  stopSession: (ref: SessionRef) => Promise<void>;
  releaseSession: (ref: SessionRef) => Promise<void>;
  /** Runs one native goal action. */
  controlGoal: (
    input: OpenCodeGoalControlInput,
    options?: { onSent?: (() => void) | undefined },
  ) => Promise<void>;
  readSessionSources: (
    repoPath: string,
    roots?: AgentSessionAuthorizedRoot[],
  ) => Promise<OpencodeRuntimeSnapshotRead>;
  loadContextUsage: (ref: SessionRef) => Promise<OpencodeSessionContextUsage | null>;
  replyApproval: (input: OpencodeNativeApprovalReply) => Promise<void>;
  replyQuestion: (input: OpencodeNativeQuestionReply) => Promise<void>;
  /**
   * Stops one background task of the session tree of the ref. A task that does not run there
   * gives success with no native call.
   */
  stopBackgroundTask: (input: AgentSessionBackgroundTaskStopInput) => Promise<void>;
};
export type PreparedOpencodeSessionRuntime = {
  readonly sessionImport: RuntimeSessionImportPort;
  readonly queries: AgentCatalogPort &
    AgentSessionHistoryPort &
    AgentWorkspaceInspectionPort &
    AgentSessionQueryParentPort;
  readonly connection: OpencodeSessionRuntimeConnection;
  readonly startForwarding: (
    listener: (signal: OpencodeSessionRuntimeSignal) => void | Promise<void>,
  ) => Promise<void>;
  readonly release: () => Promise<void>;
};
export type PrepareOpencodeSessionRuntime = (
  input: PrepareOpencodeSessionRuntimeInput,
) => Promise<PreparedOpencodeSessionRuntime>;

/** The conversation that a native event belongs to. */
const eventSessionId = (event: V2Event): string | undefined =>
  event.type === "form.created"
    ? event.data.form.sessionID
    : "sessionID" in event.data
      ? event.data.sessionID
      : undefined;

export const createPrepareOpencodeSessionRuntime =
  (
    options: OpencodeSdkAdapterOptions & {
      readDirectory: ReadOpencodeDirectory;
      resolveMcpServerConfig: ManagedMcpServerResolver;
      /** OpenCode runs `generate.*` in the location of its global config directory. */
      globalConfigDirectory: string;
    },
  ): PrepareOpencodeSessionRuntime =>
  async (input) => {
    if (
      input.connection.runtimeId !== input.runtimeId ||
      input.connection.endpoint !== input.runtimeEndpoint
    )
      throw operationError(
        { repoPath: "OpenCode runtime" },
        "connect to the runtime",
        "identity_mismatch",
        "The private connection does not match the selected runtime route.",
      );
    const runtimeIdentity = { repoPath: "OpenCode runtime" };
    const abort = new AbortController();
    const abortFromHost = () => abort.abort();
    input.signal?.addEventListener("abort", abortFromHost, { once: true });
    if (input.signal?.aborted) abort.abort();
    let released = false;
    let listener: ((signal: OpencodeSessionRuntimeSignal) => void | Promise<void>) | undefined;
    let delivery = Promise.resolve();
    let processing = Promise.resolve();
    const pending: OpencodeSessionRuntimeSignal[] = [];
    const projectors = new Map<string, OpenCodeLiveMessageProjector>();
    const nativeRunning = new Set<string>();
    type AwaitingTurn = {
      ref: SessionRef;
      submitted: boolean;
      customCommand: boolean;
      inboxId?: string;
      consumedInboxIds: Set<string>;
    };
    const awaitingTurns = new Map<string, Set<AwaitingTurn>>();
    let failure: Error | undefined;
    const emit = (signal: OpencodeSessionRuntimeSignal) => {
      if (released) return;
      if (!listener) {
        pending.push(signal);
        return;
      }
      const target = listener;
      delivery = delivery
        .then(() => (released || (failure && signal.type !== "fault") ? undefined : target(signal)))
        .then(() => undefined)
        .catch((cause) => {
          fail(cause);
          abort.abort();
        });
    };
    const settleTurn = (turn: AwaitingTurn): boolean => {
      const turns = awaitingTurns.get(turn.ref.externalSessionId);
      if (!turns?.delete(turn)) return false;
      if (turns.size === 0) awaitingTurns.delete(turn.ref.externalSessionId);
      return true;
    };
    const reportActivity = (ref: SessionRef): void => {
      const working =
        nativeRunning.has(ref.externalSessionId) || awaitingTurns.has(ref.externalSessionId);
      const event: Extract<AgentEvent, { type: "session_status" }> = {
        type: "session_status",
        externalSessionId: ref.externalSessionId,
        timestamp: iso(Date.now()),
        status: working ? { type: "busy", message: null } : { type: "idle" },
      };
      // Background work keeps the session running after its reply ends.
      if (background.hasWork(ref.externalSessionId)) {
        event.status = { type: "busy", message: null };
        event.foregroundTurnActive = working;
      }
      emit({ type: "session_event", externalSessionId: ref.externalSessionId, event });
    };
    const fail = (cause: unknown) => {
      if (released || failure) return;
      failure = cause instanceof Error ? cause : new Error(String(cause));
      background.close(failure);
      controller.close();
      const fault = {
        type: "fault" as const,
        message: `OpenCode live event observation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
      emit(
        cause instanceof OpenCodeOperationError
          ? { ...fault, runtimeOperationFailure: cause.failure.runtimeOperationFailure }
          : fault,
      );
    };
    const failSession = (externalSessionId: string, cause: unknown) => {
      const fault = {
        type: "session_fault" as const,
        externalSessionId,
        message: cause instanceof Error ? cause.message : String(cause),
      };
      emit(
        cause instanceof OpenCodeOperationError
          ? { ...fault, runtimeOperationFailure: cause.failure.runtimeOperationFailure }
          : fault,
      );
    };
    /** The conversations whose live events stopped applying, until a read seeds them again. */
    const faulted = new Set<string>();
    let controller: OpencodeSdkAdapter;
    const isClosed = () => released || abort.signal.aborted;
    const mcpBridge = createOpenCodeMcpBridge({
      client: () => controller.client,
      resolveMcpServerConfig: options.resolveMcpServerConfig,
      runtimeIdentity,
      isClosed,
    });
    const generationModels = createOpenCodeGenerationModels({
      client: () => controller.client,
      globalConfigDirectory: options.globalConfigDirectory,
      isClosed,
    });
    abort.signal.addEventListener("abort", () => {
      mcpBridge.close();
      generationModels.close();
    });
    controller = new OpencodeSdkAdapter(input.connection, options, {
      readDirectory: options.readDirectory,
      ensureMcp: mcpBridge.ensure,
      restoreMcp: mcpBridge.restore,
      awaitGenerationModel: generationModels.awaitModel,
      projectHistory: (sessionID, messages, inbox) =>
        (projectors.get(sessionID) ?? new OpenCodeLiveMessageProjector()).projectHistory(
          messages,
          inbox,
        ),
      admitted: (binding) => {
        // The events of a faulted conversation apply again only after a read of it.
        if (!faulted.has(binding.detail.id) && !projectors.has(binding.detail.id))
          projectors.set(binding.detail.id, new OpenCodeLiveMessageProjector());
      },
    });
    const background = createOpenCodeBackgroundSession({
      client: controller.client,
      parentOf: (sessionID) => controller.bindings.get(sessionID)?.detail.parentID,
      emit,
      isReplying: (sessionID) => nativeRunning.has(sessionID) || awaitingTurns.has(sessionID),
    });
    /**
     * An event that the adapter cannot apply to one conversation stops the observation of that
     * conversation only. The other conversations of the runtime keep their live updates, and a
     * read of the conversation, such as a reload, observes it again.
     */
    const faultSession = (sessionID: string, cause: unknown) => {
      const lost = cause instanceof Error ? cause : new Error(String(cause));
      faulted.add(sessionID);
      projectors.delete(sessionID);
      nativeRunning.delete(sessionID);
      background.lose(sessionID, lost);
      const fault = {
        type: "session_fault" as const,
        externalSessionId: sessionID,
        message: lost.message,
        statusUnavailable: true as const,
        backgroundTrackingLost: true as const,
      };
      emit(
        cause instanceof OpenCodeOperationError
          ? { ...fault, runtimeOperationFailure: cause.failure.runtimeOperationFailure }
          : fault,
      );
    };
    abort.signal.addEventListener("abort", () => controller.close(), { once: true });
    if (abort.signal.aborted) controller.close();
    const client = controller.client;
    const catalogReadiness = createOpenCodeCatalogReadiness(client, abort.signal);
    const info = await nativeRequest(runtimeIdentity, "verify the V2 server", () =>
      client.server.info(),
    );
    if (!info.version.startsWith("2."))
      throw operationError(
        runtimeIdentity,
        "connect to the V2 server",
        "runtime_unavailable",
        "The selected executable does not provide OpenCode V2.",
        "Install OpenCode V2 or select its executable in runtime settings.",
      );
    // Goals come from a built-in plugin of newer servers. An older server gets no goal call.
    const goals = resolveRuntimeGoalAvailability(OPENCODE_RUNTIME_DESCRIPTOR, info.version);

    const source = (
      binding: OpenCodeSessionBinding,
      parentExternalSessionId?: string,
    ): Promise<OpencodeRuntimeSnapshotSource> => {
      const sessionID = binding.detail.id;
      // A read observes a faulted conversation again from a new projector, as its first read does.
      // The events during the read apply to that projector, and a failed read faults it again.
      const refault = faulted.delete(sessionID);
      if (refault) projectors.set(sessionID, new OpenCodeLiveMessageProjector());
      const read = readSource(binding, parentExternalSessionId);
      return refault
        ? read.catch((cause: unknown) => {
            faulted.add(sessionID);
            projectors.delete(sessionID);
            throw cause;
          })
        : read;
    };
    const readSource = (
      binding: OpenCodeSessionBinding,
      parentExternalSessionId?: string,
    ): Promise<OpencodeRuntimeSnapshotSource> =>
      nativeRequest(binding.ref, "read the conversation", async () => {
        const [active, approvals, forms, location, inbox, messages, goal] = await Promise.all([
          client.session.active(),
          client.permission.list({ sessionID: binding.detail.id }),
          client.session.form.list({ sessionID: binding.detail.id }),
          client.location.get({ location: { directory: binding.ref.workingDirectory } }),
          client.session.inbox.list({ sessionID: binding.detail.id }),
          readOpenCodeTranscript(client, binding.detail),
          // A child session starts with no goal, and the plugin reports later changes live.
          goals.available && parentExternalSessionId === undefined
            ? readOpenCodeGoal(client, binding.detail.id, binding.ref.workingDirectory)
            : undefined,
        ]);
        if (location.directory !== binding.ref.workingDirectory)
          throw operationError(
            binding.ref,
            "read the conversation",
            "identity_mismatch",
            "The native location does not match the linked directory.",
          );
        const projector = projectors.get(binding.detail.id)!;
        // Delivery events contain only IDs, so retained payloads must survive snapshot reads.
        const retractedIds = new Set(projector.seed(messages));
        // A prompt raised before this read has no live ask event.
        for (const request of approvals)
          if (request.source?.type === "tool")
            projector.recordApprovalAsk(request.id, request.source.id);
        for (const item of inbox) {
          if (item.sessionID !== binding.detail.id)
            throw operationError(
              binding.ref,
              "read queued messages",
              "identity_mismatch",
              "The native inbox contains an item from another conversation.",
            );
          projector.inbox.set(item.id, item);
        }
        projector.updateProjectionContext();
        const queuedIds = new Set(inbox.map((item) => item.id));
        for (const item of projector.inbox.values())
          if (item.type === "user" && !queuedIds.has(item.id) && !projector.messages.has(item.id))
            retractedIds.add(item.id);
        for (const turn of awaitingTurns.get(binding.detail.id) ?? []) {
          if (turn.inboxId !== undefined && !queuedIds.has(turn.inboxId)) settleTurn(turn);
          else if (turn.submitted && !turn.customCommand && turn.inboxId === undefined)
            for (const id of retractedIds) turn.consumedInboxIds.add(id);
        }
        if (retractedIds.size > 0)
          emit({
            type: "session_event",
            externalSessionId: binding.detail.id,
            provenance: "baseline",
            event: {
              type: "transcript_retracted",
              externalSessionId: binding.detail.id,
              timestamp: iso(Date.now()),
              messageIds: [...retractedIds],
            },
          });
        const snapshot: OpencodeRuntimeSnapshotSource = {
          repoPath: binding.ref.repoPath,
          externalSessionId: binding.detail.id,
          workingDirectory: binding.ref.workingDirectory,
          sessionAssociation: binding.scope,
          // A conversation without a native title has the runtime label, as on a control result.
          title: binding.detail.title || OPENCODE_RUNTIME_DESCRIPTOR.label,
          startedAt: iso(binding.detail.time.created),
          runtimeActivity:
            active[binding.detail.id] || awaitingTurns.has(binding.detail.id) ? "running" : "idle",
          contextUsage: projectContextUsage(messages, binding.detail.revert?.messageID),
          pendingApprovals: approvals.map((request) =>
            projectApproval(request, location.project.directory),
          ),
          pendingQuestions: forms.map(projectQuestion),
          queuedMessages: inbox.flatMap((item) => projectVisibleInboxUser(item)),
        };
        if (goal !== undefined) snapshot.goal = goal;
        if (active[binding.detail.id]) nativeRunning.add(binding.detail.id);
        else nativeRunning.delete(binding.detail.id);
        if (parentExternalSessionId) snapshot.parentExternalSessionId = parentExternalSessionId;
        return snapshot;
      });
    const authorizedByRepo = new Map<string, AgentSessionAuthorizedRoot[]>();
    const admittedRoots = new Map<string, AgentSessionAuthorizedRoot>();
    const restoreSources = async (
      repoPath?: string,
      roots?: AgentSessionAuthorizedRoot[],
    ): Promise<OpencodeRuntimeSnapshotRead> => {
      if (released)
        throw operationError(
          runtimeIdentity,
          "read live conversations",
          "runtime_unavailable",
          "The owned runtime was released.",
        );
      if (roots) {
        if (roots.some((root) => root.repoPath !== repoPath))
          throw new Error("The requested OpenCode roots belong to another repository.");
        authorizedByRepo.set(repoPath!, [...roots]);
      }
      const authorized = [...authorizedByRepo.values()]
        .flat()
        .filter((root) => repoPath === undefined || root.repoPath === repoPath);
      const selected = new Map<string, AgentSessionAuthorizedRoot>(
        authorized.map((root) => [root.externalSessionId, root]),
      );
      for (const root of admittedRoots.values())
        if (repoPath === undefined || root.repoPath === repoPath)
          selected.set(root.externalSessionId, root);
      const result: OpencodeRuntimeSnapshotRead = { sources: [], failures: [] };
      const seen = new Set<string>();
      const visit = async (
        ref: SessionRef,
        scope: AgentSessionAuthorizedRoot["sessionScope"],
        parent?: string,
      ): Promise<void> => {
        if (seen.has(ref.externalSessionId)) return;
        seen.add(ref.externalSessionId);
        try {
          const detail = await controller.readSession(ref, "restore the linked conversation");
          if (parent && detail.parentID !== parent)
            throw operationError(
              ref,
              "restore a child conversation",
              "identity_mismatch",
              "The native child belongs to another parent.",
            );
          const binding = controller.admit(ref, scope, detail);
          result.sources.push(await source(binding, parent));
          await nativeRequest(ref, "list child conversations", async () => {
            let cursor: string | undefined;
            const cursors = new Set<string>();
            do {
              const children = await client.session.list({
                parentID: detail.id,
                limit: 100,
                ...(cursor ? { cursor } : { order: "asc" }),
              });
              for (const child of children.data)
                await visit({ ...ref, externalSessionId: child.id }, scope, detail.id);
              cursor = children.cursor.next ?? undefined;
              if (cursor && cursors.has(cursor))
                throw new Error("OpenCode repeated a child-session cursor.");
              if (cursor) cursors.add(cursor);
            } while (cursor);
          });
        } catch (cause) {
          const failure: OpencodeRuntimeSnapshotFailure = {
            repoPath: ref.repoPath,
            externalSessionId: ref.externalSessionId,
            workingDirectory: ref.workingDirectory,
            message: cause instanceof Error ? cause.message : String(cause),
          };
          if (cause instanceof OpenCodeOperationError)
            failure.runtimeOperationFailure = cause.failure.runtimeOperationFailure;
          result.failures.push(failure);
        }
      };
      for (const root of selected.values()) await visit(root, root.sessionScope);
      return result;
    };
    const attachTails = new Map<string, Promise<void>>();
    const pendingSends = new Set<{ ref: SessionRef; controller: AbortController }>();
    const setAttachTail = (repoPath: string, tail: Promise<void>): void => {
      attachTails.set(repoPath, tail);
      void tail.then(() => {
        if (attachTails.get(repoPath) === tail) attachTails.delete(repoPath);
      });
    };
    const cancelPendingSends = (ref: SessionRef): void => {
      for (const pending of pendingSends)
        if (agentSessionRefsEqual(pending.ref, ref))
          pending.controller.abort(
            operationError(
              ref,
              "send prepared input",
              "runtime_unavailable",
              "The conversation stopped or was released before this input was submitted. Review the retained draft and send it explicitly after reopening.",
            ),
          );
    };
    const readSessionSources = (
      repoPath: string,
      roots?: AgentSessionAuthorizedRoot[],
    ): Promise<OpencodeRuntimeSnapshotRead> => {
      // Snapshots and native changes share the same observation lane.
      const read = (attachTails.get(repoPath) ?? Promise.resolve()).then(() => {
        const reading = processing.then(() => restoreSources(repoPath, roots));
        processing = reading.then(
          () => undefined,
          () => undefined,
        );
        return reading;
      });
      setAttachTail(
        repoPath,
        read.then(
          () => undefined,
          () => undefined,
        ),
      );
      return read;
    };
    let initialConnected = false;
    let readyResolve!: () => void;
    let readyReject!: (cause: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const seenEvents = new Set<string>();
    const sequence = new Map<string, number>();
    const handleEvent = async (event: V2Event) => {
      if (released || abort.signal.aborted) return;
      if (event.type === "server.connected") {
        if (initialConnected) {
          emit({ type: "observation_reset" });
          const restored = await restoreSources();
          for (const restoredSource of restored.sources) {
            emit({ type: "session_source", source: restoredSource });
            const projector = projectors.get(restoredSource.externalSessionId)!;
            for (const projected of projector.snapshotEvents(restoredSource.externalSessionId))
              emit({
                type: "session_event",
                externalSessionId: restoredSource.externalSessionId,
                event: projected,
                provenance: "baseline",
              });
          }
          for (const failure of restored.failures) {
            const fault = {
              type: "session_fault" as const,
              externalSessionId: failure.externalSessionId,
              message: failure.message,
              statusUnavailable: true as const,
            };
            emit(
              failure.runtimeOperationFailure
                ? { ...fault, runtimeOperationFailure: failure.runtimeOperationFailure }
                : fault,
            );
          }
        }
        initialConnected = true;
        return;
      }
      const externalSessionId = eventSessionId(event);
      // A faulted conversation takes no event until a read, except its removal.
      if (externalSessionId && faulted.has(externalSessionId) && event.type !== "session.deleted")
        return;
      const parent =
        event.type === "session.created" && event.data.parentID
          ? controller.bindings.get(event.data.parentID)
          : undefined;
      if (externalSessionId && !controller.bindings.has(externalSessionId) && !parent) return;
      if ("durable" in event && externalSessionId) {
        const previous = sequence.get(event.durable.aggregateID);
        if (previous !== undefined && event.durable.seq <= previous) return;
        sequence.set(event.durable.aggregateID, event.durable.seq);
      } else {
        if (seenEvents.has(event.id)) return;
        seenEvents.add(event.id);
        // Match the native subscriber's capacity; transient events have no durable replay cursor.
        if (seenEvents.size > 4_096) seenEvents.delete(seenEvents.values().next().value!);
      }
      if (
        [
          "models.dev.refreshed",
          "model.updated",
          "provider.updated",
          "credential.updated",
          "credential.switched",
          "integration.updated",
          "agent.updated",
          "command.updated",
          "skill.updated",
          "config.updated",
          "plugin.updated",
        ].includes(event.type)
      ) {
        const changed = {
          type: "catalog_invalidated" as const,
        };
        emit(event.location ? { ...changed, workingDirectory: event.location.directory } : changed);
      }
      if (event.type === "tui.toast.show") {
        if (event.data.variant === "warning" || event.data.variant === "error")
          emit({ type: "runtime_notice", message: event.data.message });
        return;
      }
      if (event.type === "plugin.updated") {
        let plugins: Awaited<ReturnType<typeof client.plugin.list>>;
        try {
          plugins = await nativeRequest(runtimeIdentity, "read plugin diagnostics", () =>
            client.plugin.list(
              event.location ? { location: { directory: event.location.directory } } : {},
            ),
          );
        } catch (cause) {
          if (!(cause instanceof OpenCodeOperationError)) throw cause;
          emit({ type: "runtime_notice", message: cause.message });
          return;
        }
        for (const plugin of plugins.data)
          if (plugin.state.status === "failed")
            emit({
              type: "runtime_notice",
              message: `OpenCode plugin '${plugin.id}' failed: ${plugin.state.error}`,
            });
        return;
      }
      // A cancelled Code Mode job sends no notice, only this update of the job.
      if (event.type === "experimental.job.updated") {
        const { info } = event.data;
        if (
          info.kind === "codemode" &&
          info.status === "cancelled" &&
          controller.bindings.has(info.sessionID) &&
          !faulted.has(info.sessionID)
        )
          background.jobCancelled(info.sessionID, info.id, iso(event.created));
        return;
      }
      if (!externalSessionId) return;
      if (parent) {
        const ref = { ...parent.ref, externalSessionId };
        const parentGeneration = controller.generation(parent.detail.id);
        const childGeneration = controller.generation(externalSessionId);
        const isCurrent = () =>
          controller.bindings.has(parent.detail.id) &&
          controller.generation(parent.detail.id) === parentGeneration &&
          controller.generation(externalSessionId) === childGeneration;
        try {
          const detail = await controller.readSession(ref, "verify the child conversation");
          if (!isCurrent()) return;
          if (detail.parentID !== parent.detail.id)
            throw operationError(
              ref,
              "attach the child conversation",
              "identity_mismatch",
              "The native child parent changed.",
            );
          await nativeRequest(ref, "install child session controls", () =>
            installOpenCodePolicy({
              client,
              detail,
              scope: parent.scope,
              policySessionId: controller.policySessionId(parent.detail),
              repoPath: ref.repoPath,
              resolveWorkflowRolePolicy: options.resolveWorkflowRolePolicy,
            }),
          );
          if (!isCurrent()) return;
          const childSource = await source(
            controller.admit(ref, parent.scope, detail, true),
            parent.detail.id,
          );
          if (isCurrent()) emit({ type: "session_source", source: childSource });
        } catch (cause) {
          if (!isCurrent()) return;
          controller.bindings.delete(externalSessionId);
          projectors.delete(externalSessionId);
          nativeRunning.delete(externalSessionId);
          failSession(parent.detail.id, cause);
          return;
        }
      }
      const binding = controller.bindings.get(externalSessionId);
      if (!binding) return;
      // The envelope location belongs to the publisher. Background jobs can retain another
      // directory, so only native session location payloads can change the verified identity.
      if (
        (event.type === "session.created" || event.type === "session.moved") &&
        event.data.location.directory !== binding.ref.workingDirectory
      )
        throw operationError(
          binding.ref,
          "apply a native event",
          "identity_mismatch",
          "The native conversation location does not match the verified conversation.",
        );
      if (options.logEvent) options.logEvent({ externalSessionId, relevant: true, event });
      if (event.type === OPENCODE_GOAL_CHANGED_EVENT) {
        emit({
          type: "goal_updated",
          externalSessionId,
          goal: readOpenCodeGoalChange(event),
        });
        return;
      }
      const base = {
        externalSessionId,
        timestamp: iso("created" in event ? event.created : Date.now()),
      };
      if (event.type === "session.deleted") {
        // OpenCode removes the child sessions with the session and cancels their jobs. A loss on
        // the session covers only work of that removed tree, so the ancestors drop it too.
        const reportRemoval = background.removeSession(externalSessionId, base.timestamp);
        controller.bindings.delete(externalSessionId);
        projectors.delete(externalSessionId);
        faulted.delete(externalSessionId);
        awaitingTurns.delete(externalSessionId);
        nativeRunning.delete(externalSessionId);
        sequence.delete(externalSessionId);
        emit({ type: "session_removed", externalSessionId });
        reportRemoval();
        return;
      }
      if (event.type === "permission.asked") {
        if (event.data.source?.type === "tool")
          projectors.get(externalSessionId)?.recordApprovalAsk(event.data.id, event.data.source.id);
        let projectDirectory: string;
        try {
          projectDirectory = await nativeRequest(
            binding.ref,
            "read approval location",
            async () => {
              const location = await client.location.get({
                location: { directory: binding.ref.workingDirectory },
              });
              return location.project.directory;
            },
          );
        } catch (cause) {
          failSession(externalSessionId, cause);
          return;
        }
        emit({
          type: "session_event",
          externalSessionId,
          event: {
            ...base,
            type: "approval_required",
            ...projectApproval(event.data, projectDirectory),
          },
        });
        return;
      }
      if (event.type === "permission.replied") {
        emit({
          type: "session_event",
          externalSessionId,
          event: { ...base, type: "approval_resolved", requestId: event.data.requestID },
        });
        return;
      }
      if (event.type === "form.created") {
        emit({
          type: "session_event",
          externalSessionId,
          event: { ...base, type: "question_required", ...projectQuestion(event.data.form) },
        });
        return;
      }
      if (event.type === "form.replied" || event.type === "form.cancelled") {
        emit({
          type: "session_event",
          externalSessionId,
          event: { ...base, type: "question_resolved", requestId: event.data.id },
        });
        return;
      }
      const projector = projectors.get(externalSessionId)!;
      let inputSettled = false;
      if (event.type === "session.inbox.delivered" || event.type === "session.inbox.cancelled")
        for (const turn of awaitingTurns.get(externalSessionId) ?? []) {
          if (turn.inboxId === event.data.inboxID) inputSettled = settleTurn(turn) || inputSettled;
          // Native inbox events can arrive before the HTTP acceptance receipt.
          else if (turn.submitted && !turn.customCommand && turn.inboxId === undefined)
            turn.consumedInboxIds.add(event.data.inboxID);
        }
      if (event.type === "session.revert.staged") binding.detail.revert = event.data.revert;
      if (event.type === "session.revert.cleared" || event.type === "session.revert.committed")
        delete binding.detail.revert;
      for (let projected of projector.apply(event, !nativeRunning.has(externalSessionId))) {
        if (projected.type === "session_status" && projected.status.type !== "idle") {
          nativeRunning.add(externalSessionId);
          background.replyStarted(externalSessionId);
          for (const turn of awaitingTurns.get(externalSessionId) ?? [])
            if (turn.submitted && turn.customCommand) settleTurn(turn);
          if (background.hasWork(externalSessionId))
            projected = { ...projected, foregroundTurnActive: true };
        }
        if (
          projected.type === "session_idle" ||
          (projected.type === "session_status" && projected.status.type === "idle")
        ) {
          nativeRunning.delete(externalSessionId);
          const terminalExecution =
            event.type === "session.execution.succeeded" ||
            event.type === "session.execution.failed" ||
            event.type === "session.execution.interrupted";
          if (terminalExecution)
            for (const turn of awaitingTurns.get(externalSessionId) ?? [])
              if (turn.submitted && turn.customCommand) settleTurn(turn);
          if (awaitingTurns.has(externalSessionId)) continue;
          if (background.hasWork(externalSessionId)) {
            emit({
              type: "session_event",
              externalSessionId,
              event: background.replyEnd(projected, event.id),
            });
            continue;
          }
        }
        if (projected.type === "session_error" || projected.type === "session_finished") {
          awaitingTurns.delete(externalSessionId);
          nativeRunning.delete(externalSessionId);
        }
        emit({ type: "session_event", externalSessionId, event: projected });
      }
      if (inputSettled && !nativeRunning.has(externalSessionId)) reportActivity(binding.ref);
      if (
        event.type === "session.execution.succeeded" ||
        event.type === "session.execution.failed" ||
        event.type === "session.execution.interrupted"
      )
        background.executionEnded(externalSessionId);
      try {
        const parentID = binding.detail.parentID;
        if (parentID) {
          if (event.type === "session.execution.started")
            background.childExecutionStarted(
              externalSessionId,
              parentID,
              event.id,
              { agent: binding.detail.agent ?? "subagent", title: binding.detail.title },
              base.timestamp,
            );
          if (event.type === "session.step.started") background.childStepStarted(externalSessionId);
          if (event.type === "session.execution.succeeded")
            background.childExecutionEnded(
              externalSessionId,
              parentID,
              "succeeded",
              base.timestamp,
            );
          if (event.type === "session.execution.failed")
            background.childExecutionEnded(externalSessionId, parentID, "failed", base.timestamp);
          if (event.type === "session.execution.interrupted")
            background.childExecutionEnded(
              externalSessionId,
              parentID,
              event.data.reason === "shutdown" ? "shutdown" : "interrupted",
              base.timestamp,
            );
        }
        // Only a call whose result says that its job still runs, or a media call, which always
        // starts a job, can start a background task.
        if (
          event.type === "session.tool.success" &&
          (event.data.metadata?.status === "running" || event.data.metadata?.jobID !== undefined)
        ) {
          const message = projector.messages.get(event.data.assistantMessageID);
          const part =
            message?.type === "assistant"
              ? message.content.find((item) => item.type === "tool" && item.id === event.data.id)
              : undefined;
          if (part?.type === "tool")
            background.startCall(
              externalSessionId,
              binding.ref.workingDirectory,
              part,
              base.timestamp,
            );
        }
        if (event.type === "session.inbox.enqueued") {
          const item = projector.inbox.get(event.data.inboxID);
          if (item) background.notice(externalSessionId, item, base.timestamp);
        }
        if (event.type === "session.inbox.delivered" || event.type === "session.inbox.cancelled")
          background.settle(
            externalSessionId,
            event.data.inboxID,
            event.type === "session.inbox.delivered",
            base.timestamp,
          );
      } catch (cause) {
        const lost = cause instanceof Error ? cause : new Error(String(cause));
        background.lose(externalSessionId, lost);
        emit({
          type: "session_fault",
          externalSessionId,
          message: lost.message,
          statusUnavailable: true,
          backgroundTrackingLost: true,
        });
      }
      if (
        event.type === "session.step.ended" ||
        event.type === "session.step.failed" ||
        event.type === "session.compaction.ended" ||
        event.type === "session.revert.staged" ||
        event.type === "session.revert.cleared" ||
        event.type === "session.revert.committed"
      )
        emit({
          type: "context_updated",
          externalSessionId,
          contextUsage: projectContextUsage(
            [...projector.messages.values()],
            binding.detail.revert?.messageID,
          ),
        });
    };
    const stream = (async () => {
      try {
        for await (const event of client.event.subscribe({ signal: abort.signal })) {
          if (event.type === "mcp.status.changed") mcpBridge.statusChanged();
          if (event.type === "location.shutdown" && event.location)
            mcpBridge.locationShutdown(event.location.directory);
          if (event.type === "model.updated" && event.location)
            generationModels.modelsChanged(event.location.directory);
          if (event.type === "plugin.updated" && event.location)
            catalogReadiness.pluginsChanged(event.location.directory);
          if (event.type === "server.connected" && !initialConnected) readyResolve();
          processing = processing
            .then(() => handleEvent(event))
            .catch((cause: unknown) => {
              const sessionID = eventSessionId(event);
              if (sessionID !== undefined && controller.bindings.has(sessionID)) {
                faultSession(sessionID, cause);
                return;
              }
              fail(cause);
              abort.abort();
            });
        }
        if (!abort.signal.aborted) throw new Error("The native event stream ended.");
      } catch (cause) {
        readyReject(cause);
        if (abort.signal.aborted) return;
        fail(cause);
        // The abort ends waits for the MCP bridge, generation models, and catalogs.
        abort.abort();
      }
    })();
    const rejectOnAbort = () =>
      readyReject(
        operationError(
          runtimeIdentity,
          "observe native events",
          "runtime_unavailable",
          "The owned connection closed before subscription was ready.",
        ),
      );
    abort.signal.addEventListener("abort", rejectOnAbort, { once: true });
    try {
      await ready;
    } catch (cause) {
      released = true;
      abort.abort();
      await stream;
      input.signal?.removeEventListener("abort", abortFromHost);
      throw cause;
    }
    const connection: OpencodeSessionRuntimeConnection = {
      generateText: controller.generateText.bind(controller),
      generateJson: controller.generateJson.bind(controller),
      startSession: async (ref) => {
        const summary = await controller.startSession(ref);
        admittedRoots.set(summary.externalSessionId, {
          ...ref,
          externalSessionId: summary.externalSessionId,
        });
        return summary;
      },
      resumeSession: async (ref) => {
        const summary = await controller.resumeSession(ref);
        admittedRoots.set(summary.externalSessionId, ref);
        if (summary.status === "running") nativeRunning.add(summary.externalSessionId);
        else nativeRunning.delete(summary.externalSessionId);
        return awaitingTurns.has(summary.externalSessionId)
          ? { ...summary, status: "running" }
          : summary;
      },
      continueInterruptedTurn: async (ref) => {
        const summary = await controller.continueInterruptedTurn(ref);
        // A continuation after a host restart attaches the conversation, as a resume does. Native
        // events then report its activity.
        admittedRoots.set(summary.externalSessionId, ref);
        return summary;
      },
      forkSession: async (ref) => {
        const summary = await controller.forkSession(ref);
        admittedRoots.set(summary.externalSessionId, {
          ...ref,
          externalSessionId: summary.externalSessionId,
        });
        return summary;
      },
      sendUserMessage: (messageInput, options) => {
        const working =
          nativeRunning.has(messageInput.externalSessionId) ||
          awaitingTurns.has(messageInput.externalSessionId);
        if (working && messageInput.delivery === "new_turn")
          return Promise.reject(new AgentSessionTurnActiveError(messageInput.externalSessionId));
        const binding = controller.bindings.get(messageInput.externalSessionId);
        const turn: AwaitingTurn = {
          ref: messageInput,
          submitted: false,
          customCommand: messageInput.parts.some(
            (part) =>
              part.kind === "slash_command" && !isManualSessionCompactionSlashCommand(part.command),
          ),
          consumedInboxIds: new Set(),
        };
        const assertCommandIdle = () => {
          if (
            nativeRunning.has(messageInput.externalSessionId) ||
            [...(awaitingTurns.get(messageInput.externalSessionId) ?? [])].some(
              (pending) => pending !== turn,
            )
          )
            throw operationError(
              messageInput,
              "send a custom slash command",
              "unsupported_operation",
              "Custom slash commands cannot run while execution or input preparation is active. OpenCode returns no input ID for these commands.",
              "Wait until this conversation is idle, then send the command again.",
            );
        };
        if (binding && agentSessionRefsEqual(binding.ref, messageInput)) {
          if (turn.customCommand)
            try {
              assertCommandIdle();
            } catch (cause) {
              if (cause instanceof Error)
                return Promise.reject(new AgentSessionMessageRefusedError(cause));
              return Promise.reject(cause);
            }
          const turns =
            awaitingTurns.get(messageInput.externalSessionId) ?? new Set<AwaitingTurn>();
          turns.add(turn);
          awaitingTurns.set(messageInput.externalSessionId, turns);
          reportActivity(messageInput);
        }
        const settleInput = () => {
          if (settleTurn(turn)) reportActivity(messageInput);
        };
        const pending = { ref: messageInput, controller: new AbortController() };
        pendingSends.add(pending);
        const signal = pending.controller.signal;
        let rejectAborted!: () => void;
        const aborted = new Promise<never>((_resolve, reject) => {
          rejectAborted = () => reject(signal.reason);
        });
        const abort = () => rejectAborted();
        signal.addEventListener("abort", abort, { once: true });
        const clearPending = (): void => {
          signal.removeEventListener("abort", abort);
          pendingSends.delete(pending);
        };
        let markSent!: () => void;
        const sent = new Promise<void>((resolve) => {
          markSent = resolve;
        });
        const sending = (attachTails.get(messageInput.repoPath) ?? Promise.resolve()).then(() => {
          signal.throwIfAborted();
          const sessionID = messageInput.externalSessionId;
          // An input to an idle session joins a waiting steer, such as a kept task result.
          const joinWaitingSteer =
            !nativeRunning.has(sessionID) &&
            [...(awaitingTurns.get(sessionID) ?? [])].every((pending) => pending === turn) &&
            [...(projectors.get(sessionID)?.inbox.values() ?? [])].some(
              (item) => item.type === "synthetic" && item.delivery === "steer",
            );
          return controller.sendUserMessage(messageInput, {
            signal,
            assertCommandIdle,
            joinWaitingSteer,
            onSent: () => {
              turn.submitted = true;
              clearPending();
              markSent();
              options?.onSent?.();
            },
          });
        });
        setAttachTail(
          messageInput.repoPath,
          Promise.race([
            sent,
            sending.then(
              () => undefined,
              () => undefined,
            ),
          ]),
        );
        return Promise.race([sending, aborted])
          .then((sentReceipt) => {
            // Nothing runs ahead of a message that an idle session takes, so it shows as read.
            const receipt =
              !working && sentReceipt.type === "user_message" && sentReceipt.state === "queued"
                ? { ...sentReceipt, state: "read" as const }
                : sentReceipt;
            const accepted = processing.then(() => {
              const inputId = receipt.type === "user_message" ? receipt.messageId : receipt.inputId;
              if (inputId !== undefined) {
                turn.inboxId = inputId;
                if (
                  turn.consumedInboxIds.has(inputId) ||
                  projectors.get(messageInput.externalSessionId)?.messages.has(inputId)
                )
                  settleInput();
                turn.consumedInboxIds.clear();
              }
              return receipt;
            });
            processing = accepted.then(
              () => undefined,
              () => undefined,
            );
            return accepted;
          })
          .catch((cause: unknown) => {
            if (!(cause instanceof AgentSessionMessageAcceptanceUnknownError)) {
              settleInput();
              throw cause;
            }
            // The event stream can show the input before the send fails without an answer.
            // That event proves that OpenCode took the input, so the send reports it as accepted.
            const unknownResult = cause;
            const recovered = processing.then(() => {
              const shown = projectors
                .get(messageInput.externalSessionId)
                ?.acceptedUserMessage(messageInput.externalSessionId, unknownResult.messageId);
              if (!shown) {
                settleInput();
                throw unknownResult;
              }
              turn.inboxId = unknownResult.messageId;
              if (shown.state === "read") settleInput();
              turn.consumedInboxIds.clear();
              if (messageInput.submissionId) shown.submissionId = messageInput.submissionId;
              return shown;
            });
            processing = recovered.then(
              () => undefined,
              () => undefined,
            );
            return recovered;
          })
          .finally(clearPending);
      },
      controlGoal: async (goalInput, goalOptions) => {
        if (!goals.available)
          throw new AgentSessionMessageRefusedError(
            operationError(
              goalInput,
              "use goals",
              "unsupported_operation",
              goals.reason,
              OPENCODE_RUNTIME_DESCRIPTOR.updateAction,
            ),
          );
        const sessionID = goalInput.externalSessionId;
        const working = nativeRunning.has(sessionID) || awaitingTurns.has(sessionID);
        // A new or resumed goal starts work. The session shows it as running until native
        // execution events confirm or end it. Pause and clear start no work.
        const binding = controller.bindings.get(sessionID);
        const turn: AwaitingTurn | undefined =
          goalCommandStartsWork(goalInput.command) &&
          binding &&
          agentSessionRefsEqual(binding.ref, goalInput)
            ? { ref: goalInput, submitted: false, customCommand: true, consumedInboxIds: new Set() }
            : undefined;
        if (turn) {
          const turns = awaitingTurns.get(sessionID) ?? new Set<AwaitingTurn>();
          turns.add(turn);
          awaitingTurns.set(sessionID, turns);
          reportActivity(goalInput);
        }
        try {
          await (attachTails.get(goalInput.repoPath) ?? Promise.resolve());
          await controller.controlGoal(goalInput, {
            delivery: working ? "steer" : "queue",
            onSent: () => {
              if (turn) turn.submitted = true;
              goalOptions?.onSent?.();
            },
          });
        } catch (cause) {
          if (turn && settleTurn(turn)) reportActivity(goalInput);
          throw cause;
        }
      },
      updateSessionModel: controller.updateSessionModel.bind(controller),
      updateSessionTitle: controller.updateSessionTitle.bind(controller),
      stopSession: async (ref) => {
        const turns = [...(awaitingTurns.get(ref.externalSessionId) ?? [])].filter((turn) =>
          agentSessionRefsEqual(turn.ref, ref),
        );
        cancelPendingSends(ref);
        await background.stopTree(ref, async () => {
          // The end event of the stopped reply can arrive before the interrupt answer.
          const end = background.watchExecutionEnd(ref.externalSessionId);
          let interrupted: boolean;
          try {
            interrupted = await controller.stopSession(ref);
          } catch (cause) {
            end.stop();
            throw cause;
          }
          let stopped = false;
          for (const turn of turns) stopped = settleTurn(turn) || stopped;
          if (stopped) {
            nativeRunning.delete(ref.externalSessionId);
            reportActivity(ref);
          }
          await background.waitForInterruptedExecution(ref, end, interrupted);
        });
      },
      stopBackgroundTask: async ({ taskId, ...ref }) => {
        const binding = controller.bindings.get(ref.externalSessionId);
        if (!binding || !agentSessionRefsEqual(binding.ref, ref)) return;
        await background.stopTask(ref, taskId);
      },
      releaseSession: async (ref) => {
        // The released bindings no longer name their parent, so read the ancestors first.
        const ancestors = background.chain(ref.externalSessionId).slice(1);
        const releasedRefs = await controller.releaseSession(ref);
        const observed = ancestors.filter((sessionID) => controller.bindings.has(sessionID));
        // The ancestors cannot confirm the end of the unresolved work of the released tree.
        background.release(
          releasedRefs.map((releasedRef) => releasedRef.externalSessionId),
          observed,
        );
        for (const releasedRef of releasedRefs) {
          cancelPendingSends(releasedRef);
          projectors.delete(releasedRef.externalSessionId);
          awaitingTurns.delete(releasedRef.externalSessionId);
          nativeRunning.delete(releasedRef.externalSessionId);
          sequence.delete(releasedRef.externalSessionId);
          admittedRoots.delete(releasedRef.externalSessionId);
          const roots = authorizedByRepo.get(releasedRef.repoPath);
          if (roots)
            authorizedByRepo.set(
              releasedRef.repoPath,
              roots.filter((root) => root.externalSessionId !== releasedRef.externalSessionId),
            );
        }
      },
      readSessionSources,
      loadContextUsage: (ref) =>
        nativeRequest(ref, "read context usage", async () => {
          const detail = await controller.readSession(ref, "read context usage");
          return projectContextUsage(
            await readMessages(client, detail.id),
            detail.revert?.messageID,
          );
        }),
      replyApproval: async (request) => {
        await controller.readSession(request.ref, "answer approval");
        await nativeRequest(request.ref, "answer approval", async () => {
          const reply: OpenCodeRequestDraft<Parameters<OpenCodeClient["permission"]["reply"]>[0]> =
            {
              sessionID: request.ref.externalSessionId,
              requestID: request.nativeRequestId,
              decision: permissionDecision(request.outcome),
            };
          if (request.message) reply.message = request.message;
          if (request.denialSource === "read_only_role")
            projectors
              .get(request.ref.externalSessionId)
              ?.recordRoleReject(request.nativeRequestId);
          request.onIssued?.();
          await client.permission.reply(reply);
        });
      },
      replyQuestion: async (request) => {
        await controller.readSession(request.ref, "answer the form");
        await nativeRequest(request.ref, "answer the form", async () => {
          const form = await client.session.form.get({
            sessionID: request.ref.externalSessionId,
            formID: request.nativeRequestId,
          });
          if (
            form.sessionID !== request.ref.externalSessionId ||
            form.id !== request.nativeRequestId
          )
            throw operationError(
              request.ref,
              "answer the form",
              "identity_mismatch",
              "The native form does not match this pending request.",
            );
          await replyForm(client, form, request.answers);
        });
      },
    };
    const metadata = (detail: SessionInfo) => ({
      externalSessionId: detail.id,
      runtimeKind: "opencode" as const,
      workingDirectory: detail.location.directory,
      title: detail.title ?? null,
      updatedAt: detail.time.updated,
    });
    return {
      connection,
      queries: {
        loadRuntimeCatalog: (target) =>
          readCatalog(client, target.workingDirectory, catalogReadiness.awaitPlugins(target)),
        searchFiles: controller.searchFiles.bind(controller),
        loadSessionHistory: controller.loadSessionHistory.bind(controller),
        loadSessionTodos: controller.loadSessionTodos.bind(controller),
        resolveSessionParent: controller.resolveSessionParent.bind(controller),
        loadSessionDiff: controller.loadSessionDiff.bind(controller),
        loadFileStatus: controller.loadFileStatus.bind(controller),
      },
      sessionImport: {
        async *scanSessions({ repoPath, signal }) {
          await nativeRequest({ repoPath }, "list native conversations", () =>
            readMigration(client, { repoPath }, "list native conversations"),
          );
          let cursor: string | undefined;
          const cursors = new Set<string>();
          do {
            const page = await nativeRequest({ repoPath }, "list native conversations", () =>
              client.session.list(
                { parentID: null, limit: 100, ...(cursor ? { cursor } : { order: "desc" }) },
                { signal },
              ),
            );
            yield page.data.filter((detail) => !detail.parentID).map(metadata);
            cursor = page.cursor.next ?? undefined;
            if (cursor && cursors.has(cursor))
              throw new Error("OpenCode repeated an import cursor.");
            if (cursor) cursors.add(cursor);
          } while (cursor && !signal.aborted);
        },
        async inspectSession(ref) {
          const detail = await controller.readNativeSession(ref, "inspect the native conversation");
          if (detail.parentID)
            throw operationError(
              ref,
              "import the conversation",
              "unsupported_operation",
              "Import the root conversation instead of a delegated child.",
            );
          let selectedModel: Awaited<
            ReturnType<RuntimeSessionImportPort["inspectSession"]>
          >["selectedModel"] = null;
          if (detail.model) {
            selectedModel = { ...modelSelection(detail.model), runtimeKind: "opencode" };
            if (detail.agent) selectedModel.profileId = detail.agent;
          }
          return {
            metadata: metadata(detail),
            selectedModel,
            attach: async () => {
              await controller.bind({
                ...ref,
                runtimeKind: "opencode",
                runtimePolicy: { kind: "opencode" },
              });
              admittedRoots.set(ref.externalSessionId, ref);
            },
          };
        },
      },
      async startForwarding(target) {
        if (released || listener)
          throw new Error("OpenCode live forwarding is unavailable or already started.");
        listener = target;
        for (const signal of pending.splice(0)) emit(signal);
        await delivery;
        if (failure) throw failure;
      },
      async release() {
        if (released) return;
        released = true;
        for (const pending of pendingSends)
          pending.controller.abort(
            new Error(
              "The OpenCode runtime was released before this input was submitted. Reopen the conversation and review the retained draft.",
            ),
          );
        pendingSends.clear();
        attachTails.clear();
        background.close(new Error("The OpenCode runtime was released."));
        controller.close();
        abort.abort();
        input.signal?.removeEventListener("abort", abortFromHost);
        await stream;
        // A fault listener can release this runtime. Waiting for that delivery would wait on itself.
        await processing.catch(() => undefined);
        controller.bindings.clear();
        projectors.clear();
        seenEvents.clear();
        sequence.clear();
        mcpBridge.close();
        admittedRoots.clear();
        authorizedByRepo.clear();
      },
    };
  };
