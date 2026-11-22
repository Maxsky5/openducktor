import {
  type AgentContext,
  agent,
  type ClientConnection,
  type LoadSessionRequest,
  methods,
  type NewSessionRequest,
  PROTOCOL_VERSION,
  type PromptRequest,
  type PromptResponse,
  RequestError,
  type SessionConfigOption,
  type SessionInfo,
  type SessionUpdate,
  type SetSessionConfigOptionRequest,
} from "@agentclientprotocol/sdk/unstable";
import type {
  AgentSessionLiveRef,
  AgentTextGenerationInput,
  RuntimeApprovalReplyOutcome,
} from "@openducktor/contracts";
import type { AgentModelSelection, ManagedMcpServer } from "@openducktor/core";
import { createAntigravityClientApp } from "./antigravity-acp-process";
import { AntigravityAgentConnection } from "./antigravity-agent-connection";
import type { AntigravityLiveChange } from "./antigravity-live-change";
import type { AntigravitySendInput } from "./antigravity-turn";
import { ANTIGRAVITY_CLIENT_CAPABILITIES } from "./antigravity-native-contract";
import { findListedAntigravitySession } from "./antigravity-native-sessions";
import {
  type AntigravityReattachInput,
  AntigravitySessionController,
  type AntigravitySessionControllerOptions,
  type AntigravityStartInput,
} from "./antigravity-session-controller";
import { AntigravitySessionRegistry } from "./antigravity-session-registry";
import { generateAntigravityText } from "./antigravity-text-generation";

type OpenPrompt = {
  readonly params: PromptRequest;
  readonly client: AgentContext;
  readonly respond: (response: PromptResponse | Error) => void;
};

/**
 * An in-process ACP agent that answers like Antigravity. A test drives each prompt: it sends
 * updates through `client` and answers the prompt with `respond`.
 */
export const createFakeAntigravityAgent = () => {
  const created: NewSessionRequest[] = [];
  const loaded: LoadSessionRequest[] = [];
  const closed: string[] = [];
  const cancelled: string[] = [];
  const configOptions: SetSessionConfigOptionRequest[] = [];
  const prompts: OpenPrompt[] = [];
  const sessions: SessionInfo[] = [];
  const unprompted = new Map<string, string>();
  const replays = new Map<string, SessionUpdate[]>();
  /** Config values that `session/set_config_option` refuses. */
  const refusedConfigValues = new Set(["unknown-model"]);
  /** `omitOpenConfigOptions` makes `session/new` answer without config options, as ACP allows. */
  const settings = { omitOpenConfigOptions: false };
  /** Updates that the agent sends just after it answers `session/load`, as Antigravity does. */
  const updatesAfterLoad: SessionUpdate[] = [];
  /** Updates that the agent sends before it answers each `session/set_config_option`. */
  const updatesOnConfig: SessionUpdate[] = [];
  const nativeModels = new Map<string, { model: string; thought_level: string }>();
  const configOptionsOf = (sessionId: string): SessionConfigOption[] => {
    const values = nativeModels.get(sessionId) ?? {
      model: "gemini-flash",
      thought_level: "medium",
    };
    nativeModels.set(sessionId, values);
    return (["model", "thought_level"] as const).map((id) => ({
      id,
      name: id,
      type: "select",
      currentValue: values[id],
      options: [{ value: values[id], name: values[id] }],
    }));
  };
  let nextSessionId = 1;
  let promptWaiters: Array<() => void> = [];
  const app = agent({ name: "fake-antigravity" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { list: {}, close: {} },
        _meta: { antigravity: { systemPrompt: { append: true } } },
      },
      agentInfo: { name: "Antigravity ACP Server", version: "1.5.14" },
    }))
    .onRequest(methods.agent.session.new, async ({ params, client }) => {
      created.push(params);
      const sessionId = `session-${nextSessionId++}`;
      // Antigravity lists a session only after its first prompt.
      unprompted.set(sessionId, params.cwd);
      // Antigravity can report the context use of a new session before it answers.
      await client.notify(methods.client.session.update, {
        sessionId,
        update: { sessionUpdate: "usage_update", used: 0, size: 1000 },
      });
      const configOptions = configOptionsOf(sessionId);
      return settings.omitOpenConfigOptions ? { sessionId } : { sessionId, configOptions };
    })
    .onRequest(methods.agent.session.load, async ({ params, client }) => {
      loaded.push(params);
      for (const update of replays.get(params.sessionId) ?? []) {
        await client.notify(methods.client.session.update, { sessionId: params.sessionId, update });
      }
      setTimeout(() => {
        for (const update of updatesAfterLoad) {
          void client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update,
          });
        }
      }, 5);
      return { configOptions: configOptionsOf(params.sessionId) };
    })
    .onRequest(methods.agent.session.list, () => ({ sessions }))
    .onRequest(methods.agent.session.close, ({ params }) => {
      closed.push(params.sessionId);
      return {};
    })
    .onRequest(methods.agent.session.setConfigOption, async ({ params, client }) => {
      configOptions.push(params);
      for (const update of updatesOnConfig) {
        await client.notify(methods.client.session.update, { sessionId: params.sessionId, update });
      }
      const value = String(params.value);
      if (refusedConfigValues.has(value)) {
        throw RequestError.invalidParams(undefined, `Unknown model '${value}'.`);
      }
      const values = nativeModels.get(params.sessionId);
      if (values && (params.configId === "model" || params.configId === "thought_level")) {
        values[params.configId] = value;
      }
      return { configOptions: configOptionsOf(params.sessionId) };
    })
    .onRequest(
      methods.agent.session.prompt,
      ({ params, client }) =>
        new Promise<PromptResponse>((resolve, reject) => {
          const cwd = unprompted.get(params.sessionId);
          if (cwd !== undefined) {
            unprompted.delete(params.sessionId);
            sessions.push({ sessionId: params.sessionId, cwd, title: null, updatedAt: null });
          }
          prompts.push({
            params,
            client,
            respond: (response) =>
              response instanceof Error ? reject(response) : resolve(response),
          });
          for (const wake of promptWaiters.splice(0)) wake();
        }),
    )
    .onNotification(methods.agent.session.cancel, ({ params }) => {
      cancelled.push(params.sessionId);
    });
  return {
    app,
    created,
    loaded,
    closed,
    cancelled,
    configOptions,
    refusedConfigValues,
    updatesOnConfig,
    updatesAfterLoad,
    settings,
    prompts,
    sessions,
    replays,
    /** Waits until the agent received `count` prompts. */
    waitForPrompts: async (count: number): Promise<OpenPrompt> => {
      while (prompts.length < count) {
        await new Promise<void>((resolve) => promptWaiters.push(resolve));
      }
      const prompt = prompts[count - 1];
      if (!prompt) throw new Error(`Prompt ${count} is missing.`);
      return prompt;
    },
    resetWaiters: () => {
      promptWaiters = [];
    },
  };
};

const managedMcpServer = (workspaceId: string): ManagedMcpServer => ({
  command: ["/bin/odt-mcp", "--stdio"],
  environment: { ODT_WORKSPACE_ID: workspaceId, ODT_RUNTIME_KIND: "antigravity" },
});

/**
 * The sessions of one runtime connected to an initialized fake agent, with the calls of the live
 * adapter. It records every published change.
 */
export const createConnectedController = async (
  options: Partial<Pick<AntigravitySessionControllerOptions, "stopDeadlineMs">> & {
    readonly now?: () => Date;
  } = {},
) => {
  const fake = createFakeAntigravityAgent();
  const changes: AntigravityLiveChange[] = [];
  const agentConnection = new AntigravityAgentConnection(options.now);
  const sessions = new AntigravitySessionRegistry();
  const controller = new AntigravitySessionController({
    connection: agentConnection,
    sessions,
    attachmentStageDirectory: "/tmp/openducktor-local-attachments",
    resolveWorkflowRolePolicy: ({ role }) =>
      role === "qa"
        ? { tools: ["odt_read_task"], readOnly: true }
        : { tools: ["odt_read_task", "odt_set_task_artifact"], readOnly: false },
    publish: async (change) => {
      changes.push(change);
    },
    ...(options.stopDeadlineMs !== undefined && { stopDeadlineMs: options.stopDeadlineMs }),
  });
  const connection: ClientConnection = createAntigravityClientApp(sessions.handlers).connect(
    fake.app,
  );
  await connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: ANTIGRAVITY_CLIENT_CAPABILITIES,
  });
  agentConnection.attach(connection);
  const runtime = {
    startSession: (input: Omit<AntigravityStartInput, "managedMcpServer">) =>
      controller.startSession({
        ...input,
        managedMcpServer: managedMcpServer(input.sessionScope.workspaceId),
      }),
    reattachSession: async (
      input: Omit<AntigravityReattachInput, "nativeSession" | "managedMcpServer">,
    ) =>
      controller.reattachSession({
        ...input,
        nativeSession: await findListedAntigravitySession(agentConnection, input.externalSessionId),
        managedMcpServer: managedMcpServer(input.sessionScope.workspaceId),
      }),
    loadHistory: (ref: AgentSessionLiveRef) =>
      sessions.find(ref)?.history() ?? controller.replayHistory(ref),
    sendUserMessage: (input: AgentSessionLiveRef & AntigravitySendInput) =>
      sessions.require(input).send(input),
    updateModel: (ref: AgentSessionLiveRef, model: AgentModelSelection | null) =>
      sessions.require(ref).selectModel(model),
    replyApproval: (
      input: AgentSessionLiveRef & { requestId: string; outcome: RuntimeApprovalReplyOutcome },
    ) => sessions.require(input).replyApproval(input.requestId, input.outcome),
    generateText: (input: AgentTextGenerationInput, signal: AbortSignal) =>
      generateAntigravityText(agentConnection, sessions, input, signal),
    stopSession: (ref: AgentSessionLiveRef) => controller.stopSession(ref),
    releaseSession: (ref: AgentSessionLiveRef) => controller.releaseSession(ref),
    releaseRuntime: (reason: string) => controller.releaseRuntime(reason),
    settleRuntime: (reason: string) => controller.settleRuntime(reason),
    hasRunningTurn: (sessionId: string) => sessions.hasRunningTurn(sessionId),
    listSnapshots: () => sessions.snapshots(),
    resolveCallerBinding: (callerBindingId: string) =>
      sessions.resolveCallerBinding(callerBindingId),
  };
  return { controller: runtime, fake, changes, connection };
};
