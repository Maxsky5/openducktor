import { type McpServer, methods, type SessionInfo } from "@agentclientprotocol/sdk/unstable";
import {
  ANTIGRAVITY_RUNTIME_DESCRIPTOR,
  type AgentSessionLiveRef,
  type AgentSessionScope,
  ODT_MCP_TOOL_NAMES,
} from "@openducktor/contracts";
import type { ManagedMcpServer, WorkflowRolePolicyResolver } from "@openducktor/core";
import { OPENDUCKTOR_MCP_CALLER_BINDING_ID_ENV } from "../mcp/openducktor-mcp-environment";
import type { AntigravityAgentConnection } from "./antigravity-agent-connection";
import { ANTIGRAVITY_MANAGED_MCP_SERVER_NAME } from "./antigravity-native-payloads";
import type { AntigravitySessionRegistry } from "./antigravity-session-registry";
import type { AntigravityTranscript } from "./antigravity-transcript";

/**
 * The managed OpenDucktor MCP server of one session activation. It binds the workspace of the
 * session, allows only the tools of its role, and names the caller binding of the activation.
 */
export const antigravityManagedMcpServer = (
  server: ManagedMcpServer,
  sessionScope: AgentSessionScope,
  resolveWorkflowRolePolicy: WorkflowRolePolicyResolver,
  callerBindingId: string,
): McpServer => {
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

/** Lists every native session. */
export const listAntigravitySessions = async (
  connection: AntigravityAgentConnection,
): Promise<SessionInfo[]> => {
  const agent = connection.agent();
  const sessions: SessionInfo[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await connection.request(() =>
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

/**
 * The listed entry of a native session, or null. Antigravity lists only sessions with at least one
 * step, so a session that got no message is not listed, but `session/load` still opens it.
 */
export const findListedAntigravitySession = async (
  connection: AntigravityAgentConnection,
  externalSessionId: string,
): Promise<SessionInfo | null> =>
  (await listAntigravitySessions(connection)).find(
    (candidate) => candidate.sessionId === externalSessionId,
  ) ?? null;

/**
 * Replays a session that this runtime does not hold, with no MCP servers and no instructions, and
 * closes it again. The replay updates go to `transcript`.
 */
export const replayAntigravitySession = async (
  connection: AntigravityAgentConnection,
  sessions: AntigravitySessionRegistry,
  ref: AgentSessionLiveRef,
  transcript: AntigravityTranscript,
): Promise<void> => {
  const agent = connection.agent();
  await sessions.withSideSession(
    ref.externalSessionId,
    {
      applyUpdate: (update) => void transcript.applyUpdate(update, "replay"),
      refuse: () => undefined,
    },
    async () => {
      await connection.request(() =>
        agent.request(methods.agent.session.load, {
          sessionId: ref.externalSessionId,
          cwd: ref.workingDirectory,
          mcpServers: [],
        }),
      );
      transcript.finishReplay();
    },
  );
  await connection.request(() =>
    agent.request(methods.agent.session.close, { sessionId: ref.externalSessionId }),
  );
};
