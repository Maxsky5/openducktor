import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRole } from "@openducktor/core";
import { Effect } from "effect";
import { createArtifactRuntimeDistribution } from "../runtimes/runtime-distribution";
import { buildClaudeAgentSdkOptions } from "./claude-agent-sdk-options";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import type {
  ClaudeSessionContext,
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
    role,
    startedAt: "2026-06-25T20:00:00.000Z",
    status: "starting",
  },
  streamAssistantMessageOrdinal: 0,
  streamAssistantMessageIdsByBlockIndex: new Map(),
  subagentMessageIdsByTaskId: new Map(),
  subagentTaskIdsByToolUseId: new Map(),
  toolInputsByCallId: new Map(),
  toolMessageIdsByCallId: new Map(),
  toolNamesByCallId: new Map(),
  toolStartedAtMsByCallId: new Map(),
  todosById: new Map(),
});

const createServiceInput = (events?: {
  resolvedBridgeRepoPaths?: string[];
}): CreateClaudeAgentSdkServiceInput => ({
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
    PATH: "/usr/bin",
  },
  runtimeDistribution: createArtifactRuntimeDistribution({
    mcpLauncher: {
      kind: "executable",
      executablePath: process.execPath,
    },
  }),
  toolDiscovery: {
    resolveTool: () => Effect.die("unused"),
    resolveToolPath: () => Effect.succeed(process.execPath),
  },
});

const buildOptions = (
  session: ClaudeSessionContext,
  events?: {
    resolvedBridgeRepoPaths?: string[];
  },
) => {
  events?.resolvedBridgeRepoPaths?.push(session.input.repoPath);
  return buildClaudeAgentSdkOptions({
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
    sessionOptions: {},
  });
};

const preToolUseHook = async (
  options: Awaited<ReturnType<typeof buildClaudeAgentSdkOptions>>,
  input: {
    permissionMode: string;
    toolInput: Record<string, unknown>;
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

describe("buildClaudeAgentSdkOptions", () => {
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
    expect(openducktorEnv).toMatchObject({
      ODT_WORKSPACE_ID: "workspace-1",
      ODT_HOST_URL: "http://127.0.0.1:1",
      ODT_FORBID_WORKSPACE_ID_INPUT: "true",
      ODT_ALLOWED_TOOLS: expect.stringContaining("odt_read_task"),
    });
    expect(openducktorEnv).not.toHaveProperty("ODT_HOST_TOKEN");
    const hostTokenFile = openducktorEnv?.ODT_HOST_TOKEN_FILE;
    expect(typeof hostTokenFile).toBe("string");
    expect(await readFile(hostTokenFile as string, "utf8")).toBe("bridge-secret-value");
    expect(JSON.stringify(options.mcpServers)).not.toContain("bridge-secret-value");
    session.abortController.abort();
    expect(options).not.toHaveProperty("managedSettings");
    expect(options).not.toHaveProperty("sandbox");
    expect(options.forwardSubagentText).toBe(true);
    expect(options.includePartialMessages).toBe(true);
    expect(options).toHaveProperty("permissionMode");
    expect(options.allowedTools).toEqual([
      "mcp__openducktor__odt_read_task",
      "mcp__openducktor__odt_read_task_documents",
      "mcp__openducktor__odt_build_blocked",
      "mcp__openducktor__odt_build_resumed",
      "mcp__openducktor__odt_build_completed",
      "mcp__openducktor__odt_set_pull_request",
    ]);
    expect(options.skills).toBe("all");
    expect(options.systemPrompt).toEqual(
      expect.stringContaining("OpenDucktor starts this Claude Code session with cwd set to"),
    );
    expect(options.systemPrompt).toEqual(expect.stringContaining("Build"));
    expect(typeof options.onUserDialog).toBe("function");
    expect(options.supportedDialogKinds).toContain("ask_user_question");
    expect(options.toolConfig).toEqual({
      askUserQuestion: { previewFormat: "markdown" },
    });
    expect(options.env).toMatchObject({
      CLAUDE_AGENT_SDK_CLIENT_APP: "openducktor",
      HOME: "/Users/openducktor-test",
    });
    expect(options.pathToClaudeCodeExecutable).toBe(process.execPath);
  });

  test("inherits Claude Code filesystem settings", async () => {
    const session = createSession();

    const options = await buildOptions(session);

    expect(options).not.toHaveProperty("settingSources");
    session.abortController.abort();
  });

  test("auto-allows every workflow tool assigned to the spec role", async () => {
    const session = createSession("spec");

    const options = await buildOptions(session);

    expect(options.allowedTools).toEqual([
      "mcp__openducktor__odt_read_task",
      "mcp__openducktor__odt_read_task_documents",
      "mcp__openducktor__odt_set_spec",
    ]);
    const openducktorServer = options.mcpServers?.openducktor;
    if (!openducktorServer || !("env" in openducktorServer)) {
      throw new Error("Expected OpenDucktor MCP server to use stdio env config.");
    }
    expect(openducktorServer.env?.ODT_ALLOWED_TOOLS).toBe(
      "odt_read_task,odt_read_task_documents,odt_set_spec",
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
    const events = { resolvedBridgeRepoPaths: [] as string[] };

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
  });

  test("inherits a trusted local default permission mode", async () => {
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
        JSON.stringify({ permissions: { defaultMode: "acceptEdits" } }),
      );

      const options = await buildOptions(session);

      expect(options.permissionMode).toBe("acceptEdits");
      expect(options).not.toHaveProperty("allowDangerouslySkipPermissions");
    } finally {
      session.abortController.abort();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("enables the SDK safety acknowledgement for a trusted local bypass mode", async () => {
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

      expect(options.permissionMode).toBe("bypassPermissions");
      expect(options.allowDangerouslySkipPermissions).toBe(true);
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

      expect(
        await preToolUseHook(options, {
          permissionMode: "bypassPermissions",
          toolName: "Write",
          toolInput: { file_path: sourcePath, content: "export {};" },
        }),
      ).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: {
            file_path: join(workingDirectory, "src", "index.ts"),
            content: "export {};",
          },
        },
      });
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
});
