import { detectAgentFileReferenceKind } from "./file-reference-utils";
import { OpenCodeMessageRejectedError } from "./opencode-message-rejected-error";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { OpenCodeClient, SessionInfo, ModelRef } from "@opencode/client";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  isManualSessionCompactionSlashCommand,
  type AgentSessionScope,
  type AgentSessionControlUpdateTitleInput,
} from "@openducktor/contracts";
import {
  agentSessionRefsEqual,
  agentSessionScopesEqual,
  assertAgentRuntimePolicyBinding,
  type StartAgentSessionInput,
  type ResumeAgentSessionInput,
  type ForkAgentSessionInput,
  type SendAgentUserMessageInput,
  type AcceptedAgentInput,
  type UpdateAgentSessionModelInput,
  type SessionRef,
  type AgentSessionSummary,
  type LoadAgentSessionHistoryInput,
  type LoadAgentSessionTodosInput,
  type LoadAgentRuntimeCatalogInput,
  type SearchAgentFilesInput,
  type LoadAgentSessionDiffInput,
  type LoadAgentFileStatusInput,
  type AgentSessionTitleUpdateResult,
  type ContinueInterruptedAgentTurnInput,
  type AgentModelSelection,
} from "@openducktor/core";
import {
  createOpenCodeClient,
  nativeRequest,
  operationError,
  readMigration,
  verifySession,
  type OpenCodeRequestDraft,
} from "./opencode-client";
import {
  compilePermissionRule,
  compileCreationSettings,
  forkNativePermissions,
  installOpenCodePolicy,
} from "./opencode-permissions";
import { resolveOpencodeSessionPolicy } from "./opencode-session-policy";
import { buildOpenCodePromptText } from "./opencode-user-message-encoding";
import { iso, projectInboxUser, projectMessages } from "./opencode-message-projection";
import { readOpenCodeTranscript } from "./opencode-session-transcript";
import { readCatalog } from "./opencode-catalog";
import type {
  OpenCodeRuntimeConnection,
  OpencodeSdkAdapterOptions,
  ReadOpencodeDirectory,
} from "./types";

export type OpenCodeSessionBinding = {
  ref: SessionRef;
  scope: AgentSessionScope;
  detail: SessionInfo;
};
export type OpenCodeControlHooks = {
  readDirectory: ReadOpencodeDirectory;
  ensureMcp: (ref: { repoPath: string; workingDirectory: string }) => Promise<void>;
  admitted: (binding: OpenCodeSessionBinding) => void;
};

const nativeModelSelection = (model: AgentModelSelection): ModelRef => {
  if (model.speed !== undefined)
    throw new Error(`OpenCode does not support speed '${model.speed}'. Select standard speed.`);
  const native: ModelRef = { providerID: model.providerId, id: model.modelId };
  if (model.variant) native.variant = model.variant;
  return native;
};

const newSessionIdSchema = z.object({ id: z.string().startsWith("ses") });

/** One controller for an owned authenticated V2 runtime. */
export class OpencodeSdkAdapter {
  readonly client: OpenCodeClient;
  private readonly generations = new Map<string, number>();
  private closed = false;
  private readonly abort = new AbortController();
  readonly bindings = new Map<string, OpenCodeSessionBinding>();
  constructor(
    readonly connection: OpenCodeRuntimeConnection,
    readonly options: OpencodeSdkAdapterOptions,
    readonly hooks: OpenCodeControlHooks,
  ) {
    this.client = (options.createClient ?? createOpenCodeClient)(connection, this.abort.signal);
  }

  generation(sessionID: string) {
    return this.generations.get(sessionID) ?? 0;
  }
  private assertCurrent(ref: SessionRef, generation: number) {
    if (this.closed || this.generation(ref.externalSessionId) !== generation)
      throw operationError(
        ref,
        "submit prepared input",
        "runtime_unavailable",
        "The conversation stopped or was released while input was prepared. The prepared input was not submitted.",
        "Review the retained draft, reopen the intended conversation, and send it explicitly.",
      );
  }
  close() {
    this.closed = true;
    this.abort.abort();
    this.bindings.clear();
  }

  getRuntimeDefinition() {
    return OPENCODE_RUNTIME_DESCRIPTOR;
  }

  /** Query and import inspection callers hold the host guard. Control and live reads use readSession. */
  async readNativeSession(input: SessionRef, operation: string): Promise<SessionInfo> {
    if (input.runtimeKind !== "opencode")
      throw operationError(
        input,
        operation,
        "identity_mismatch",
        "The selected conversation uses a different runtime.",
      );
    return nativeRequest(input, operation, async () => {
      await readMigration(this.client, input, operation);
      return verifySession(
        await this.client.session.get({ sessionID: input.externalSessionId }),
        input,
      );
    });
  }

  async readSession(input: SessionRef, operation: string): Promise<SessionInfo> {
    return nativeRequest(input, operation, async () => {
      const detail = await this.hooks.readDirectory(input.workingDirectory, async () =>
        this.readNativeSession(input, operation),
      );
      if (!detail)
        throw operationError(
          input,
          operation,
          "runtime_unavailable",
          "The linked working directory is unavailable.",
          "Restore the linked worktree or directory, then retry. The saved link is unchanged.",
        );
      return detail;
    });
  }

  summary(binding: OpenCodeSessionBinding, running = false): AgentSessionSummary {
    const summary: AgentSessionSummary = {
      externalSessionId: binding.detail.id,
      runtimeKind: "opencode",
      workingDirectory: binding.detail.location.directory,
      sessionAssociation: binding.scope,
      startedAt: iso(binding.detail.time.created),
      status: running ? "running" : "idle",
    };
    if (binding.detail.title) summary.title = binding.detail.title;
    return summary;
  }

  admit(ref: SessionRef, scope: AgentSessionScope, detail: SessionInfo): OpenCodeSessionBinding {
    const previous = this.bindings.get(detail.id);
    if (
      previous &&
      (previous.ref.repoPath !== ref.repoPath ||
        previous.ref.workingDirectory !== ref.workingDirectory ||
        !agentSessionScopesEqual(previous.scope, scope))
    )
      throw operationError(
        ref,
        "attach the conversation",
        "identity_mismatch",
        "The conversation already has a different OpenDucktor association.",
      );
    const binding = { ref, scope, detail };
    this.bindings.set(detail.id, binding);
    this.hooks.admitted(binding);
    return binding;
  }

  private async readBinding(
    input: ResumeAgentSessionInput | SendAgentUserMessageInput,
    generation: number,
  ): Promise<SessionInfo> {
    assertAgentRuntimePolicyBinding(input, "bind the OpenCode conversation");
    const previous = this.bindings.get(input.externalSessionId);
    if (
      previous &&
      (previous.ref.repoPath !== input.repoPath ||
        previous.ref.workingDirectory !== input.workingDirectory ||
        !agentSessionScopesEqual(previous.scope, input.sessionScope))
    )
      throw operationError(
        input,
        "attach the conversation",
        "identity_mismatch",
        "The conversation already has a different OpenDucktor association.",
      );
    const detail = await this.readSession(input, "attach the conversation");
    this.assertCurrent(input, generation);
    return detail;
  }

  async bind(
    input: ResumeAgentSessionInput | SendAgentUserMessageInput,
    generation = this.generation(input.externalSessionId),
  ): Promise<OpenCodeSessionBinding> {
    const detail = await this.readBinding(input, generation);
    await nativeRequest(input, "install session controls", async () => {
      await this.hooks.ensureMcp(input);
      this.assertCurrent(input, generation);
      await installOpenCodePolicy({
        connection: this.connection,
        client: this.client,
        detail,
        identity: input,
        scope: input.sessionScope,
        systemPrompt: input.systemPrompt,
      });
    });
    this.assertCurrent(input, generation);
    return this.admit(input, input.sessionScope, detail);
  }

  async startSession(input: StartAgentSessionInput): Promise<AgentSessionSummary> {
    assertAgentRuntimePolicyBinding(input, "start the OpenCode conversation");
    return nativeRequest(input, "start the conversation", async () => {
      await readMigration(this.client, input, "start the conversation");
      const settings = await compileCreationSettings(
        this.client,
        input,
        await this.options.resolveCreationSettings(input.sessionScope),
      );
      await this.hooks.ensureMcp(input);
      const policy = resolveOpencodeSessionPolicy(
        input.sessionScope,
        OPENCODE_RUNTIME_DESCRIPTOR,
        "start the conversation",
      );
      const request: OpenCodeRequestDraft<Parameters<OpenCodeClient["session"]["create"]>[0]> = {
        location: { directory: input.workingDirectory },
        permissions: policy.permission.map(compilePermissionRule),
      };
      if (policy.title) request.title = policy.title;
      if (input.model) {
        request.model = nativeModelSelection(input.model);
        if (input.model.profileId) request.agent = input.model.profileId;
      }
      const detail = await this.client.session.create(request);
      const sessionID = newSessionIdSchema.parse(detail).id;
      const ref: SessionRef = {
        repoPath: input.repoPath,
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: sessionID,
      };
      try {
        verifySession(detail, input);
        await installOpenCodePolicy({
          connection: this.connection,
          client: this.client,
          detail,
          identity: ref,
          scope: input.sessionScope,
          systemPrompt: input.systemPrompt,
          creationSettings: settings,
          native: [],
        });
        return this.summary(
          this.admit(
            ref,
            input.sessionScope,
            await this.readSession(ref, "confirm the new conversation"),
          ),
        );
      } catch (cause) {
        return this.cleanupNewSession(sessionID, cause);
      }
    });
  }

  async cleanupNewSession(sessionID: string, cause: unknown): Promise<never> {
    try {
      await this.client.session.remove({ sessionID });
    } catch (cleanup) {
      throw new AggregateError(
        [cause, cleanup],
        `OpenCode conversation '${sessionID}' failed setup and cleanup. Remove the unused conversation in OpenCode before retrying. ${String(cause)}; ${String(cleanup)}`,
      );
    }
    throw cause;
  }

  async resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionSummary> {
    const binding = await this.bind(input);
    const active = await nativeRequest(input, "read session activity", () =>
      this.client.session.active(),
    );
    return this.summary(binding, Boolean(active[binding.detail.id]));
  }

  async continueInterruptedTurn(
    input: ContinueInterruptedAgentTurnInput,
  ): Promise<AgentSessionSummary> {
    throw operationError(
      input,
      "continue an interrupted turn",
      "unsupported_operation",
      "OpenCode V2 has no equivalent continuation operation.",
      "Send an explicit new message in the existing conversation.",
    );
  }

  async forkSession(input: ForkAgentSessionInput): Promise<AgentSessionSummary> {
    assertAgentRuntimePolicyBinding(input, "fork the OpenCode conversation");
    const sourceRef: SessionRef = { ...input, externalSessionId: input.parentExternalSessionId };
    return nativeRequest(sourceRef, "fork the conversation", async () => {
      const source = await this.readSession(sourceRef, "verify the fork source");
      const native = forkNativePermissions(source, sourceRef);
      const settings = await compileCreationSettings(
        this.client,
        input,
        await this.options.resolveCreationSettings(input.sessionScope),
      );
      await this.hooks.ensureMcp(input);
      const request: OpenCodeRequestDraft<Parameters<OpenCodeClient["session"]["fork"]>[0]> = {
        sessionID: source.id,
      };
      if (input.runtimeHistoryAnchor) request.before = input.runtimeHistoryAnchor;
      const detail = await this.client.session.fork(request);
      const sessionID = newSessionIdSchema.parse(detail).id;
      if (sessionID === source.id)
        throw operationError(
          sourceRef,
          "fork the conversation",
          "identity_mismatch",
          "The native fork did not return a distinct conversation with the requested source.",
        );
      const ref: SessionRef = { ...sourceRef, externalSessionId: sessionID };
      try {
        verifySession(detail, input);
        if (detail.fork?.sessionID !== source.id)
          throw operationError(
            sourceRef,
            "fork the conversation",
            "identity_mismatch",
            "The native fork did not return the requested source conversation.",
          );
        await installOpenCodePolicy({
          connection: this.connection,
          client: this.client,
          detail,
          identity: ref,
          scope: input.sessionScope,
          systemPrompt: input.systemPrompt,
          creationSettings: settings,
          native,
        });
        const title = resolveOpencodeSessionPolicy(
          input.sessionScope,
          OPENCODE_RUNTIME_DESCRIPTOR,
          "fork the conversation",
        ).title;
        if (title) await this.client.session.update({ sessionID: detail.id, title });
        if (input.model) await this.updateNativeModel(ref, input.model);
        return this.summary(
          this.admit(ref, input.sessionScope, await this.readSession(ref, "confirm the fork")),
        );
      } catch (cause) {
        return this.cleanupNewSession(sessionID, cause);
      }
    });
  }

  async sendUserMessage(
    input: SendAgentUserMessageInput,
    options?: { signal?: AbortSignal; onSent?: () => void; assertCommandIdle?: () => void },
  ): Promise<AcceptedAgentInput> {
    let submitted = false;
    const onSent = () => {
      submitted = true;
      options?.onSent?.();
    };
    const generation = this.generation(input.externalSessionId);
    return nativeRequest<AcceptedAgentInput>(input, "send input", async () => {
      options?.signal?.throwIfAborted();
      const commands = input.parts.filter((part) => part.kind === "slash_command");
      if (commands.length > 1) throw new Error("Use one slash command per submission.");
      if (commands[0] && isManualSessionCompactionSlashCommand(commands[0].command)) {
        if (
          input.parts.some(
            (part) => part.kind !== "slash_command" && (part.kind !== "text" || part.text.trim()),
          )
        )
          throw new Error("Submit /compact without other input.");
        const detail = await this.readBinding(input, generation);
        this.admit(input, input.sessionScope, detail);
        if (input.model) await this.updateNativeModel(input, input.model);
        this.assertCurrent(input, generation);
        options?.signal?.throwIfAborted();
        const sending = this.client.session.compact({ sessionID: input.externalSessionId });
        onSent();
        const item = z
          .object({
            id: z.string().min(1),
            sessionID: z.string().min(1),
            type: z.literal("compaction"),
          })
          .parse(await sending);
        if (item.sessionID !== input.externalSessionId)
          throw operationError(
            input,
            "accept compaction",
            "identity_mismatch",
            "OpenCode accepted compaction for a different conversation.",
          );
        return { type: "command_accepted", commandName: "compact", inputId: item.id };
      }
      const subagents = input.parts.filter((part) => part.kind === "subagent_reference");
      if (input.sessionScope.kind === "workflow" && subagents.length)
        throw operationError(
          input,
          "send input",
          "unsupported_operation",
          "OpenDucktor workflow sessions do not allow subagent references.",
          "Open a repository conversation for subagents.",
        );
      await this.bind(input, generation);
      if (input.model) await this.updateNativeModel(input, input.model);
      const encoded = buildOpenCodePromptText(
        input.parts.filter((part) => part.kind !== "slash_command"),
      );
      const files = [
        ...encoded.fileReferences.map((reference) => ({
          uri: pathToFileURL(resolve(input.workingDirectory, reference.file.path)).href,
          name: reference.file.name,
          mention: {
            start: reference.sourceText.start,
            end: reference.sourceText.end,
            text: reference.sourceText.value,
          },
        })),
        ...input.parts.flatMap((part) =>
          part.kind === "attachment"
            ? [
                {
                  uri: pathToFileURL(resolve(input.workingDirectory, part.attachment.path)).href,
                  name: part.attachment.name,
                },
              ]
            : [],
        ),
      ];
      const payload: OpenCodeRequestDraft<Parameters<OpenCodeClient["session"]["prompt"]>[0]> = {
        sessionID: input.externalSessionId,
        text: encoded.text,
      };
      if (files.length) payload.files = files;
      if (encoded.subagentReferences.length)
        payload.agents = encoded.subagentReferences.map((reference) => ({
          name: reference.subagent.name,
          mention: {
            start: reference.sourceText.start,
            end: reference.sourceText.end,
            text: reference.sourceText.value,
          },
        }));
      if (encoded.skillReferences.length)
        payload.skills = encoded.skillReferences.map((reference) => ({
          id: reference.skill.id,
          mention: {
            start: reference.sourceText.start,
            end: reference.sourceText.end,
            text: reference.sourceText.value,
          },
        }));
      if (commands[0]) {
        this.assertCurrent(input, generation);
        options?.signal?.throwIfAborted();
        options?.assertCommandIdle?.();
        const sending = this.client.session.command({
          ...payload,
          name: commands[0].command.trigger,
        });
        onSent();
        await sending;
        return { type: "command_accepted", commandName: commands[0].command.trigger };
      }
      if (!payload.text.trim() && !files.length)
        throw new Error("Enter a message or attach a file.");
      this.assertCurrent(input, generation);
      options?.signal?.throwIfAborted();
      const sending = this.client.session.prompt(payload);
      onSent();
      const item = await sending;
      if (item.sessionID !== input.externalSessionId)
        throw operationError(
          input,
          "accept input",
          "identity_mismatch",
          "OpenCode accepted the input for a different conversation.",
        );
      return projectInboxUser(item);
    }).catch((cause: Error) => {
      if (!submitted) throw new OpenCodeMessageRejectedError(cause);
      throw cause;
    });
  }

  async updateNativeModel(
    ref: SessionRef,
    model: NonNullable<UpdateAgentSessionModelInput["model"]>,
  ): Promise<void> {
    const request: Parameters<OpenCodeClient["session"]["switchModel"]>[0] = {
      sessionID: ref.externalSessionId,
      model: nativeModelSelection(model),
    };
    await this.client.session.switchModel(request);
    if (model.profileId)
      await this.client.session.switchAgent({
        sessionID: ref.externalSessionId,
        agent: model.profileId,
      });
  }

  async updateSessionModel(input: UpdateAgentSessionModelInput): Promise<void> {
    await this.readSession(input, "change the selected model");
    if (!input.model)
      throw operationError(
        input,
        "clear the selected model",
        "unsupported_operation",
        "OpenCode V2 requires an explicit model.",
        "Select a model from the runtime catalog.",
      );
    await nativeRequest(input, "change the selected model", () =>
      this.updateNativeModel(input, input.model!),
    );
  }

  async updateSessionTitle(
    input: AgentSessionControlUpdateTitleInput,
  ): Promise<AgentSessionTitleUpdateResult> {
    const binding = this.bindings.get(input.externalSessionId);
    if (!binding) return { status: "not_attached" };
    await this.readSession(input, "rename the conversation");
    await nativeRequest(input, "rename the conversation", () =>
      this.client.session.update({ sessionID: input.externalSessionId, title: input.title }),
    );
    binding.detail = { ...binding.detail, title: input.title };
    return { status: "renamed", summary: this.summary(binding) };
  }

  async stopSession(input: SessionRef): Promise<void> {
    this.generations.set(input.externalSessionId, this.generation(input.externalSessionId) + 1);
    await this.readSession(input, "interrupt the conversation");
    await nativeRequest(input, "interrupt the conversation", async () => {
      await this.client.session.interrupt({ sessionID: input.externalSessionId });
    });
  }
  async releaseSession(input: SessionRef): Promise<SessionRef[]> {
    const binding = this.bindings.get(input.externalSessionId);
    if (binding && !agentSessionRefsEqual(binding.ref, input))
      throw operationError(
        input,
        "release the conversation",
        "identity_mismatch",
        "The attached conversation has another directory.",
      );
    const refs = [input];
    const seen = new Set([input.externalSessionId]);
    for (const parent of refs)
      for (const child of this.bindings.values())
        if (
          child.detail.parentID === parent.externalSessionId &&
          child.ref.repoPath === input.repoPath &&
          child.ref.workingDirectory === input.workingDirectory &&
          child.ref.runtimeKind === input.runtimeKind &&
          !seen.has(child.detail.id)
        ) {
          seen.add(child.detail.id);
          refs.push(child.ref);
        }
    for (const ref of refs) {
      this.generations.set(ref.externalSessionId, this.generation(ref.externalSessionId) + 1);
      this.bindings.delete(ref.externalSessionId);
    }
    return refs;
  }
  async loadSessionHistory(input: LoadAgentSessionHistoryInput) {
    const detail = await this.readNativeSession(input, "read history");
    return nativeRequest(input, "read history", async () => {
      const history = projectMessages(await readOpenCodeTranscript(this.client, detail));
      if (detail.fork)
        history.unshift({
          role: "system",
          messageId: `${detail.id}:fork`,
          timestamp: iso(detail.time.created),
          text: `Forked from conversation '${detail.fork.sessionID}'.`,
          notice: {
            tone: "info",
            reason: "session_forked",
            title: "Conversation forked",
            parentExternalSessionId: detail.fork.sessionID,
          },
          parts: [],
        });
      return history;
    });
  }
  async loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<never> {
    throw operationError(
      input,
      "read native todos",
      "unsupported_operation",
      "OpenCode V2 has no native session todo API.",
      "Use the retained conversation and OpenDucktor task data.",
    );
  }
  async resolveSessionParent(input: SessionRef): Promise<string | null> {
    return (await this.readNativeSession(input, "read the parent conversation")).parentID ?? null;
  }
  async loadRuntimeCatalog(input: LoadAgentRuntimeCatalogInput) {
    return readCatalog(this.client, input.workingDirectory);
  }
  async searchFiles(input: SearchAgentFilesInput) {
    return nativeRequest(input, "search files", async () =>
      (
        await this.client.file.find({
          location: { directory: input.workingDirectory },
          query: input.query,
          limit: 100,
        })
      ).data.map((file) => ({
        id: file.path,
        name: basename(file.path),
        path: file.path,
        kind:
          file.type === "directory"
            ? ("directory" as const)
            : detectAgentFileReferenceKind({ filePath: file.path }),
      })),
    );
  }
  async loadSessionDiff(input: LoadAgentSessionDiffInput) {
    await this.readNativeSession(input, "read session diff");
    const request: OpenCodeRequestDraft<Parameters<OpenCodeClient["session"]["diff"]>[0]> = {
      sessionID: input.externalSessionId,
    };
    if (input.runtimeHistoryAnchor) request.to = input.runtimeHistoryAnchor;
    return nativeRequest(input, "read session diff", async () =>
      (await this.client.session.diff(request)).map((diff) => ({
        file: diff.file,
        type: diff.status,
        additions: diff.additions,
        deletions: diff.deletions,
        diff: diff.patch,
      })),
    );
  }
  async loadFileStatus(input: LoadAgentFileStatusInput) {
    return nativeRequest(input, "read file status", async () =>
      (await this.client.vcs.status({ location: { directory: input.workingDirectory } })).data.map(
        (file) => ({ path: file.file, status: file.status, staged: false }),
      ),
    );
  }
}
