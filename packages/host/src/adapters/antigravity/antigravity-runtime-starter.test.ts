import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  AgentSessionLiveRegistration,
  type AgentSessionLiveAdapterPort,
} from "../../ports/agent-session-live-adapter-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createAntigravityLiveSessionAdapterPreparer } from "../agent-sessions/antigravity-live-session-adapter";
import { createAntigravityRuntimeStarter } from "./antigravity-runtime-starter";
import { AntigravityRuntimeSessions } from "./antigravity-runtime-sessions";

// A fake `agy acp`. Its script answers `initialize` as FAKE_AGY_INITIALIZE says and exits at
// `session/new`. The shell then closes the stdout pipe and keeps running.
const FAKE_AGY_SCRIPT = `
const mode = process.env.FAKE_AGY_INITIALIZE;
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\\n")) >= 0) {
    const request = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    if (request.method === "initialize" && mode === "auth") {
      send({ id: request.id, error: { code: -32000, message: "Authentication required" } });
    } else if (request.method === "initialize") {
      send({ id: request.id, result: {
        protocolVersion: mode === "v2" ? 2 : 1,
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { list: {}, close: {} },
          _meta: { antigravity: { systemPrompt: { append: true } } },
        },
        agentInfo: { name: "Antigravity ACP Server", version: "1.5.14" },
      } });
    } else if (request.method === "session/new") {
      process.exit(0);
    }
  }
});
`;

let fixtureDirectory = "";
let fakeAgyPath = "";
beforeAll(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), "openducktor-fake-agy-"));
  fakeAgyPath = join(fixtureDirectory, "agy");
  writeFileSync(join(fixtureDirectory, "fake-agy.js"), FAKE_AGY_SCRIPT);
  writeFileSync(
    fakeAgyPath,
    `#!/bin/sh\n"${process.execPath}" "${join(fixtureDirectory, "fake-agy.js")}"\nexec 1>&-\nexec sleep 30\n`,
  );
  chmodSync(fakeAgyPath, 0o755);
});
afterAll(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

const toolDiscovery: ToolDiscoveryPort = {
  discoverTool: () => Effect.die(new Error("Unexpected tool discovery.")),
  resolveTool: () => Effect.die(new Error("Unexpected tool discovery.")),
  resolveToolPath: () => Effect.die(new Error("Unexpected tool discovery.")),
  validateToolPath: (_toolId, executablePath) =>
    Effect.succeed({
      displayLabel: "Saved path",
      path: executablePath,
      sourceCategory: "provided_path",
    }),
};

const createStarter = (initialize: "v1" | "v2" | "auth") => {
  const released: string[] = [];
  const registered: AgentSessionLiveAdapterPort[] = [];
  const liveSessionLifecycle: RuntimeLiveSessionLifecyclePort = {
    registerRuntimeAdapter: (adapter) => Effect.sync(() => void registered.push(adapter)),
    releaseRuntime: (runtimeId) =>
      Effect.sync(() => {
        released.push(runtimeId);
        return [];
      }),
    createRuntimeRegistration: (binding) =>
      new AgentSessionLiveRegistration(binding, (mutation) =>
        Effect.map(mutation, ({ value }) => value),
      ),
  };
  const readEnv = () => ({ ...process.env, FAKE_AGY_INITIALIZE: initialize });
  const starter = createAntigravityRuntimeStarter({
    toolDiscovery,
    liveSessionLifecycle,
    prepareLiveSessionAdapter: createAntigravityLiveSessionAdapterPreparer({
      liveSessionLifecycle,
      resolveSessionMode: () => Effect.succeed("auto"),
      resolveMcpServerConfig: () =>
        Effect.succeed({
          command: ["/bin/odt-mcp"],
          environment: {
            ODT_WORKSPACE_ID: "workspace-1",
            ODT_HOST_URL: "http://127.0.0.1:1",
            ODT_HOST_TOKEN: "token",
            ODT_FORBID_WORKSPACE_ID_INPUT: "true",
            ODT_ALLOWED_TOOLS: "",
            ODT_RUNTIME_KIND: "antigravity",
          },
        }),
      resolveWorkflowRolePolicy: () => ({ tools: [], readOnly: false }),
      directoriesMatch: (left, right) => Effect.succeed(left === right),
      attachmentStageDirectory: fixtureDirectory,
      createFileSearch: () => ({
        prewarm: () => undefined,
        release: () => undefined,
        search: async () => [],
        dispose: () => undefined,
      }),
      readEnv,
      runtimeSessions: new AntigravityRuntimeSessions(),
    }),
    launchDirectory: fixtureDirectory,
    readEnv,
    runtimeId: () => "runtime-1",
  });
  const exits: string[] = [];
  let notifyExit = () => {};
  const exited = new Promise<void>((resolve) => {
    notifyExit = resolve;
  });
  const cleanups: Array<Effect.Effect<void, unknown>> = [];
  const start = starter.startRuntime({
    runtimeKind: "antigravity",
    descriptor: structuredClone(RUNTIME_DESCRIPTORS_BY_KIND.antigravity),
    configuredExecutablePath: fakeAgyPath,
    // The host owns the cleanup of a start, also when the start fails.
    ownCleanup: (cleanup) => void cleanups.push(cleanup),
    onRuntimeExit: (message) => {
      exits.push(message);
      notifyExit();
    },
    onRuntimeCleanupFailed: (message) => {
      throw new Error(`Unexpected cleanup failure: ${message}`);
    },
  });
  const runCleanups = () =>
    Effect.runPromise(Effect.forEach(cleanups, (cleanup) => Effect.ignore(cleanup)));
  return { start, released, registered, exits, exited, runCleanups };
};

// The fake executable is a POSIX shell script.
const describeOnPosix = process.platform === "win32" ? describe.skip : describe;

describeOnPosix("createAntigravityRuntimeStarter", () => {
  test("reports a closed ACP connection of a running process and cleans up", async () => {
    const { start, released, registered, exits, exited, runCleanups } = createStarter("v1");
    let failure: Error;
    try {
      const handle = await Effect.runPromise(start);
      const adapter = registered[0];
      if (!adapter?.supportsSessionControl) throw new Error("Expected a session adapter.");
      failure = await Effect.runPromise(
        Effect.flip(
          adapter.startSession({
            repoPath: "/repo",
            runtimeKind: "antigravity",
            workingDirectory: "/repo/worktree",
            sessionScope: { kind: "repository", workspaceId: "workspace-1" },
            systemPrompt: "Help.",
          }),
        ),
      );
      await exited;
      await Effect.runPromise(handle.stop());
    } finally {
      await runCleanups();
    }

    expect(failure.message).toContain("ACP connection closed");
    expect(exits).toEqual([
      "Antigravity closed its ACP connection. Restart the runtime to continue.",
    ]);
    expect(released).toEqual(["runtime-1"]);
  });

  test("refuses a runtime that answers with another ACP version", async () => {
    const { start, runCleanups } = createStarter("v2");

    const failure = await Effect.runPromise(Effect.flip(start)).finally(runCleanups);

    expect(failure.message).toContain(
      "Antigravity answered with ACP protocol version 2, and OpenDucktor needs version 1.",
    );
  });

  test("tells the user to sign in when initialize needs authentication", async () => {
    const { start, runCleanups } = createStarter("auth");

    const failure = await Effect.runPromise(Effect.flip(start)).finally(runCleanups);

    expect(failure.message).toContain("Antigravity needs a sign-in.");
    expect(failure.message).toContain("run `agy` in a terminal");
  });
});
