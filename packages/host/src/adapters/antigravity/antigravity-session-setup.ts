import {
  type McpServer,
  methods,
  type SessionConfigOption,
  type SessionInfo,
} from "@agentclientprotocol/sdk/unstable";
import type { AntigravitySideSession } from "./antigravity-text-generation";
import {
  ANTIGRAVITY_RUNTIME_DESCRIPTOR,
  type AgentSessionLiveRef,
  type AgentSessionScope,
  ODT_MCP_TOOL_NAMES,
} from "@openducktor/contracts";
import {
  AGENT_SESSION_SYSTEM_PROMPT_PREFIX,
  type AgentModelSelection,
  type AgentSessionHistoryMessage,
  type ManagedMcpServer,
  type WorkflowRolePolicyResolver,
} from "@openducktor/core";
import { OPENDUCKTOR_MCP_CALLER_BINDING_ID_ENV } from "../mcp/openducktor-mcp-environment";
import type {
  AntigravityLiveSession,
  AntigravityNativeModel,
  AntigravitySessionHost,
} from "./antigravity-live-session";
import { ANTIGRAVITY_PROVIDER_ID } from "./antigravity-models";
import { ANTIGRAVITY_MANAGED_MCP_SERVER_NAME } from "./antigravity-native-payloads";
import type { AntigravityTranscript } from "./antigravity-transcript";

/** The model selection that a session keeps, with the provider of every Antigravity model. */
export const toAntigravityModelSelection = (
  model: AgentModelSelection | undefined,
): AgentModelSelection | undefined => {
  if (!model) return undefined;
  const selection: AgentModelSelection = {
    runtimeKind: "antigravity",
    providerId: ANTIGRAVITY_PROVIDER_ID,
    modelId: model.modelId,
  };
  if (model.variant) selection.variant = model.variant;
  return selection;
};

/**
 * The managed OpenDucktor MCP server of one session activation. It binds the workspace of the
 * session, allows only the tools of its role, and names the caller binding of the activation.
 */
export const antigravityManagedMcpServer = async (
  {
    resolveManagedMcpServer,
    resolveWorkflowRolePolicy,
  }: {
    resolveManagedMcpServer: (repoPath: string, workspaceId: string) => Promise<ManagedMcpServer>;
    resolveWorkflowRolePolicy: WorkflowRolePolicyResolver;
  },
  repoPath: string,
  sessionScope: AgentSessionScope,
  callerBindingId: string,
): Promise<McpServer> => {
  const server = await resolveManagedMcpServer(repoPath, sessionScope.workspaceId);
  const tools =
    sessionScope.kind === "workflow"
      ? resolveWorkflowRolePolicy(sessionScope).tools
      : ODT_MCP_TOOL_NAMES;
  const env = {
    ...server.environment,
    ODT_ALLOWED_TOOLS: tools.join(","),
    [OPENDUCKTOR_MCP_CALLER_BINDING_ID_ENV]: callerBindingId,
  };
  const [command, ...args] = server.command;
  return {
    name: ANTIGRAVITY_MANAGED_MCP_SERVER_NAME,
    command,
    args,
    env: Object.entries(env).map(([name, value]) => ({ name, value })),
  };
};

/** Reads the current `model` and `thought_level` values from native config options. */
export const readAntigravityNativeModel = (
  configOptions: readonly SessionConfigOption[] | null | undefined,
): AntigravityNativeModel => {
  const currentValue = (configId: string): string | undefined => {
    const option = configOptions?.find((candidate) => candidate.id === configId);
    return option?.type === "select" ? option.currentValue : undefined;
  };
  return { model: currentValue("model"), thoughtLevel: currentValue("thought_level") };
};

const setAntigravityConfigOption = async (
  host: AntigravitySessionHost,
  session: AntigravityLiveSession,
  configId: "model" | "thought_level",
  value: string,
): Promise<void> => {
  const agent = host.agent();
  const response = await host.request(() =>
    agent.request(methods.agent.session.setConfigOption, {
      sessionId: session.ref.externalSessionId,
      configId,
      value,
    }),
  );
  session.nativeModel = readAntigravityNativeModel(response.configOptions);
};

const setAntigravityNativeModel = async (
  host: AntigravitySessionHost,
  session: AntigravityLiveSession,
  target: AntigravityNativeModel,
): Promise<void> => {
  if (target.model) await setAntigravityConfigOption(host, session, "model", target.model);
  if (target.thoughtLevel) {
    await setAntigravityConfigOption(host, session, "thought_level", target.thoughtLevel);
  }
};

const sameNativeModel = (left: AntigravityNativeModel, right: AntigravityNativeModel) =>
  left.model === right.model && left.thoughtLevel === right.thoughtLevel;

/**
 * Sets earlier native values again and checks that Antigravity reports them. When it cannot, the
 * session refuses messages until a model change succeeds, so no turn runs on a model that the user
 * did not select. Missing earlier values cannot be restored, so they fail the check.
 */
const restoreAntigravityNativeModel = async (
  host: AntigravitySessionHost,
  session: AntigravityLiveSession,
  target: AntigravityNativeModel,
): Promise<void> => {
  try {
    await setAntigravityNativeModel(host, session, target);
    if (!target.model || !sameNativeModel(session.nativeModel, target)) {
      throw new Error("Antigravity did not report the earlier model values after the restore.");
    }
  } catch (cause) {
    session.modelMismatch = `Antigravity runs model '${session.nativeModel.model ?? "unknown"}', not the selected model of this session. Select the model again, then send the message.`;
    throw new Error(`Antigravity did not restore the earlier model. ${session.modelMismatch}`, {
      cause,
    });
  }
};

/**
 * Sets the model, then the thinking level when the selection has one. `null` restores the native
 * values that the session had when it opened. When a write fails after an earlier write of the
 * change, the earlier native values are restored.
 */
export const applyAntigravityModel = async (
  host: AntigravitySessionHost,
  session: AntigravityLiveSession,
  model: AgentModelSelection | null,
): Promise<void> => {
  const previous = session.nativeModel;
  if (!model) {
    if (!sameNativeModel(previous, session.openedNativeModel)) {
      await restoreAntigravityNativeModel(host, session, session.openedNativeModel);
    }
    session.modelMismatch = null;
    return;
  }
  try {
    await setAntigravityNativeModel(host, session, {
      model: model.modelId,
      thoughtLevel: model.variant,
    });
  } catch (cause) {
    if (!sameNativeModel(session.nativeModel, previous)) {
      await restoreAntigravityNativeModel(host, session, previous);
    }
    throw cause;
  }
  session.modelMismatch = null;
};

/** Lists every native session. */
export const listAntigravitySessions = async (
  host: AntigravitySessionHost,
): Promise<SessionInfo[]> => {
  const agent = host.agent();
  const sessions: SessionInfo[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await host.request(() =>
      agent.request(methods.agent.session.list, cursor === undefined ? {} : { cursor }),
    );
    sessions.push(...page.sessions);
    cursor = page.nextCursor ?? undefined;
    if (cursor !== undefined && cursors.has(cursor)) {
      throw new Error(
        `Antigravity repeated a session page. ${ANTIGRAVITY_RUNTIME_DESCRIPTOR.updateAction}`,
      );
    }
    if (cursor !== undefined) cursors.add(cursor);
  } while (cursor !== undefined);
  return sessions;
};

/** Requires the exact native session in the saved directory. */
export const requireAntigravityNativeSession = async (
  host: AntigravitySessionHost,
  ref: AgentSessionLiveRef,
  directoriesMatch: (left: string, right: string) => Promise<boolean>,
): Promise<SessionInfo> => {
  const sessions = await listAntigravitySessions(host);
  const entry = sessions.find((candidate) => candidate.sessionId === ref.externalSessionId);
  if (!entry) {
    throw new Error(
      `Antigravity has no session '${ref.externalSessionId}'. OpenDucktor does not start a replacement session.`,
    );
  }
  if (!(await directoriesMatch(entry.cwd, ref.workingDirectory))) {
    throw new Error(
      `Antigravity session '${ref.externalSessionId}' belongs to '${entry.cwd}', not '${ref.workingDirectory}'.`,
    );
  }
  return entry;
};

/**
 * Replays a session that this runtime does not hold, with no MCP servers and no instructions, and
 * closes it again. The replay updates go to `transcript` through `sideSessions`.
 */
export const replayAntigravitySession = async (
  host: AntigravitySessionHost,
  ref: AgentSessionLiveRef,
  transcript: AntigravityTranscript,
  sideSessions: Map<string, AntigravitySideSession>,
): Promise<void> => {
  const agent = host.agent();
  sideSessions.set(ref.externalSessionId, {
    applyUpdate: (update) => void transcript.applyUpdate(update, "replay"),
    refuse: () => undefined,
  });
  try {
    await host.request(() =>
      agent.request(methods.agent.session.load, {
        sessionId: ref.externalSessionId,
        cwd: ref.workingDirectory,
        mcpServers: [],
      }),
    );
    transcript.finishReplay();
  } finally {
    sideSessions.delete(ref.externalSessionId);
  }
  await host.request(() =>
    agent.request(methods.agent.session.close, { sessionId: ref.externalSessionId }),
  );
};

/** Shows the initial system instructions once, before the first user message. */
export const withAntigravitySystemPrompt = (
  sessionId: string,
  systemPrompt: string,
  startedAt: string,
  history: readonly AgentSessionHistoryMessage[],
): AgentSessionHistoryMessage[] => {
  const copy = structuredClone([...history]);
  const text = systemPrompt.trim();
  if (!text) return copy;
  return [
    {
      messageId: `antigravity-system-prompt:${sessionId}`,
      role: "system",
      timestamp: startedAt,
      text: `${AGENT_SESSION_SYSTEM_PROMPT_PREFIX}${text}`,
      parts: [],
    },
    ...copy,
  ];
};
