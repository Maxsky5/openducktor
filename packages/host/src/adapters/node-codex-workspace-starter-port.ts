import { type ChildProcessByStdio, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import { type RuntimeInstanceSummary, runtimeInstanceSummarySchema } from "@openducktor/contracts";
import type {
  RuntimeWorkspaceHandle,
  RuntimeWorkspaceStarterPort,
} from "../ports/runtime-registry-port";
import type { SystemCommandPort } from "../ports/system-command-port";
import type { CodexAppServerTransport } from "./in-memory-codex-app-server-port";
import { createNodeCodexAppServerTransport } from "./node-codex-app-server-transport";
import {
  parseMcpCommandJson,
  resolveOpenDucktorMcpCommand,
} from "./node-openducktor-mcp-command-resolution";
import { resolveCodexBinary } from "./node-runtime-binary-resolution";

type CodexChildProcess = ChildProcessByStdio<Writable, Readable, Readable>;

export type CodexMcpBridgeConnection = {
  workspaceId: string;
  hostUrl: string;
  hostToken: string;
};

export type CodexMcpBridgeConnectionResolver = () => Promise<CodexMcpBridgeConnection>;

export type CodexAppServerTransportRegistry = {
  registerTransport(runtimeId: string, transport: CodexAppServerTransport): void;
  unregisterTransport(runtimeId: string): void;
};

export type CreateNodeCodexWorkspaceStarterPortInput = {
  systemCommands: SystemCommandPort;
  codexAppServer: CodexAppServerTransportRegistry;
  resolveMcpBridgeConnection?: CodexMcpBridgeConnectionResolver;
  processEnv?: NodeJS.ProcessEnv;
  mcpCommand?: string[];
  codexBinary?: string;
  requestTimeoutMs?: number;
  stopTimeoutMs?: number;
  now?: () => Date;
  runtimeId?: () => string;
};

const CODEX_ODT_TOOL_IDS = [
  "odt_read_task",
  "odt_read_task_documents",
  "odt_set_spec",
  "odt_set_plan",
  "odt_build_blocked",
  "odt_build_resumed",
  "odt_build_completed",
  "odt_set_pull_request",
  "odt_qa_approved",
  "odt_qa_rejected",
];

const CODEX_MCP_ENV_VARS = [
  "ODT_WORKSPACE_ID",
  "ODT_HOST_URL",
  "ODT_HOST_TOKEN",
  "ODT_FORBID_WORKSPACE_ID_INPUT",
  "ODT_ALLOWED_TOOLS",
];

const DEFAULT_CODEX_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;

const resolveConfiguredMcpCommand = (
  env: NodeJS.ProcessEnv,
  configuredCommand?: string[],
): string[] | null => {
  if (configuredCommand) {
    const command = configuredCommand.map((entry) => entry.trim());
    if (command.length === 0 || command.some((entry) => entry.length === 0)) {
      throw new Error("Codex MCP command must contain only non-empty strings.");
    }
    return command;
  }

  const rawCommand = env.OPENDUCKTOR_MCP_COMMAND_JSON;
  if (rawCommand !== undefined) {
    return parseMcpCommandJson(rawCommand);
  }

  return null;
};

const tomlString = (value: string): string => JSON.stringify(value);

const tomlStringArray = (values: string[]): string =>
  `[${values.map((value) => tomlString(value)).join(", ")}]`;

export const buildCodexMcpConfigArgs = (mcpCommand: string[]): string[] => {
  const [mcpBinary, ...mcpArgs] = mcpCommand;
  if (!mcpBinary) {
    throw new Error("OpenDucktor MCP command cannot be empty.");
  }

  return [
    `mcp_servers.openducktor.command=${tomlString(mcpBinary)}`,
    `mcp_servers.openducktor.args=${tomlStringArray(mcpArgs)}`,
    `mcp_servers.openducktor.env_vars=${tomlStringArray(CODEX_MCP_ENV_VARS)}`,
    "mcp_servers.openducktor.enabled=true",
  ].flatMap((config) => ["--config", config]);
};

const requireBridgeValue = (value: string, label: keyof CodexMcpBridgeConnection): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Codex MCP bridge ${label} is required.`);
  }
  return trimmed;
};

const processGroupId = (pid: number): number => -pid;

const signalProcessGroup = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(processGroupId(pid), signal);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return;
    }
    throw error;
  }
};

const waitForClose = (
  child: CodexChildProcess,
  isClosed: () => boolean,
  timeoutMs: number,
): Promise<boolean> => {
  if (isClosed()) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off("close", onClose);
      resolve(false);
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once("close", onClose);
  });
};

const stopChildProcess = async (
  child: CodexChildProcess,
  pid: number,
  isClosed: () => boolean,
  stopTimeoutMs: number,
): Promise<void> => {
  if (isClosed()) {
    return;
  }

  signalProcessGroup(pid, "SIGTERM");
  if (await waitForClose(child, isClosed, stopTimeoutMs)) {
    return;
  }

  signalProcessGroup(pid, "SIGKILL");
  if (await waitForClose(child, isClosed, stopTimeoutMs)) {
    return;
  }

  throw new Error(`Timed out waiting for Codex app-server process group ${pid} to stop.`);
};

export const createNodeCodexWorkspaceStarterPort = ({
  systemCommands,
  codexAppServer,
  resolveMcpBridgeConnection,
  processEnv = process.env,
  mcpCommand,
  codexBinary,
  requestTimeoutMs = DEFAULT_CODEX_REQUEST_TIMEOUT_MS,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
  now = () => new Date(),
  runtimeId = () => randomUUID(),
}: CreateNodeCodexWorkspaceStarterPortInput): RuntimeWorkspaceStarterPort => ({
  async startWorkspaceRuntime(input): Promise<RuntimeWorkspaceHandle> {
    if (process.platform === "win32") {
      throw new Error("Codex app-server runtimes are only supported on Unix hosts in this build.");
    }
    if (input.runtimeKind !== "codex") {
      throw new Error(
        `Node Codex workspace starter does not support runtime kind ${input.runtimeKind}.`,
      );
    }
    if (!resolveMcpBridgeConnection) {
      throw new Error("Codex workspace startup requires an MCP host bridge connection.");
    }

    const bridge = await resolveMcpBridgeConnection();
    const resolvedMcpCommand =
      resolveConfiguredMcpCommand(processEnv, mcpCommand) ??
      (await resolveOpenDucktorMcpCommand({ systemCommands, env: processEnv }));
    const binary = codexBinary ?? (await resolveCodexBinary(systemCommands, processEnv));
    const nextRuntimeId = runtimeId();
    const child = spawn(binary, [...buildCodexMcpConfigArgs(resolvedMcpCommand), "app-server"], {
      cwd: input.workingDirectory,
      detached: true,
      env: {
        ...processEnv,
        ODT_WORKSPACE_ID: requireBridgeValue(bridge.workspaceId, "workspaceId"),
        ODT_HOST_URL: requireBridgeValue(bridge.hostUrl, "hostUrl"),
        ODT_HOST_TOKEN: requireBridgeValue(bridge.hostToken, "hostToken"),
        ODT_FORBID_WORKSPACE_ID_INPUT: "true",
        ODT_ALLOWED_TOOLS: CODEX_ODT_TOOL_IDS.join(","),
      },
      stdio: ["pipe", "pipe", "pipe"],
    }) as CodexChildProcess;
    const pid = child.pid;
    if (!pid || pid <= 0) {
      throw new Error("Failed to start Codex app-server: child process has no valid pid.");
    }

    let closed = false;
    child.once("close", () => {
      closed = true;
    });

    const transport = createNodeCodexAppServerTransport(nextRuntimeId, child, requestTimeoutMs);
    codexAppServer.registerTransport(nextRuntimeId, transport);

    try {
      await transport.request({
        method: "initialize",
        params: {
          clientInfo: {
            name: "openducktor",
            title: "OpenDucktor",
            version: "0.0.0",
          },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: [],
          },
        },
      });
      await transport.notify("initialized", {});
    } catch (error) {
      codexAppServer.unregisterTransport(nextRuntimeId);
      transport.close();
      await stopChildProcess(child, pid, () => closed, stopTimeoutMs);
      throw error;
    }

    const runtime = runtimeInstanceSummarySchema.parse({
      kind: "codex",
      runtimeId: nextRuntimeId,
      repoPath: input.repoPath,
      taskId: null,
      role: "workspace",
      workingDirectory: input.workingDirectory,
      runtimeRoute: {
        type: "stdio",
        identity: nextRuntimeId,
      },
      startedAt: now().toISOString(),
      descriptor: input.descriptor,
    } satisfies RuntimeInstanceSummary);

    return {
      runtime,
      async stop() {
        codexAppServer.unregisterTransport(nextRuntimeId);
        transport.close();
        await stopChildProcess(child, pid, () => closed, stopTimeoutMs);
      },
    };
  },
});
