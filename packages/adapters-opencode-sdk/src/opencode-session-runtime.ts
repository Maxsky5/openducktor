import { agentSessionRefsEqual } from "@openducktor/core";
import type { SessionInfo, V2Event, OpenCodeClient } from "@opencode/client";
import {
  isManualSessionCompactionSlashCommand,
  type AgentSessionAuthorizedRoot,
} from "@openducktor/contracts";
import type {
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
import { OpencodeSdkAdapter, type OpenCodeSessionBinding } from "./opencode-sdk-adapter";
import { OpenCodeMessageRejectedError } from "./opencode-message-rejected-error";
import { installOpenCodePolicy, readWorkflowInstructions } from "./opencode-permissions";
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
  projectInboxUser,
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
  | "stopSession"
> & {
  releaseSession: (ref: SessionRef) => Promise<void>;
  readSessionSources: (
    repoPath: string,
    roots?: AgentSessionAuthorizedRoot[],
  ) => Promise<OpencodeRuntimeSnapshotRead>;
  loadContextUsage: (ref: SessionRef) => Promise<OpencodeSessionContextUsage | null>;
  replyApproval: (input: OpencodeNativeApprovalReply) => Promise<void>;
  replyQuestion: (input: OpencodeNativeQuestionReply) => Promise<void>;
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

export const createPrepareOpencodeSessionRuntime =
  (
    options: OpencodeSdkAdapterOptions & {
      readDirectory: ReadOpencodeDirectory;
      resolveMcpServerConfig: ManagedMcpServerResolver;
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
    const installedMcp = new Map<string, { repoPath: string; workingDirectory: string }>();
    const mcpInstallations = new Map<string, Promise<void>>();
    const mcpChanges = new Set<() => void>();
    let mcpVersion = 0;
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
    const reportActivity = (ref: SessionRef): void =>
      emit({
        type: "session_event",
        externalSessionId: ref.externalSessionId,
        event: {
          type: "session_status",
          externalSessionId: ref.externalSessionId,
          timestamp: iso(Date.now()),
          status:
            nativeRunning.has(ref.externalSessionId) || awaitingTurns.has(ref.externalSessionId)
              ? { type: "busy", message: null }
              : { type: "idle" },
        },
      });
    const fail = (cause: unknown) => {
      if (released || failure) return;
      failure = cause instanceof Error ? cause : new Error(String(cause));
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
    const wakeMcp = () => {
      mcpVersion++;
      for (const wake of mcpChanges) wake();
      mcpChanges.clear();
    };
    abort.signal.addEventListener("abort", wakeMcp);
    const waitMcpChange = (version: number) =>
      version !== mcpVersion
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              mcpChanges.delete(wake);
              reject(
                operationError(
                  runtimeIdentity,
                  "connect the OpenDucktor MCP bridge",
                  "runtime_unavailable",
                  "The native MCP connection remained pending.",
                  "Check the workspace MCP bridge command, then restart the selected runtime.",
                ),
              );
            }, 30_000);
            const wake = () => {
              clearTimeout(timer);
              resolve();
            };
            mcpChanges.add(wake);
          });
    let controller: OpencodeSdkAdapter;
    const connectMcp = async (
      identity: { repoPath: string; workingDirectory: string },
      owner: { repoPath: string; workingDirectory: string },
    ) => {
      const directory = identity.workingDirectory;
      const requireCurrent = () => {
        if (installedMcp.get(directory) !== owner || released || abort.signal.aborted)
          throw operationError(
            identity,
            "bind the OpenDucktor MCP bridge",
            "runtime_unavailable",
            "The native MCP binding changed during setup. Restart OpenCode from Diagnostics.",
          );
      };
      if (!mcpConfigured.has(directory)) {
        const existing = await controller.client.mcp.list({ location: { directory } });
        if (existing.data.some((server) => server.name === "openducktor"))
          throw operationError(
            identity,
            "install the OpenDucktor MCP bridge",
            "policy_failed",
            "The native configuration already contains an MCP server named 'openducktor'.",
            "Rename or remove the conflicting user MCP server, then restart the selected runtime.",
          );
        const config = await options.resolveMcpServerConfig(identity.repoPath);
        requireCurrent();
        await controller.client.mcp.add({
          server: "openducktor",
          location: { directory },
          config: {
            type: "local",
            command: [...config.command],
            environment: { ...config.environment },
            codemode: false,
          },
        });
        requireCurrent();
        mcpConfigured.add(directory);
      }
      while (!released && !abort.signal.aborted) {
        const version = mcpVersion;
        const list = await controller.client.mcp.list({ location: { directory } });
        requireCurrent();
        const server = list.data.find((item) => item.name === "openducktor");
        if (!server)
          throw operationError(
            identity,
            "connect the OpenDucktor MCP bridge",
            "policy_failed",
            "The installed native MCP override is missing.",
            "Restart the selected runtime and retry.",
          );
        if (server.status.status === "connected") return;
        if (server.status.status !== "pending")
          throw operationError(
            identity,
            "connect the OpenDucktor MCP bridge",
            "policy_failed",
            "error" in server.status
              ? server.status.error
              : `Native MCP status: ${server.status.status}.`,
            "Check the workspace MCP bridge command, then restart the selected runtime.",
          );
        await waitMcpChange(version);
      }
      throw operationError(
        identity,
        "connect the OpenDucktor MCP bridge",
        "runtime_unavailable",
        "The owned runtime connection closed.",
      );
    };
    const mcpConfigured = new Set<string>();
    const ensureMcp = (ref: { repoPath: string; workingDirectory: string }): Promise<void> => {
      const directory = ref.workingDirectory;
      let owner = installedMcp.get(directory);
      if (owner && owner.repoPath !== ref.repoPath)
        return Promise.reject(
          operationError(
            ref,
            "bind the OpenDucktor MCP bridge",
            "identity_mismatch",
            `The directory belongs to repository '${owner.repoPath}'. Open it from its owning workspace, or restart OpenCode after its sessions end.`,
          ),
        );
      if (!owner) {
        owner = { ...ref };
        installedMcp.set(directory, owner);
      }
      const existing = mcpInstallations.get(directory);
      if (existing) return existing;
      const installation = connectMcp(ref, owner).finally(() => mcpInstallations.delete(directory));
      mcpInstallations.set(directory, installation);
      return installation;
    };
    controller = new OpencodeSdkAdapter(input.connection, options, {
      readDirectory: options.readDirectory,
      ensureMcp,
      admitted: (binding) => {
        if (!projectors.has(binding.detail.id))
          projectors.set(binding.detail.id, new OpenCodeLiveMessageProjector());
      },
    });
    abort.signal.addEventListener("abort", () => controller.close(), { once: true });
    if (abort.signal.aborted) controller.close();
    const client = controller.client;
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

    const source = (
      binding: OpenCodeSessionBinding,
      parentExternalSessionId?: string,
    ): Promise<OpencodeRuntimeSnapshotSource> =>
      nativeRequest(binding.ref, "read the conversation", async () => {
        const [active, approvals, forms, location, inbox, messages] = await Promise.all([
          client.session.active(),
          client.permission.list({ sessionID: binding.detail.id }),
          client.session.form.list({ sessionID: binding.detail.id }),
          client.location.get({ location: { directory: binding.ref.workingDirectory } }),
          client.session.inbox.list({ sessionID: binding.detail.id }),
          readOpenCodeTranscript(client, binding.detail),
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
          title: binding.detail.title ?? "",
          startedAt: iso(binding.detail.time.created),
          runtimeActivity:
            active[binding.detail.id] || awaitingTurns.has(binding.detail.id) ? "running" : "idle",
          contextUsage: projectContextUsage(messages, binding.detail.revert?.messageID),
          pendingApprovals: approvals.map((request) =>
            projectApproval(request, location.project.directory),
          ),
          pendingQuestions: forms.map(projectQuestion),
          queuedMessages: inbox.flatMap((item) =>
            item.type === "user" ? [projectInboxUser(item)] : [],
          ),
        };
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
      const externalSessionId =
        event.type === "form.created"
          ? event.data.form.sessionID
          : "sessionID" in event.data
            ? event.data.sessionID
            : undefined;
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
        const plugins = await client.plugin.list(
          event.location ? { location: { directory: event.location.directory } } : {},
        );
        for (const plugin of plugins.data)
          if (plugin.state.status === "failed")
            emit({
              type: "runtime_notice",
              message: `OpenCode plugin '${plugin.id}' failed: ${plugin.state.error}`,
            });
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
          const systemPrompt =
            parent.scope.kind === "workflow"
              ? await nativeRequest(parent.ref, "read parent workflow instructions", () =>
                  readWorkflowInstructions(client, parent.ref),
                )
              : undefined;
          await nativeRequest(ref, "install child session controls", () =>
            installOpenCodePolicy({
              connection: input.connection,
              client,
              detail,
              identity: ref,
              scope: parent.scope,
              systemPrompt,
            }),
          );
          if (!isCurrent()) return;
          const childSource = await source(
            controller.admit(ref, parent.scope, detail),
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
      if (event.location && event.location.directory !== binding.ref.workingDirectory)
        throw operationError(
          binding.ref,
          "apply a native event",
          "identity_mismatch",
          "The event location does not match the verified conversation.",
        );
      if (options.logEvent) options.logEvent({ externalSessionId, relevant: true, event });
      const base = {
        externalSessionId,
        timestamp: iso("created" in event ? event.created : Date.now()),
      };
      if (event.type === "session.deleted") {
        controller.bindings.delete(externalSessionId);
        projectors.delete(externalSessionId);
        awaitingTurns.delete(externalSessionId);
        nativeRunning.delete(externalSessionId);
        sequence.delete(externalSessionId);
        emit({ type: "session_removed", externalSessionId });
        return;
      }
      if (event.type === "permission.asked") {
        const location = await client.location.get({
          location: { directory: binding.ref.workingDirectory },
        });
        emit({
          type: "session_event",
          externalSessionId,
          event: {
            ...base,
            type: "approval_required",
            ...projectApproval(event.data, location.project.directory),
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
      for (const projected of projector.apply(event)) {
        if (projected.type === "session_status" && projected.status.type !== "idle") {
          nativeRunning.add(externalSessionId);
          for (const turn of awaitingTurns.get(externalSessionId) ?? [])
            if (turn.submitted && turn.customCommand) settleTurn(turn);
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
        }
        if (projected.type === "session_error" || projected.type === "session_finished") {
          awaitingTurns.delete(externalSessionId);
          nativeRunning.delete(externalSessionId);
        }
        emit({ type: "session_event", externalSessionId, event: projected });
      }
      if (inputSettled && !nativeRunning.has(externalSessionId)) reportActivity(binding.ref);
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
          if (event.type === "mcp.status.changed") wakeMcp();
          if (event.type === "server.connected" && !initialConnected) readyResolve();
          processing = processing.then(() => handleEvent(event));
          processing.catch((cause) => {
            fail(cause);
            abort.abort();
          });
        }
        if (!abort.signal.aborted) throw new Error("The native event stream ended.");
      } catch (cause) {
        readyReject(cause);
        if (!abort.signal.aborted) fail(cause);
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
      continueInterruptedTurn: controller.continueInterruptedTurn.bind(controller),
      forkSession: async (ref) => {
        const summary = await controller.forkSession(ref);
        admittedRoots.set(summary.externalSessionId, {
          ...ref,
          externalSessionId: summary.externalSessionId,
        });
        return summary;
      },
      sendUserMessage: (messageInput, options) => {
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
                return Promise.reject(new OpenCodeMessageRejectedError(cause));
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
          return controller.sendUserMessage(messageInput, {
            signal,
            assertCommandIdle,
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
          .then((receipt) => {
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
            settleInput();
            throw cause;
          })
          .finally(clearPending);
      },
      updateSessionModel: controller.updateSessionModel.bind(controller),
      updateSessionTitle: controller.updateSessionTitle.bind(controller),
      stopSession: async (ref) => {
        const turns = [...(awaitingTurns.get(ref.externalSessionId) ?? [])].filter((turn) =>
          agentSessionRefsEqual(turn.ref, ref),
        );
        cancelPendingSends(ref);
        await controller.stopSession(ref);
        let stopped = false;
        for (const turn of turns) stopped = settleTurn(turn) || stopped;
        if (stopped) {
          nativeRunning.delete(ref.externalSessionId);
          reportActivity(ref);
        }
      },
      releaseSession: async (ref) => {
        const releasedRefs = await controller.releaseSession(ref);
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
        loadRuntimeCatalog: controller.loadRuntimeCatalog.bind(controller),
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
                sessionScope: { kind: "repository" },
              });
              admittedRoots.set(ref.externalSessionId, {
                ...ref,
                sessionScope: { kind: "repository" },
              });
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
        installedMcp.clear();
        admittedRoots.clear();
        authorizedByRepo.clear();
      },
    };
  };
