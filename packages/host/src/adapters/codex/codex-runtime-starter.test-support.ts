import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Effect } from "effect";
import { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { RuntimeStartInput, RuntimeStarterPort } from "../../ports/runtime-registry-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryId, ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { writeFakeRuntimeCommand } from "../../test-support/fake-runtime-command";
import { createAgentSessionRuntimeAdapterTestDouble } from "../../test-support/service-test-doubles";
import { createToolDiscoveryAdapter } from "../system/tool-discovery";
import {
  type CreateCodexRuntimeStarterInput,
  createCodexRuntimeStarter,
} from "./codex-runtime-starter";

type Defaults = Pick<
  CreateCodexRuntimeStarterInput,
  "toolDiscovery" | "liveSessionLifecycle" | "prepareLiveSessionAdapter" | "launchDirectory"
>;
type StarterInput = Omit<CreateCodexRuntimeStarterInput, keyof Defaults> &
  Partial<Defaults> & { systemCommands?: SystemCommandPort };

/** Use the real starter with small port fakes around process startup and cleanup. */
export const createStarter = (input: StarterInput): RuntimeStarterPort => {
  const {
    liveSessionLifecycle,
    prepareLiveSessionAdapter,
    readEnv,
    systemCommands,
    toolDiscovery,
    ...overrides
  } = input;
  const lifecycle = {
    registerRuntimeAdapter: () => Effect.void,
    releaseRuntime: () => Effect.succeed([]),
    createRuntimeRegistration: (binding) =>
      new AgentSessionLiveRegistration(binding, (mutation) =>
        mutation.pipe(Effect.map((result) => result.value)),
      ),
  } satisfies RuntimeLiveSessionLifecyclePort;
  const discovery: Parameters<typeof createToolDiscoveryAdapter>[0] = {
    systemCommands: systemCommands ?? stubCommands(),
  };
  if (readEnv !== undefined) {
    discovery.readEnv = readEnv;
  }
  const tools = toolDiscovery ?? createToolDiscoveryAdapter(discovery);
  const options: CreateCodexRuntimeStarterInput = {
    launchDirectory: tmpdir(),
    toolDiscovery: tools,
    liveSessionLifecycle: liveSessionLifecycle ?? lifecycle,
    prepareLiveSessionAdapter:
      prepareLiveSessionAdapter ??
      ((runtime) =>
        Effect.succeed({
          adapter: createAgentSessionRuntimeAdapterTestDouble(
            {
              runtimeId: runtime.runtimeId,
              runtimeKind: runtime.kind,
            },
            {},
          ),
          emitRuntimeEvent: () => {},
          startForwarding: () => Effect.void,
          discard: () => Effect.void,
        })),
    ...overrides,
  };
  if (readEnv !== undefined) {
    options.readEnv = readEnv;
  }
  return createCodexRuntimeStarter(options);
};

/** Start input that records each reported runtime exit and the cleanup that the host owns. */
export const codexStartInput = (
  configuredExecutablePath: string,
  exits: string[] = [],
  cleanupFailures: string[] = [],
  ownedCleanups: Parameters<RuntimeStartInput["ownCleanup"]>[0][] = [],
): RuntimeStartInput => ({
  runtimeKind: "codex",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
  configuredExecutablePath,
  ownCleanup: (cleanup) => {
    ownedCleanups.push(cleanup);
  },
  onRuntimeExit: (message) => {
    exits.push(message);
  },
  onRuntimeCleanupFailed: (cause) => {
    cleanupFailures.push(cause);
  },
});

/** Write a fixture executable so lifecycle tests use native child close events. */
export const writeCodex = async (
  root: string,
  {
    childPidPath,
    emitStreamEvents = false,
    exitBeforeInitialize,
    fatalMessagePath,
    hangRequestMethods = [],
    runtimePidPath,
  }: {
    childPidPath?: string;
    emitStreamEvents?: boolean;
    exitBeforeInitialize?: { code: number; stderr: string };
    fatalMessagePath?: string;
    hangRequestMethods?: string[];
    runtimePidPath?: string;
  } = {},
): Promise<string> => {
  const scriptPath = join(root, "codex.mjs");
  await writeFile(
    scriptPath,
    `import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const capturePath = process.env.CODEX_CAPTURE_PATH;
const childPidPath = ${JSON.stringify(childPidPath ?? null)};
const emitStreamEvents = ${JSON.stringify(emitStreamEvents)};
const exitBeforeInitialize = ${JSON.stringify(exitBeforeInitialize ?? null)};
const hangRequestMethods = new Set(${JSON.stringify(hangRequestMethods)});
const runtimePidPath = ${JSON.stringify(runtimePidPath ?? null)};
const fatalMessagePath = ${JSON.stringify(fatalMessagePath ?? null)};
const capture = {
  args: process.argv.slice(2),
  cwd: process.cwd(),
  env: {
    ODT_WORKSPACE_ID: process.env.ODT_WORKSPACE_ID,
    ODT_HOST_URL: process.env.ODT_HOST_URL,
    ODT_HOST_TOKEN: process.env.ODT_HOST_TOKEN,
    ODT_FORBID_WORKSPACE_ID_INPUT: process.env.ODT_FORBID_WORKSPACE_ID_INPUT,
    ODT_ALLOWED_TOOLS: process.env.ODT_ALLOWED_TOOLS,
  },
  initializeVersion: null,
};
if (capturePath) {
  writeFileSync(capturePath, JSON.stringify(capture));
}
if (runtimePidPath) {
  writeFileSync(runtimePidPath, String(process.pid));
}

if (!process.argv.includes("app-server")) {
  console.error("expected app-server command");
  process.exit(2);
}
if (exitBeforeInitialize) {
  console.error(exitBeforeInitialize.stderr);
  process.exit(exitBeforeInitialize.code);
}
if (childPidPath) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
    stdio: "ignore",
  });
  writeFileSync(childPidPath, String(child.pid));
}

if (fatalMessagePath) {
  const timer = setInterval(() => {
    if (!existsSync(fatalMessagePath)) return;
    // writeFile creates the file before it writes the line, so wait for the line.
    const fatalLine = readFileSync(fatalMessagePath, "utf8");
    if (fatalLine.length === 0) return;
    clearInterval(timer);
    process.stdout.write(fatalLine + "\\n");
  }, 10);
}
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id !== undefined && hangRequestMethods.has(message.method)) return;
  if (message.method === "initialize") {
    capture.initializeVersion = message.params.clientInfo.version;
    if (capturePath) {
      writeFileSync(capturePath, JSON.stringify(capture));
    }
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        userAgent: "codex-test",
        codexHome: "/tmp/codex",
        platformFamily: "unix",
        platformOs: "darwin",
      },
    }) + "\\n");
    return;
  }
  if (message.method === "initialized") {
    if (emitStreamEvents) {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        method: "thread/status/changed",
        params: { threadId: "thread-1", status: { type: "idle" } },
      }) + "\\n");
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "execCommandApproval",
        params: {
          conversationId: "thread-1",
          callId: "call-1",
          approvalId: null,
          command: ["true"],
          cwd: "/repo",
          reason: null,
          parsedCmd: [],
        },
      }) + "\\n");
    }
    return;
  }
  if (message.id !== undefined) {
    if (message.method === "thread/loaded/list") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: { data: [], nextCursor: null },
      }) + "\\n");
      return;
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { data: [], nextCursor: null } }) + "\\n");
  }
});
const stop = () => process.exit(0);
lines.on("close", stop);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
`,
  );
  return writeFakeRuntimeCommand(root, "codex", "codex.mjs");
};

export const stubTools = (paths: Partial<Record<ToolDiscoveryId, string>>): ToolDiscoveryPort => ({
  discoverTool(toolId) {
    return this.resolveTool(toolId);
  },
  resolveTool(toolId) {
    const path = paths[toolId];
    return path === undefined
      ? Effect.die(new Error(`Missing fake tool path for ${toolId}`))
      : Effect.succeed({
          displayLabel: "Test tool",
          path,
          sourceCategory: "provided_path",
        });
  },
  resolveToolPath(toolId) {
    const path = paths[toolId];
    return path === undefined
      ? Effect.die(new Error(`Missing fake tool path for ${toolId}`))
      : Effect.succeed(path);
  },
  validateToolPath(toolId, executablePath) {
    const expectedPath = paths[toolId];
    return expectedPath === executablePath
      ? Effect.succeed({
          displayLabel: "Saved path",
          path: executablePath,
          sourceCategory: "provided_path",
        })
      : Effect.die(new Error(`Unexpected fake tool path for ${toolId}: ${executablePath}`));
  },
});

export const stubCommands = (): SystemCommandPort => ({
  resolveCommandPath(command) {
    return Effect.succeed(command);
  },
  versionCommand() {
    return Effect.succeed("codex 1.0.0");
  },
  runCommandAllowFailure() {
    return Effect.succeed({ ok: true, stdout: "", stderr: "" });
  },
});

export const waitForEvents = async (events: unknown[], count: number): Promise<void> => {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (events.length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${count} Codex app-server event(s).`);
};

export const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 1_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
};

export const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
