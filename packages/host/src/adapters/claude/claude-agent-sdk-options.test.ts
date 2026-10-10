import { describe, expect, spyOn, test } from "bun:test";
import * as realClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import * as fsPromises from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ClaudePolicyFields, ODT_MCP_TOOL_NAMES } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { normalizePathForComparison } from "@openducktor/path-support";
import { Effect } from "effect";
import { z } from "zod";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import { createArtifactRuntimeDistribution } from "../runtimes/runtime-distribution";
import {
  buildClaudeAgentSdkBaseOptions,
  buildClaudeAgentSdkOptions,
  CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS_ENV,
  CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV,
  CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS_ENV,
} from "./claude-agent-sdk-options";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import type {
  ClaudeSessionContext,
  ClaudeToolInput,
  CreateClaudeAgentSdkServiceInput,
} from "./claude-agent-sdk-types";

const createSession = (role: AgentRole = "build"): ClaudeSessionContext => ({
  acceptedUserMessages: [],
  activeSdkUserTurnCount: 0,
  abortController: new AbortController(),
  activity: "idle",
  externalSessionId: "session-1",
  input: {
    repoPath: process.cwd(),
    runtimeKind: "claude",
    workingDirectory: process.cwd(),
    runtimePolicy: { kind: "claude" },
    sessionScope: { kind: "workflow", taskId: "task-1", role },
    systemPrompt: "Build",
  },
  model: undefined,
  pendingApprovals: new Map(),
  pendingQuestions: new Map(),
  queuedSdkMessages: [],
  pendingUserTurnCount: 0,
  queue: new AsyncInputQueue(),
  runtimeId: "claude-runtime-1",
  startedAt: "2026-06-25T20:00:00.000Z",
  summary: {
    externalSessionId: "session-1",
    runtimeKind: "claude",
    workingDirectory: process.cwd(),
    sessionAssociation: { kind: "workflow", taskId: "task-1", role },
    startedAt: "2026-06-25T20:00:00.000Z",
    status: "starting",
  },
  streamAssistantMessageOrdinal: 0,
  streamAssistantMessageIdsByBlockIndex: new Map(),
  subagentMessageIdsByTaskId: new Map(),
  subagentTaskIdsByToolUseId: new Map(),
  toolEndedAtMsByCallId: new Map(),
  toolInputsByCallId: new Map(),
  toolMessageIdsByCallId: new Map(),
  toolNamesByCallId: new Map(),
  toolStartedAtMsByCallId: new Map(),
  todosById: new Map(),
});

const createRepositorySession = (): ClaudeSessionContext => {
  const session = createSession();
  session.input = {
    repoPath: process.cwd(),
    runtimeKind: "claude",
    workingDirectory: process.cwd(),
    runtimePolicy: { kind: "claude" },
    sessionScope: { kind: "repository" },
    systemPrompt: "Help with this repository",
  };
  session.summary = {
    externalSessionId: "session-1",
    runtimeKind: "claude",
    workingDirectory: process.cwd(),
    sessionAssociation: { kind: "repository" },
    startedAt: "2026-06-25T20:00:00.000Z",
    status: "starting",
  };
  return session;
};

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const createServiceInput = (events?: {
  backgroundFailures?: HostOperationErrorAggregate[];
  onBackgroundFailure?: () => void;
  resolvedBridgeRepoPaths?: string[];
}): CreateClaudeAgentSdkServiceInput => ({
  claudeExecutablePath: process.execPath,
  launchPolicy: {
    resolve: () => Effect.succeed({}),
  },
  onBackgroundFailure: (failure) =>
    Effect.sync(() => {
      events?.backgroundFailures?.push(failure);
      events?.onBackgroundFailure?.();
    }),
  resolveMcpBridgeConnection: (repoPath) => {
    events?.resolvedBridgeRepoPaths?.push(repoPath);
    return Effect.succeed({
      workspaceId: "workspace-1",
      hostUrl: "http://127.0.0.1:1",
      hostToken: "bridge-secret-value",
    });
  },
  processEnv: {
    ANTHROPIC_API_KEY: "secret",
    GITHUB_TOKEN: "secret",
    HOME: "/Users/openducktor-test",
    ODT_HOST_TOKEN: "host-control-secret",
    ODT_HOST_TOKEN_FILE: "/tmp/inherited-host-token",
    OPENDUCKTOR_APP_TOKEN: "app-control-secret",
    PATH: "/usr/bin",
    VITE_ODT_BROWSER_AUTH_TOKEN: "browser-control-secret",
  },
  runtimeDistribution: createArtifactRuntimeDistribution({
    mcpLauncher: {
      kind: "executable",
      executablePath: process.execPath,
    },
  }),
  toolDiscovery: {
    discoverTool: () => Effect.die("unused"),
    resolveTool: () => Effect.die("unused"),
    resolveToolPath: () => Effect.succeed(process.execPath),
    validateToolPath: () => Effect.die("unused"),
  },
});

const buildOptions = (
  session: ClaudeSessionContext,
  events?: {
    resolvedBridgeRepoPaths?: string[];
  },
  claudePolicy?: ClaudePolicyFields | null,
  sessionOptions: Partial<realClaudeSdk.Options> = {},
) => {
  events?.resolvedBridgeRepoPaths?.push(session.input.repoPath);
  const request: Parameters<typeof buildClaudeAgentSdkOptions>[0] = {
    input: session.input,
    session,
    resolvedDependencies: {
      claudeExecutablePath: process.execPath,
      mcpBridgeConnection: {
        workspaceId: "workspace-1",
        hostUrl: "http://127.0.0.1:1",
        hostToken: "bridge-secret-value",
      },
      mcpCommand: [process.execPath],
    },
    serviceInput: createServiceInput(events),
    now: () => "2026-06-25T20:00:00.000Z",
    randomId: () => "id",
    emit: () => {},
    sessionOptions,
  };
  if (claudePolicy !== undefined) request.claudePolicy = claudePolicy;
  return buildClaudeAgentSdkOptions(request);
};

const captureSdkLaunchArgs = (options: realClaudeSdk.Options): string[] => {
  const launchArgs: string[] = [];
  const stopBeforeSpawn = new Error("Stopped before creating a Claude process");
  expect(() =>
    realClaudeSdk.query({
      prompt: "Inspect native permission inheritance",
      options: {
        ...options,
        spawnClaudeCodeProcess: ({ args }) => {
          launchArgs.push(...args);
          throw stopBeforeSpawn;
        },
      },
    }),
  ).toThrow(stopBeforeSpawn);
  return launchArgs;
};

const preToolUseHook = async (
  options: Awaited<ReturnType<typeof buildClaudeAgentSdkOptions>>,
  input: {
    permissionMode: string;
    toolInput: ClaudeToolInput;
    toolName: string;
  },
) => {
  const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
  if (!hook) {
    throw new Error("Expected Claude SDK options to register a PreToolUse hook.");
  }
  return hook(
    {
      hook_event_name: "PreToolUse",
      session_id: "session-1",
      transcript_path: "/tmp/session-1.jsonl",
      cwd: options.cwd ?? process.cwd(),
      permission_mode: input.permissionMode,
      tool_name: input.toolName,
      tool_input: input.toolInput,
      tool_use_id: "tool-use-1",
    },
    "tool-use-1",
    { signal: new AbortController().signal },
  );
};

test.each(["repository", "workflow"] as const)(
  "model-only attachment preserves native settings for %s sessions",
  async (kind) => {
    const session = kind === "repository" ? createRepositorySession() : createSession("spec");
    const options = await buildClaudeAgentSdkOptions({
      input: session.input,
      session,
      preserveNativeSettings: true,
      sessionOptions: { resume: "session-1" },
      serviceInput: createServiceInput(),
      now: () => "2026-09-20T00:00:00.000Z",
      randomId: () => "id",
      emit: () => {},
      resolvedDependencies: {
        claudeExecutablePath: process.execPath,
        mcpBridgeConnection: {
          workspaceId: "workspace-1",
          hostUrl: "http://127.0.0.1:1",
          hostToken: "test-token",
        },
        mcpCommand: [process.execPath],
      },
    });
    expect(options.resume).toBe("session-1");
    expect(options).not.toHaveProperty("systemPrompt");
    expect(options).not.toHaveProperty("permissionMode");
    expect(options).not.toHaveProperty("allowDangerouslySkipPermissions");
    expect(options).not.toHaveProperty("model");
    expect(options).not.toHaveProperty("title");
    expect(options).not.toHaveProperty("forkSession");
    expect(options.env?.[CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV]).toBeUndefined();
    expect(options.hooks?.PreToolUse).toHaveLength(1);
    session.abortController.abort();
  },
);

describe("buildClaudeAgentSdkBaseOptions", () => {
  test("rejects managed settings that allow enabled sandbox execution without isolation", async () => {
    const sandbox = { enabled: true, failIfUnavailable: false };
    const resolve = spyOn(realClaudeSdk, "resolveSettings").mockResolvedValue({
      effective: { sandbox },
      provenance: {},
      sources: [{ source: "managed", settings: { sandbox } }],
    });
    try {
      await expect(buildOptions(createSession(), undefined, {})).rejects.toThrow(
        "Ask your administrator",
      );
      const inherited = await buildOptions(createSession(), undefined, null);
      expect(inherited.sandbox).toBeUndefined();
    } finally {
      resolve.mockRestore();
    }
  });

  test("sets resume switches only for an explicit request", () => {
    const normal = buildClaudeAgentSdkBaseOptions({
      claudeExecutablePath: process.execPath,
      cwd: process.cwd(),
    });
    const resume = buildClaudeAgentSdkBaseOptions({
      claudeExecutablePath: process.execPath,
      cwd: process.cwd(),
      resumeInterruptedTurn: true,
    });
    const inherited = buildClaudeAgentSdkBaseOptions({
      claudeExecutablePath: process.execPath,
      cwd: process.cwd(),
      processEnv: {
        [CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS_ENV]: "1",
        [CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV]: "1",
        [CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS_ENV]: "1",
      },
    });

    expect(normal.env?.[CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV]).toBeUndefined();
    expect(resume.env?.[CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV]).toBe("1");
    expect(inherited.env?.[CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV]).toBeUndefined();
    expect(inherited.env?.[CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS_ENV]).toBeUndefined();
    expect(normal.env?.[CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS_ENV]).toBeUndefined();
    expect(inherited.env?.[CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS_ENV]).toBeUndefined();
  });
});

describe("buildClaudeAgentSdkOptions", () => {
  test.each(["default", "acceptEdits", "dontAsk", "bypassPermissions", "auto"] as const)(
    "excludes tools ahead of root and child approvals in %s mode",
    async (permissionMode) => {
      const session = createRepositorySession();
      const policy: ClaudePolicyFields = {
        permissionMode,
        permissions: { allow: ["Read", "Artifact", "AskUserQuestion", "Agent"] },
        toolAvailability: {
          Read: false,
          Artifact: false,
          AskUserQuestion: false,
          Task: false,
          Write: true,
        },
      };
      try {
        const options = await buildOptions(session, undefined, policy);
        expect(options.disallowedTools).toEqual(["Read", "Artifact", "AskUserQuestion", "Agent"]);
        const args = captureSdkLaunchArgs(options);
        expect(args).toContain("--disallowedTools");
        expect(args).toContain("Read,Artifact,AskUserQuestion,Agent");
        expect(options.tools).toEqual({ type: "preset", preset: "claude_code" });
        expect(options).not.toHaveProperty("allowedTools");
        policy.toolAvailability = {};
        const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
        if (!hook || !options.canUseTool) throw new Error("Expected native tool guards");
        for (const toolName of ["Read", "Artifact", "AskUserQuestion", "Agent", "Task"]) {
          expect(
            await hook(
              {
                hook_event_name: "PreToolUse",
                session_id: "session-1",
                transcript_path: "/tmp/transcript",
                cwd: session.input.workingDirectory,
                tool_name: toolName,
                tool_input: {},
                tool_use_id: "child-tool",
                agent_id: "child-with-explicit-tools",
                permission_mode: permissionMode,
              },
              "child-tool",
              { signal: session.abortController.signal },
            ),
          ).toMatchObject({
            hookSpecificOutput: {
              permissionDecision: "deny",
              permissionDecisionReason: `Tool ${toolName} is disabled by this session's tool settings.`,
            },
          });
          expect(
            await options.canUseTool(
              toolName,
              {},
              {
                signal: session.abortController.signal,
                toolUseID: "root-tool",
                requestId: "request-1",
              },
            ),
          ).toMatchObject({
            behavior: "deny",
            message: `Tool ${toolName} is disabled by this session's tool settings.`,
          });
        }
        expect(session.pendingApprovals.size).toBe(0);
        expect(session.pendingQuestions.size).toBe(0);
      } finally {
        session.abortController.abort();
      }
    },
  );
  test("re-enabled preferences retain mandatory read-only exclusions and reject reserved tools", async () => {
    const session = createSession("qa");
    try {
      const options = await buildOptions(session, undefined, {
        toolAvailability: { Artifact: true, Write: true, Read: false },
      });
      expect(options.disallowedTools).toContain("Read");
      expect(options.disallowedTools).toContain("Write");
      expect(options.disallowedTools).not.toContain("Artifact");
      expect(
        await preToolUseHook(options, {
          permissionMode: "bypassPermissions",
          toolName: "Write",
          toolInput: {},
        }),
      ).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
      await expect(
        buildOptions(createRepositorySession(), undefined, {
          toolAvailability: { EndConversation: false },
        }),
      ).rejects.toThrow("Enable EndConversation");
    } finally {
      session.abortController.abort();
    }
  });
  test("maps launch settings without granting tool availability or changing native rule strings", async () => {
    const session = createSession("qa");
    const policy: ClaudePolicyFields = {
      permissionMode: "auto",
      permissions: {
        allow: ["Bash(git status)", "Read(./Finance (2024)/**)", "mcp__future__*"],
        ask: ["Read"],
        deny: ["Agent(custom-agent)", "WebFetch(domain:*.example.com)"],
      },
      sandbox: {
        enabled: true,
        autoAllowBashIfSandboxed: false,
        allowUnsandboxedCommands: false,
        excludedCommands: [],
        filesystem: {
          allowWrite: ["./src/**", "/tmp/**", "~/cache/**"],
          denyWrite: [],
          denyRead: ["./secrets/**"],
          allowRead: [],
        },
        network: {
          allowedDomains: [],
          deniedDomains: ["*.example.com"],
          strictAllowlist: true,
          allowLocalBinding: false,
          allowUnixSockets: ["./run/socket"],
          allowAllUnixSockets: false,
        },
      },
    };
    try {
      const options = await buildOptions(session, undefined, policy);
      expect(options.permissionMode).toBe("auto");
      expect<unknown>(options.settings).toEqual({ permissions: policy.permissions });
      expect(options).not.toHaveProperty("allowedTools");
      expect(options.sandbox).toEqual({
        ...policy.sandbox,
        failIfUnavailable: true,
        filesystem: {
          ...policy.sandbox?.filesystem,
          allowWrite: [join(session.input.workingDirectory, "src/**"), "/tmp/**", "~/cache/**"],
          denyRead: [join(session.input.workingDirectory, "secrets/**")],
        },
        network: {
          ...policy.sandbox?.network,
          allowUnixSockets: [join(session.input.workingDirectory, "run/socket")],
        },
      });
      expect(policy.sandbox?.filesystem?.allowWrite?.[0]).toBe("./src/**");
      expect(options.disallowedTools).toContain("Write");
      const denied = await preToolUseHook(options, {
        permissionMode: "bypassPermissions",
        toolName: "Write",
        toolInput: { file_path: join(session.input.workingDirectory, "src/file") },
      });
      expect(denied).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    } finally {
      session.abortController.abort();
    }
  });

  test("leaves native dontAsk policy to Claude at the real SDK launch boundary", async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), "odt-claude-native-mode-"));
    const session = createRepositorySession();
    session.input.workingDirectory = workingDirectory;
    try {
      await mkdir(join(workingDirectory, ".claude"));
      await writeFile(
        join(workingDirectory, ".claude", "settings.json"),
        JSON.stringify({ permissions: { defaultMode: "dontAsk" } }),
      );
      const nativeSettings = await realClaudeSdk.resolveSettings({ cwd: workingDirectory });
      expect(nativeSettings.effective.permissions?.defaultMode).toBe("dontAsk");
      const options = await buildOptions(session, undefined, null, {
        resume: "00000000-0000-4000-8000-000000000001",
      });
      for (const field of [
        "permissionMode",
        "settings",
        "sandbox",
        "allowDangerouslySkipPermissions",
      ])
        expect(options).not.toHaveProperty(field);
      const args = captureSdkLaunchArgs(options);
      expect(args).toContain("--resume=00000000-0000-4000-8000-000000000001");
      expect(args).not.toContain("--permission-mode");
    } finally {
      session.abortController.abort();
      await rm(workingDirectory, { recursive: true, force: true });
    }
  });

  test.each(["fresh", "fork"] as const)(
    "leaves inherited %s approval mode to the real SDK with no native default",
    async (launch) => {
      const session = createSession("spec");
      const resolve = spyOn(realClaudeSdk, "resolveSettings").mockResolvedValue({
        effective: {},
        provenance: {},
        sources: [],
      });
      try {
        const options = await buildOptions(
          session,
          undefined,
          {},
          launch === "fork"
            ? { resume: "00000000-0000-4000-8000-000000000001", forkSession: true }
            : {},
        );
        expect(captureSdkLaunchArgs(options)).not.toContain("--permission-mode");
        expect(options.sandbox?.failIfUnavailable).toBe(true);
        expect(options.disallowedTools).toContain("Write");
        expect(options).not.toHaveProperty("allowDangerouslySkipPermissions");
      } finally {
        resolve.mockRestore();
        session.abortController.abort();
      }
    },
  );

  test.each(["default", "acceptEdits", "dontAsk", "bypassPermissions", "auto"] as const)(
    "maps explicit %s independently from sandbox enablement",
    async (permissionMode) => {
      const session = createSession();
      try {
        const options = await buildOptions(session, undefined, {
          permissionMode,
          sandbox: { enabled: true },
        });
        expect(options.permissionMode).toBe(permissionMode);
        const args = captureSdkLaunchArgs(options);
        expect(args[args.indexOf("--permission-mode") + 1]).toBe(permissionMode);
        expect(options.sandbox?.enabled).toBe(true);
        expect(options.allowDangerouslySkipPermissions === true).toBe(
          permissionMode === "bypassPermissions",
        );
      } finally {
        session.abortController.abort();
      }
    },
  );
  test("keeps the full workspace-bound OpenDucktor catalog available for repository sessions", async () => {
    const session = createRepositorySession();
    const options = await buildOptions(session);

    expect(options).not.toHaveProperty("allowedTools");
    expect(options.disallowedTools).toBeUndefined();
    expect(options.canUseTool).toBeFunction();
    const openducktorServer = options.mcpServers?.openducktor;
    expect(openducktorServer).toMatchObject({ alwaysLoad: true, type: "stdio" });
    if (!openducktorServer || !("env" in openducktorServer)) {
      throw new Error("Expected OpenDucktor MCP server to use stdio env config.");
    }
    expect(openducktorServer.env).toMatchObject({
      ODT_WORKSPACE_ID: "workspace-1",
      ODT_HOST_URL: "http://127.0.0.1:1",
      ODT_FORBID_WORKSPACE_ID_INPUT: "true",
    });
    expect(openducktorServer.env?.ODT_ALLOWED_TOOLS).toBe(ODT_MCP_TOOL_NAMES.join(","));
    expect(openducktorServer.env?.ODT_ALLOWED_TOOLS?.split(",")).toEqual(
      expect.arrayContaining(["odt_create_task", "odt_search_tasks"]),
    );
    session.abortController.abort();
  });

  test("adds the OpenDucktor MCP server without overriding inherited Claude configuration", async () => {
    const session = createSession();
    const options = await buildOptions(session);

    expect(options).not.toHaveProperty("strictMcpConfig");
    expect(Object.keys(options.mcpServers ?? {})).toEqual(["openducktor"]);
    const openducktorServer = options.mcpServers?.openducktor;
    expect(openducktorServer).toMatchObject({ alwaysLoad: true });
    if (!openducktorServer || !("env" in openducktorServer)) {
      throw new Error("Expected OpenDucktor MCP server to use stdio env config.");
    }
    const openducktorEnv = openducktorServer.env;
    const workflowAllowedTools = openducktorEnv?.ODT_ALLOWED_TOOLS;
    expect(openducktorEnv).toMatchObject({
      ODT_WORKSPACE_ID: "workspace-1",
      ODT_HOST_URL: "http://127.0.0.1:1",
      ODT_FORBID_WORKSPACE_ID_INPUT: "true",
      ODT_ALLOWED_TOOLS: expect.stringContaining("odt_read_task"),
    });
    if (!workflowAllowedTools) {
      throw new Error("Expected workflow ODT tool policy in the Claude MCP environment.");
    }
    expect(workflowAllowedTools.split(",")).toEqual(
      expect.arrayContaining(["odt_create_task", "odt_search_tasks"]),
    );
    expect(openducktorEnv).not.toHaveProperty("ODT_HOST_TOKEN");
    const hostTokenFile = openducktorEnv?.ODT_HOST_TOKEN_FILE;
    if (!hostTokenFile) {
      throw new Error("Expected Claude MCP setup to create a host token file.");
    }
    expect(await readFile(hostTokenFile, "utf8")).toBe("bridge-secret-value");
    expect(JSON.stringify(options.mcpServers)).not.toContain("bridge-secret-value");
    session.abortController.abort();
    expect(options).not.toHaveProperty("managedSettings");
    expect(options.sandbox).toEqual({ failIfUnavailable: true });
    expect(options.forwardSubagentText).toBe(true);
    expect(options.includePartialMessages).toBe(true);
    expect(options).not.toHaveProperty("permissionMode");
    expect(options).not.toHaveProperty("allowedTools");
    expect(options.skills).toBe("all");
    const systemPrompt = z
      .object({ append: z.string(), preset: z.literal("claude_code") })
      .safeParse(options.systemPrompt);
    if (!systemPrompt.success) {
      throw new Error("Expected Claude Code's system prompt preset.");
    }
    expect(systemPrompt.data.preset).toBe("claude_code");
    expect(systemPrompt.data.append).toContain("Build");
    expect(systemPrompt.data.append).toContain(
      "OpenDucktor starts this Claude Code session with cwd set to",
    );
    expect(options.onUserDialog).toBeInstanceOf(Function);
    expect(options.supportedDialogKinds).toContain("ask_user_question");
    expect(options.toolConfig).toEqual({
      askUserQuestion: { previewFormat: "markdown" },
    });
    expect(options.env).toMatchObject({
      ANTHROPIC_API_KEY: "secret",
      CLAUDE_AGENT_SDK_CLIENT_APP: "openducktor",
      GITHUB_TOKEN: "secret",
      HOME: "/Users/openducktor-test",
    });
    expect(options.env).not.toHaveProperty("ODT_HOST_TOKEN");
    expect(options.env).not.toHaveProperty("ODT_HOST_TOKEN_FILE");
    expect(options.env).not.toHaveProperty("OPENDUCKTOR_APP_TOKEN");
    expect(options.env).not.toHaveProperty("VITE_ODT_BROWSER_AUTH_TOKEN");
    expect(options.pathToClaudeCodeExecutable).toBe(process.execPath);
  });

  test("inherits Claude Code filesystem settings", async () => {
    const session = createSession();

    const options = await buildOptions(session);

    expect(options).not.toHaveProperty("settingSources");
    session.abortController.abort();
  });

  test("keeps workflow tool availability separate from Claude approval policy", async () => {
    const session = createSession("spec");

    const options = await buildOptions(session);

    expect(options).not.toHaveProperty("allowedTools");
    const openducktorServer = options.mcpServers?.openducktor;
    if (!openducktorServer || !("env" in openducktorServer)) {
      throw new Error("Expected OpenDucktor MCP server to use stdio env config.");
    }
    expect(openducktorServer.env?.ODT_ALLOWED_TOOLS).toBe(
      "odt_read_task,odt_read_task_assets,odt_read_task_documents,odt_search_tasks,odt_create_task,odt_update_task,odt_set_spec",
    );
    session.abortController.abort();
  });

  test("keeps OpenDucktor MCP scoped to the repository", async () => {
    const session = createSession();
    session.input = {
      ...session.input,
      repoPath: "/repo/fairnest",
      workingDirectory: "/repo/fairnest-task-worktree",
    };
    const events = { resolvedBridgeRepoPaths: new Array<string>() };

    const options = await buildOptions(session, events);

    expect(events.resolvedBridgeRepoPaths).toEqual(["/repo/fairnest"]);
    expect(options.cwd).toBe("/repo/fairnest-task-worktree");
    expect(options.additionalDirectories).toEqual(["/repo/fairnest-task-worktree"]);
  });

  test("leaves Claude persistence authoritative and observes file edits through hooks", async () => {
    const session = createSession();

    const options = await buildClaudeAgentSdkOptions({
      input: session.input,
      session,
      resolvedDependencies: {
        claudeExecutablePath: process.execPath,
        mcpBridgeConnection: {
          workspaceId: "workspace-1",
          hostUrl: "http://127.0.0.1:1",
          hostToken: "bridge-secret-value",
        },
        mcpCommand: [process.execPath],
      },
      serviceInput: createServiceInput(),
      now: () => "2026-06-25T20:00:00.000Z",
      randomId: () => "id",
      emit: () => {},
      sessionOptions: {
        resume: "persisted-session-1",
        forkSession: true,
      },
    });

    expect(options.resume).toBe("persisted-session-1");
    expect(options.forkSession).toBe(true);
    expect(options).not.toHaveProperty("sessionStore");
    expect(options).not.toHaveProperty("sessionStoreFlush");
    expect(options.hooks?.PostToolUse).toHaveLength(1);
    expect(options.hooks?.PostToolUseFailure).toHaveLength(1);
  });

  test.each(["acceptEdits", "plan"] as const)(
    "inherits trusted local %s without a mode rewrite",
    async (mode) => {
      const cwd = await mkdtemp(join(tmpdir(), "openducktor-claude-permissions-"));
      const session = createSession();
      session.input = {
        ...session.input,
        repoPath: cwd,
        workingDirectory: cwd,
      };

      try {
        await mkdir(join(cwd, ".claude"), { recursive: true });
        await writeFile(
          join(cwd, ".claude", "settings.local.json"),
          JSON.stringify({ permissions: { defaultMode: mode } }),
        );

        const options = await buildOptions(session);

        const nativeSettings = await realClaudeSdk.resolveSettings({ cwd });
        expect(nativeSettings.effective.permissions?.defaultMode).toBe(mode);
        expect(captureSdkLaunchArgs(options)).not.toContain("--permission-mode");
        expect(options).not.toHaveProperty("allowDangerouslySkipPermissions");
      } finally {
        session.abortController.abort();
        await rm(cwd, { recursive: true, force: true });
      }
    },
  );

  test("leaves local bypass resolution to Claude while retaining workflow guards", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "openducktor-claude-permissions-"));
    const session = createSession("spec");
    session.input = {
      ...session.input,
      repoPath: cwd,
      workingDirectory: cwd,
    };

    try {
      await mkdir(join(cwd, ".claude"), { recursive: true });
      await writeFile(
        join(cwd, ".claude", "settings.local.json"),
        JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }),
      );

      const options = await buildOptions(session);

      expect(captureSdkLaunchArgs(options)).not.toContain("--permission-mode");
      expect(options).not.toHaveProperty("allowDangerouslySkipPermissions");
      expect(
        await preToolUseHook(options, {
          permissionMode: "bypassPermissions",
          toolName: "mcp__openducktor__odt_set_plan",
          toolInput: {},
        }),
      ).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Tool odt_set_plan is not allowed for spec sessions.",
        },
      });
      for (const tool of [
        { toolName: "Bash", toolInput: { command: "bun run lint" } },
        { toolName: "mcp__semble__search", toolInput: { query: "authentication flow" } },
        { toolName: "mcp__serena__initial_instructions", toolInput: {} },
        {
          toolName: "Agent",
          toolInput: {
            description: "Inspect authentication",
            prompt: "Inspect the repository without modifying files.",
            subagent_type: "Explore",
          },
        },
      ]) {
        expect(
          await preToolUseHook(options, {
            permissionMode: "bypassPermissions",
            ...tool,
          }),
        ).toEqual({});
      }
    } finally {
      session.abortController.abort();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("leaves approval decisions to Claude for permitted safe reads", async () => {
    const session = createSession("spec");
    const options = await buildOptions(session);

    expect(
      await preToolUseHook(options, {
        permissionMode: "dontAsk",
        toolName: "Read",
        toolInput: { file_path: session.input.workingDirectory },
      }),
    ).toEqual({});
  });

  test("auto-approves permitted workflow ODT tools before dontAsk can deny them", async () => {
    const session = createSession("spec");
    const options = await buildOptions(session);

    expect(
      await preToolUseHook(options, {
        permissionMode: "dontAsk",
        toolName: "mcp__openducktor__odt_read_task",
        toolInput: { taskId: "task-1" },
      }),
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: "OpenDucktor auto-approved this tool for the workflow role.",
      },
    });
  });

  test("keeps worktree path routing active in inherited bypass mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "openducktor-claude-routing-"));
    const repoPath = join(root, "repo");
    const workingDirectory = join(root, "worktree");
    await mkdir(join(workingDirectory, ".claude"), { recursive: true });
    await mkdir(repoPath, { recursive: true });
    await writeFile(
      join(workingDirectory, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }),
    );
    const session = createSession();
    session.input = {
      ...session.input,
      repoPath,
      workingDirectory,
    };

    try {
      const options = await buildOptions(session);
      const sourcePath = join(repoPath, "src", "index.ts");

      const hookOutput = await preToolUseHook(options, {
        permissionMode: "bypassPermissions",
        toolName: "Write",
        toolInput: { file_path: sourcePath, content: "export {};" },
      });

      expect(hookOutput).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecisionReason: "OpenDucktor routed the tool input to the session worktree.",
          updatedInput: {
            content: "export {};",
          },
        },
      });
      if (!("hookSpecificOutput" in hookOutput)) {
        throw new Error("Expected synchronous PreToolUse hook output.");
      }
      const hookSpecificOutput = hookOutput.hookSpecificOutput;
      if (hookSpecificOutput.hookEventName !== "PreToolUse") {
        throw new Error(
          `Expected PreToolUse output, received ${hookSpecificOutput.hookEventName}.`,
        );
      }
      expect(hookSpecificOutput).not.toHaveProperty("permissionDecision");
      const updatedInput = hookSpecificOutput?.updatedInput;
      expect(normalizePathForComparison(String(updatedInput?.file_path))).toBe(
        normalizePathForComparison(join(workingDirectory, "src", "index.ts")),
      );
    } finally {
      session.abortController.abort();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("leaves Bash to Claude while blocking native mutating tools for read-only roles", async () => {
    const options = await buildOptions(createSession("spec"));

    expect(options.disallowedTools).toEqual([
      "Edit",
      "MultiEdit",
      "NotebookEdit",
      "Write",
      "WebFetch",
      "WebSearch",
    ]);
  });

  test("passes the selected Claude effort variant to the SDK options", async () => {
    const session = createSession();
    session.input.model = {
      runtimeKind: "claude",
      providerId: "claude",
      modelId: "claude-sonnet-4-6-20260601",
      variant: "xhigh",
    };

    const options = await buildOptions(session);

    expect(options.model).toBe("claude-sonnet-4-6-20260601");
    expect(options.effort).toBe("xhigh");
  });

  test.each([
    [undefined, false],
    ["fast", true],
  ])("sets an explicit fast-mode flag for speed %p", async (speed, fastMode) => {
    const session = createSession();
    const model: AgentModelSelection = {
      runtimeKind: "claude",
      providerId: "claude",
      modelId: "claude-opus-4-6",
    };
    if (speed) model.speed = speed;
    session.input.model = model;

    const options = await buildOptions(session);

    expect<unknown>(options.settings).toEqual({ fastMode });
  });

  test("rejects a Claude effort variant that the SDK does not support", async () => {
    const session = createSession();
    session.input.model = {
      runtimeKind: "claude",
      providerId: "claude",
      modelId: "claude-sonnet-4-6-20260601",
      variant: "turbo",
    };

    await expect(buildOptions(session)).rejects.toThrow(
      "Claude Agent SDK does not support effort 'turbo'.",
    );
  });

  test("removes the session-scoped MCP token directory when the session is aborted", async () => {
    const cleanupCompleted = deferred<void>();
    const backgroundFailures: HostOperationErrorAggregate[] = [];
    const removeDirectory = rm;
    const removeSpy = spyOn(fsPromises, "rm").mockImplementation(async (path, options) => {
      await removeDirectory(path, options);
      if (String(path).includes("openducktor-claude-mcp-")) {
        cleanupCompleted.resolve();
      }
    });
    const session = createSession();
    let tokenDirectory: string | undefined;

    try {
      const options = await buildClaudeAgentSdkOptions({
        input: session.input,
        session,
        resolvedDependencies: {
          claudeExecutablePath: process.execPath,
          mcpBridgeConnection: {
            workspaceId: "workspace-1",
            hostUrl: "http://127.0.0.1:1",
            hostToken: "bridge-secret-value",
          },
          mcpCommand: [process.execPath],
        },
        serviceInput: createServiceInput({ backgroundFailures }),
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => "id",
        emit: () => {},
        sessionOptions: {},
      });
      const server = options.mcpServers?.openducktor;
      if (!server || !("env" in server)) {
        throw new Error("Expected OpenDucktor MCP server to use stdio env config.");
      }
      const tokenPath = server.env?.ODT_HOST_TOKEN_FILE;
      if (!tokenPath) {
        throw new Error("Expected a session-scoped Claude MCP token file.");
      }
      tokenDirectory = join(tokenPath, "..");
      expect(await readFile(tokenPath, "utf8")).toBe("bridge-secret-value");

      session.abortController.abort();
      await cleanupCompleted.promise;

      await expect(fsPromises.access(tokenDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      expect(backgroundFailures).toEqual([]);
    } finally {
      removeSpy.mockRestore();
      if (tokenDirectory) {
        await removeDirectory(tokenDirectory, { recursive: true, force: true });
      }
    }
  });

  test("reports abort cleanup failures through the host background failure boundary", async () => {
    const cleanupError = new Error("cleanup denied");
    const backgroundFailures: HostOperationErrorAggregate[] = [];
    const backgroundFailureReported = deferred<void>();
    const removeDirectory = rm;
    const removeSpy = spyOn(fsPromises, "rm").mockImplementation(async (path, options) => {
      if (String(path).includes("openducktor-claude-mcp-")) {
        throw cleanupError;
      }
      await removeDirectory(path, options);
    });
    const session = createSession();
    let tokenDirectory: string | undefined;

    try {
      const options = await buildClaudeAgentSdkOptions({
        input: session.input,
        session,
        resolvedDependencies: {
          claudeExecutablePath: process.execPath,
          mcpBridgeConnection: {
            workspaceId: "workspace-1",
            hostUrl: "http://127.0.0.1:1",
            hostToken: "bridge-secret-value",
          },
          mcpCommand: [process.execPath],
        },
        serviceInput: createServiceInput({
          backgroundFailures,
          onBackgroundFailure: () => backgroundFailureReported.resolve(),
        }),
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => "id",
        emit: () => {},
        sessionOptions: {},
      });
      const server = options.mcpServers?.openducktor;
      if (!server || !("env" in server)) {
        throw new Error("Expected OpenDucktor MCP server to use stdio env config.");
      }
      const tokenPath = server.env?.ODT_HOST_TOKEN_FILE;
      if (!tokenPath) {
        throw new Error("Expected a session-scoped Claude MCP token file.");
      }
      tokenDirectory = join(tokenPath, "..");

      session.abortController.abort();
      await backgroundFailureReported.promise;

      expect(backgroundFailures).toEqual([
        expect.objectContaining({
          operation: "claudeRuntime.cleanupMcpTokenDirectory",
          message: expect.stringContaining("session 'session-1'"),
          details: expect.objectContaining({
            directory: tokenDirectory,
            externalSessionId: "session-1",
          }),
        }),
      ]);
      expect(JSON.stringify(backgroundFailures)).not.toContain("bridge-secret-value");
    } finally {
      removeSpy.mockRestore();
      if (tokenDirectory) {
        await removeDirectory(tokenDirectory, { recursive: true, force: true });
      }
    }
  });
});
