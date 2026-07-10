import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig, Options } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { AGENT_ROLE_TOOL_POLICY } from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import {
  buildOpenDucktorMcpBridgeEnvironment,
  type OpenDucktorMcpBridgeConnection,
} from "../mcp/openducktor-mcp-environment";
import { createClaudeCanUseTool } from "./claude-agent-sdk-permissions";
import {
  CLAUDE_ASK_USER_QUESTION_DIALOG_KINDS,
  createClaudeUserDialogHandler,
} from "./claude-agent-sdk-questions";
import type { ClaudeTranscriptMirrorStore } from "./claude-agent-sdk-transcript-mirror-store";
import type {
  ClaudeAgentSdkEventEmitter,
  ClaudeSessionContext,
  ClaudeSessionInput,
  CreateClaudeAgentSdkServiceInput,
} from "./claude-agent-sdk-types";
import { claudeWorkflowRole, isReadOnlyWorkflowRole } from "./claude-agent-sdk-utils";

export type ClaudeAgentSdkOptionsDependencies = {
  claudeExecutablePath: string;
  mcpBridgeConnection: OpenDucktorMcpBridgeConnection;
  mcpCommand: string[];
};

type BuildClaudeAgentSdkOptionsInput = {
  input: ClaudeSessionInput;
  session: ClaudeSessionContext;
  sessionOptions: Partial<Options>;
  serviceInput: CreateClaudeAgentSdkServiceInput;
  transcriptStore?: ClaudeTranscriptMirrorStore | undefined;
  now: () => string;
  randomId: () => string;
  emit: ClaudeAgentSdkEventEmitter;
  resolvedDependencies: ClaudeAgentSdkOptionsDependencies;
};

const CLAUDE_OPENDUCKTOR_MCP_TOKEN_FILE_ENV = "ODT_HOST_TOKEN_FILE";
const buildClaudeOpenDucktorRuntimePrompt = (workingDirectory: string): string =>
  `OpenDucktor starts this Claude Code session with cwd set to ${workingDirectory}. Use relative paths and do not prefix Bash commands with cd ${workingDirectory}; only change directories when that is the actual task.`;

const allowedClaudeWorkflowTools = (role: ReturnType<typeof claudeWorkflowRole>): string[] => {
  if (!role) {
    return [];
  }
  return AGENT_ROLE_TOOL_POLICY[role].flatMap(
    (toolName) => CLAUDE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical[toolName] ?? [],
  );
};

export const buildClaudeAgentSdkBaseOptions = ({
  claudeExecutablePath,
  cwd,
  processEnv,
}: {
  claudeExecutablePath: string;
  cwd: string;
  processEnv?: NodeJS.ProcessEnv | undefined;
}): Options => {
  const options: Options = {
    cwd,
    env: {
      ...processEnv,
      CLAUDE_AGENT_SDK_CLIENT_APP: "openducktor",
    },
    skills: "all",
    tools: { type: "preset", preset: "claude_code" },
  };
  applyClaudeCodeExecutablePath(options, claudeExecutablePath);
  return options;
};

export const buildClaudeAgentSdkOptions = async ({
  emit,
  input,
  now,
  randomId,
  resolvedDependencies,
  serviceInput,
  session,
  sessionOptions,
  transcriptStore,
}: BuildClaudeAgentSdkOptionsInput): Promise<Options> => {
  const mcpServers = await buildClaudeMcpServers({
    resolvedDependencies,
    session,
  });
  const model = input.model;
  const workflowRole = claudeWorkflowRole(input);
  const readOnlyWorkflowRole = isReadOnlyWorkflowRole(workflowRole);
  const systemPrompt = [
    "systemPrompt" in input && input.systemPrompt ? input.systemPrompt : null,
    buildClaudeOpenDucktorRuntimePrompt(input.workingDirectory),
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join("\n\n");
  const options: Options = {
    ...buildClaudeAgentSdkBaseOptions({
      claudeExecutablePath: resolvedDependencies.claudeExecutablePath,
      cwd: input.workingDirectory,
      processEnv: serviceInput.processEnv,
    }),
    additionalDirectories: [input.workingDirectory],
    ...sessionOptions,
    abortController: session.abortController,
    allowedTools: allowedClaudeWorkflowTools(workflowRole),
    forwardSubagentText: true,
    includePartialMessages: true,
    mcpServers,
    ...(transcriptStore
      ? {
          sessionStore: transcriptStore,
          sessionStoreFlush: "eager" as const,
        }
      : {}),
    systemPrompt,
    canUseTool: createClaudeCanUseTool({ session, now, randomId, emit }),
    onUserDialog: createClaudeUserDialogHandler({
      session,
      now,
      randomId,
      emit,
    }),
    supportedDialogKinds: [...CLAUDE_ASK_USER_QUESTION_DIALOG_KINDS],
    toolConfig: {
      askUserQuestion: { previewFormat: "markdown" },
    },
    agentProgressSummaries: true,
  };
  if (model?.modelId) {
    options.model = model.modelId;
  }
  if (model?.variant) {
    options.effort = model.variant as NonNullable<Options["effort"]>;
  }
  if (model?.profileId) {
    options.agent = model.profileId;
  }
  if (readOnlyWorkflowRole) {
    options.disallowedTools = [...CLAUDE_RUNTIME_DESCRIPTOR.readOnlyRoleBlockedTools];
  }
  return options;
};

export const applyClaudeCodeExecutablePath = (options: Options, executablePath: string): void => {
  options.pathToClaudeCodeExecutable = executablePath;
};

const buildClaudeMcpServers = async ({
  resolvedDependencies,
  session,
}: {
  resolvedDependencies: ClaudeAgentSdkOptionsDependencies;
  session: ClaudeSessionContext;
}): Promise<Record<string, McpServerConfig>> => {
  const [command, ...args] = resolvedDependencies.mcpCommand;
  if (!command) {
    throw new HostValidationError({
      field: "mcpCommand",
      message: "OpenDucktor MCP command cannot be empty.",
    });
  }
  const bridgeEnvironment = buildOpenDucktorMcpBridgeEnvironment(
    resolvedDependencies.mcpBridgeConnection,
    "Claude",
  );
  const { ODT_HOST_TOKEN: hostToken, ...publicBridgeEnvironment } = bridgeEnvironment;
  const hostTokenFile = await createSessionScopedClaudeMcpTokenFile({
    hostToken,
    signal: session.abortController.signal,
  });
  return {
    openducktor: {
      type: "stdio",
      command,
      args,
      env: {
        ...publicBridgeEnvironment,
        [CLAUDE_OPENDUCKTOR_MCP_TOKEN_FILE_ENV]: hostTokenFile,
      },
      alwaysLoad: true,
    },
  };
};

const createSessionScopedClaudeMcpTokenFile = async ({
  hostToken,
  signal,
}: {
  hostToken: string;
  signal: AbortSignal;
}): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "openducktor-claude-mcp-"));
  const tokenPath = join(directory, "host-token");
  try {
    await writeFile(tokenPath, hostToken, { encoding: "utf8", mode: 0o600 });

    const cleanup = (): void => {
      void rm(directory, { recursive: true, force: true });
    };
    if (signal.aborted) {
      cleanup();
    } else {
      signal.addEventListener("abort", cleanup, { once: true });
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return tokenPath;
};
