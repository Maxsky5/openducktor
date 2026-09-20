import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  filterEscalatingDefaultMode,
  type McpServerConfig,
  type Options,
  resolveSettings,
} from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { AGENT_ROLE_TOOL_POLICY } from "@openducktor/core";
import { Effect } from "effect";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import { sanitizeChildProcessEnvironment } from "../../infrastructure/process/process-environment";
import {
  buildOpenDucktorMcpBridgeEnvironment,
  type OpenDucktorMcpBridgeConnection,
} from "../mcp/openducktor-mcp-environment";
import { createClaudeCanUseTool } from "./claude-agent-sdk-permissions";
import { createClaudePostToolUseHook } from "./claude-agent-sdk-post-tool-use-hook";
import { createClaudePreToolUseHook } from "./claude-agent-sdk-pre-tool-use-hook";
import {
  CLAUDE_ASK_USER_QUESTION_DIALOG_KINDS,
  createClaudeUserDialogHandler,
} from "./claude-agent-sdk-questions";
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

/**
 * Private bundled CLI switch. It is absent from the public SDK type contract,
 * so the Claude adapter keeps it behind the native continuation admission check.
 */
export const CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV = "CLAUDE_CODE_RESUME_INTERRUPTED_TURN";

/**
 * Private bundled CLI switch that makes the CLI emit `session_state_changed` frames.
 * The continuation admission waits for the running state, so the continuation launch
 * sets it.
 */
export const CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS_ENV = "CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS";

type BuildClaudeAgentSdkOptionsInput = {
  input: ClaudeSessionInput;
  session: ClaudeSessionContext;
  sessionOptions: Partial<Options>;
  serviceInput: CreateClaudeAgentSdkServiceInput;
  now: () => string;
  randomId: () => string;
  emit: ClaudeAgentSdkEventEmitter;
  resolvedDependencies: ClaudeAgentSdkOptionsDependencies;
  resumeInterruptedTurn?: boolean;
};

const CLAUDE_OPENDUCKTOR_MCP_TOKEN_FILE_ENV = "ODT_HOST_TOKEN_FILE";
const buildClaudeOpenDucktorRuntimePrompt = (workingDirectory: string): string =>
  `OpenDucktor starts this Claude Code session with cwd set to ${workingDirectory}. Use relative paths and do not prefix Bash commands with cd ${workingDirectory}; only change directories when that is the actual task.`;

export const buildClaudeAgentSdkBaseOptions = ({
  claudeExecutablePath,
  cwd,
  processEnv,
  resumeInterruptedTurn = false,
}: {
  claudeExecutablePath: string;
  cwd: string;
  processEnv?: NodeJS.ProcessEnv | undefined;
  resumeInterruptedTurn?: boolean;
}): Options => {
  const inheritedEnv = sanitizeChildProcessEnvironment(processEnv ?? {});
  // The private Claude switches must come only from this adapter. An inherited value
  // would start a hidden continuation for a session that is not a continuation.
  delete inheritedEnv[CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS_ENV];
  delete inheritedEnv[CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV];
  const env = {
    ...inheritedEnv,
    CLAUDE_AGENT_SDK_CLIENT_APP: "openducktor",
  };
  const options: Options = {
    cwd,
    env: resumeInterruptedTurn
      ? {
          ...env,
          [CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS_ENV]: "1",
          [CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV]: "1",
        }
      : env,
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
  resumeInterruptedTurn,
  serviceInput,
  session,
  sessionOptions,
}: BuildClaudeAgentSdkOptionsInput): Promise<Options> => {
  const workflowRole = claudeWorkflowRole(input);
  const [mcpServers, resolvedSettings] = await Promise.all([
    buildClaudeMcpServers({
      resolvedDependencies,
      serviceInput,
      session,
      workflowRole,
    }),
    resolveSettings({ cwd: input.workingDirectory }),
  ]);
  const permissionMode =
    filterEscalatingDefaultMode(resolvedSettings).permissions?.defaultMode ?? "default";
  const model = input.model;
  const readOnlyWorkflowRole = isReadOnlyWorkflowRole(workflowRole);
  const systemPrompt = [
    "systemPrompt" in input && input.systemPrompt ? input.systemPrompt : null,
    buildClaudeOpenDucktorRuntimePrompt(input.workingDirectory),
  ]
    .filter((entry): entry is string => entry !== null && entry.trim().length > 0)
    .join("\n\n");
  const postToolUseHook = createClaudePostToolUseHook({
    session,
    now,
    emit: (event) => emit(session, event),
  });
  const options: Options = {
    ...buildClaudeAgentSdkBaseOptions({
      claudeExecutablePath: resolvedDependencies.claudeExecutablePath,
      cwd: input.workingDirectory,
      processEnv: serviceInput.processEnv,
      resumeInterruptedTurn: resumeInterruptedTurn === true,
    }),
    additionalDirectories: [input.workingDirectory],
    ...sessionOptions,
    abortController: session.abortController,
    forwardSubagentText: true,
    includePartialMessages: true,
    hooks: {
      PreToolUse: [
        {
          hooks: [createClaudePreToolUseHook({ session })],
        },
      ],
      PostToolUse: [
        {
          hooks: [postToolUseHook],
        },
      ],
      PostToolUseFailure: [
        {
          hooks: [postToolUseHook],
        },
      ],
    },
    mcpServers,
    permissionMode,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: systemPrompt,
    },
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
  if (
    sessionOptions.resume &&
    !sessionOptions.forkSession &&
    input.sessionScope?.kind === "repository" &&
    !("systemPrompt" in input && input.systemPrompt)
  ) {
    delete options.systemPrompt;
    delete options.permissionMode;
  }
  if (options.permissionMode === "bypassPermissions") {
    options.allowDangerouslySkipPermissions = true;
  }
  if (model?.modelId) {
    options.model = model.modelId;
  }
  if (model?.variant) {
    switch (model.variant) {
      case "low":
      case "medium":
      case "high":
      case "xhigh":
      case "max":
        options.effort = model.variant;
        break;
      default:
        throw new HostValidationError({
          field: "model.variant",
          message: `Claude Agent SDK does not support effort '${model.variant}'.`,
          details: { model },
        });
    }
  }
  if (model?.profileId) {
    options.agent = model.profileId;
  }
  if (readOnlyWorkflowRole) {
    options.disallowedTools = [...CLAUDE_RUNTIME_DESCRIPTOR.readOnlyRoleBlockedTools];
  }
  return options;
};

const applyClaudeCodeExecutablePath = (options: Options, executablePath: string): void => {
  options.pathToClaudeCodeExecutable = executablePath;
};

const buildClaudeMcpServers = async ({
  resolvedDependencies,
  serviceInput,
  session,
  workflowRole,
}: {
  resolvedDependencies: ClaudeAgentSdkOptionsDependencies;
  serviceInput: CreateClaudeAgentSdkServiceInput;
  session: ClaudeSessionContext;
  workflowRole: ReturnType<typeof claudeWorkflowRole>;
}): Promise<Record<string, McpServerConfig>> => {
  const [command, ...args] = resolvedDependencies.mcpCommand;
  if (!command) {
    throw new HostValidationError({
      field: "mcpCommand",
      message: "OpenDucktor MCP command cannot be empty.",
    });
  }
  const baseBridgeEnvironment = buildOpenDucktorMcpBridgeEnvironment(
    resolvedDependencies.mcpBridgeConnection,
    "Claude",
  );
  const bridgeEnvironment = workflowRole
    ? {
        ...baseBridgeEnvironment,
        ODT_ALLOWED_TOOLS: AGENT_ROLE_TOOL_POLICY[workflowRole].join(","),
      }
    : baseBridgeEnvironment;
  const { ODT_HOST_TOKEN: hostToken, ...publicBridgeEnvironment } = bridgeEnvironment;
  const hostTokenFile = await createSessionScopedClaudeMcpTokenFile({
    hostToken,
    onBackgroundFailure: serviceInput.onBackgroundFailure,
    externalSessionId: session.externalSessionId,
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
  externalSessionId,
  hostToken,
  onBackgroundFailure,
  signal,
}: {
  externalSessionId: string;
  hostToken: string;
  onBackgroundFailure: CreateClaudeAgentSdkServiceInput["onBackgroundFailure"];
  signal: AbortSignal;
}): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "openducktor-claude-mcp-"));
  const tokenPath = join(directory, "host-token");
  try {
    await writeFile(tokenPath, hostToken, { encoding: "utf8", mode: 0o600 });

    const cleanup = (): void => {
      void rm(directory, { recursive: true, force: true }).catch((cause) => {
        Effect.runFork(
          onBackgroundFailure(
            new HostOperationError({
              operation: "claudeRuntime.cleanupMcpTokenDirectory",
              message: `Failed to remove Claude MCP token directory for session '${externalSessionId}': ${errorMessage(cause)}`,
              cause,
              details: { directory, externalSessionId },
            }),
          ),
        );
      });
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
