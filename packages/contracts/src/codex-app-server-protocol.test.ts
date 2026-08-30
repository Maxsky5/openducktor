import { describe, expect, test } from "bun:test";
import {
  CODEX_APP_SERVER_COMMAND_REQUEST_METHODS,
  CODEX_APP_SERVER_FILE_MUTATION_REQUEST_METHODS,
  CODEX_APP_SERVER_PERMISSION_REQUEST_METHODS,
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD,
  CODEX_APP_SERVER_SERVER_REQUEST_METHODS,
  type CodexAppServerClientRequest,
  type CodexAppServerCollabAgentToolCallThreadItem,
  type CodexAppServerSubAgentActivityThreadItem,
  type CodexAppServerSubAgentSource,
  type CodexAppServerSubAgentThreadSpawnSource,
  type CodexAppServerThread,
  type CodexAppServerSessionSource,
  type CodexAppServerThreadSource,
  type CodexAppServerThreadStartParams,
  isCodexAppServerCommandRequestMethod,
  isCodexAppServerFileMutationRequestMethod,
  isCodexAppServerPermissionRequestMethod,
  parseCodexAppServerClientRequest,
  parseCodexAppServerRequestResult,
} from "./codex-app-server-protocol";
import {
  codexAppServerCommandExecutionRequestApprovalParamsSchema,
  codexAppServerCurrentTimeReadResponseSchema,
  codexAppServerMcpElicitationPrimitiveSchema,
  codexAppServerMcpServerElicitationRequestParamsSchema,
  codexAppServerPermissionsRequestApprovalParamsSchema,
  codexAppServerRequestPermissionProfileSchema,
  codexAppServerThreadItemSchema,
  codexAppServerTurnSchema,
} from "./codex-app-server-protocol-schemas";
import {
  codexAppServerRuntimeNotificationSchema,
  codexAppServerRuntimeServerRequestSchema,
  codexAppServerServerRequestSchema,
} from "./codex-app-server-runtime-schemas";
import { jsonValueSchema } from "./json-types";

describe("Codex app-server protocol", () => {
  test("keeps free-form thread sources distinct from structured session sources", () => {
    const threadSource: CodexAppServerThreadSource = "user-created-thread";
    const sessionSource: CodexAppServerSessionSource = { custom: "external-runtime" };

    expect(threadSource).toBe("user-created-thread");
    expect(sessionSource).toEqual({ custom: "external-runtime" });
  });

  test("keeps subagent source aliases usable for the object variants", () => {
    const otherSource: CodexAppServerSubAgentSource = { other: "agent-control" };
    const threadSpawnSource: CodexAppServerSubAgentThreadSpawnSource = {
      parent_thread_id: "parent-thread",
      depth: 1,
      agent_path: null,
      agent_nickname: "reviewer",
      agent_role: "review",
    };
    const sessionSource: CodexAppServerSessionSource = {
      subAgent: { thread_spawn: threadSpawnSource },
    };

    expect(otherSource).toEqual({ other: "agent-control" });
    expect(sessionSource).toEqual({
      subAgent: {
        thread_spawn: threadSpawnSource,
      },
    });
  });

  test("parses fuzzy file search results using the matching response schema", () => {
    const request = {
      method: "fuzzyFileSearch",
      params: {
        query: "src",
        roots: ["/repo"],
        cancellationToken: null,
      },
    } satisfies CodexAppServerClientRequest;

    const response = {
      files: [
        {
          root: "/repo",
          path: "src/main.ts",
          match_type: "file",
          file_name: "main.ts",
          score: 9,
          indices: [0, 1, 2],
        },
      ],
    };

    expect(jsonValueSchema.safeParse(request.params).success).toBe(true);
    expect(parseCodexAppServerRequestResult(request.method, response)).toEqual(response);
  });

  test("rejects JSON-valid fuzzy file search results that do not match the response schema", () => {
    const invalidResponse = {
      files: [
        {
          root: "/repo",
          path: "src/main.ts",
          match_type: "file",
          file_name: "main.ts",
          score: "9.75",
          indices: null,
        },
      ],
    };

    expect(jsonValueSchema.safeParse(invalidResponse).success).toBe(true);
    expect(() => parseCodexAppServerRequestResult("fuzzyFileSearch", invalidResponse)).toThrow();
    for (const score of [-1, 1.5, 4_294_967_296]) {
      expect(() =>
        parseCodexAppServerRequestResult("fuzzyFileSearch", {
          files: [{ ...invalidResponse.files[0], score, indices: [0] }],
        }),
      ).toThrow();
    }
    expect(() =>
      parseCodexAppServerRequestResult("fuzzyFileSearch", {
        files: [{ ...invalidResponse.files[0], score: 1, indices: [-1] }],
      }),
    ).toThrow();
  });

  test("normalizes nullable Codex skill interface fields", () => {
    expect(
      parseCodexAppServerRequestResult("skills/list", {
        data: [
          {
            cwd: "/repo",
            errors: [],
            skills: [
              {
                name: "review",
                path: "/skills/review/SKILL.md",
                scope: "repo",
                description: "Review changes",
                enabled: true,
                interface: {
                  displayName: "Review",
                  shortDescription: null,
                  iconSmall: null,
                  iconLarge: null,
                  iconSmallUrl: null,
                  iconLargeUrl: null,
                  brandColor: null,
                  defaultPrompt: null,
                },
              },
            ],
          },
        ],
      }),
    ).toEqual({
      data: [
        {
          cwd: "/repo",
          errors: [],
          skills: [
            {
              name: "review",
              path: "/skills/review/SKILL.md",
              scope: "repo",
              description: "Review changes",
              enabled: true,
              interface: {
                displayName: "Review",
                iconSmallUrl: null,
                iconLargeUrl: null,
              },
            },
          ],
        },
      ],
    });
  });

  test("parses every experimental thread/start field", () => {
    const params = {
      model: "gpt-5",
      modelProvider: "openai",
      allowProviderModelFallback: true,
      serviceTier: "priority",
      cwd: "/repo",
      runtimeWorkspaceRoots: ["/repo", "/shared"],
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      permissions: "developer",
      config: { model_reasoning_summary: "concise" },
      serviceName: "openducktor",
      baseInstructions: "Base instructions",
      developerInstructions: "Developer instructions",
      personality: "pragmatic",
      multiAgentMode: { custom: "delegate reviews" },
      ephemeral: false,
      historyMode: "paginated",
      sessionStartSource: "startup",
      threadSource: "user",
      projectId: "project-1",
      environments: [
        {
          environmentId: "environment-1",
          cwd: "/repo",
          runtimeWorkspaceRoots: ["/repo"],
        },
      ],
      dynamicTools: [
        {
          type: "function",
          name: "search",
          description: "Search the repository",
          inputSchema: { type: "object" },
          deferLoading: true,
        },
        {
          type: "namespace",
          name: "repo",
          description: "Repository tools",
          tools: [
            {
              type: "function",
              name: "read",
              description: "Read a file",
              inputSchema: { type: "object" },
            },
          ],
        },
      ],
      selectedCapabilityRoots: [
        {
          id: "root-1",
          location: { type: "environment", environmentId: "environment-1", path: "/repo" },
        },
      ],
      mockExperimentalField: "enabled",
      experimentalRawEvents: true,
    } satisfies CodexAppServerThreadStartParams;

    expect(parseCodexAppServerClientRequest({ method: "thread/start", params })).toEqual({
      method: "thread/start",
      params,
    });
  });

  test("exposes the Codex server request methods from the upstream protocol", () => {
    expect(CODEX_APP_SERVER_SERVER_REQUEST_METHODS).toEqual([
      "account/chatgptAuthTokens/refresh",
      "applyPatchApproval",
      "attestation/generate",
      "currentTime/read",
      "execCommandApproval",
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/permissions/requestApproval",
      "item/tool/call",
      "item/tool/requestUserInput",
      "mcpServer/elicitation/request",
    ]);
  });

  test("requires the Codex thread id for current time requests", () => {
    const request = {
      id: "current-time-1",
      method: "currentTime/read",
      params: { threadId: "thread-1" },
    };

    expect(codexAppServerServerRequestSchema.safeParse(request).success).toBe(true);
    expect(
      codexAppServerServerRequestSchema.safeParse({
        ...request,
        params: {},
      }).success,
    ).toBe(false);
    expect(
      codexAppServerCurrentTimeReadResponseSchema.safeParse({ currentTimeAt: 1_787_349_164 })
        .success,
    ).toBe(true);
    expect(
      codexAppServerMcpServerElicitationRequestParamsSchema.safeParse({
        threadId: "thread-1",
        turnId: "turn-1",
        serverName: "openducktor",
        mode: "form",
        _meta: null,
        message: "Select targets",
        requestedSchema: {
          type: "object",
          properties: {
            scope: {
              type: "string",
              oneOf: [
                { const: "repo", title: "Repository" },
                { const: "workspace", title: "Workspace" },
              ],
            },
            checks: {
              type: "array",
              minItems: 1,
              items: { type: "string", enum: ["lint", "test"] },
              default: ["lint"],
            },
          },
          required: ["scope"],
        },
      }).success,
    ).toBe(true);
    expect(
      codexAppServerMcpServerElicitationRequestParamsSchema.safeParse({
        threadId: "thread-1",
        turnId: "turn-1",
        serverName: "openducktor",
        mode: "form",
        _meta: null,
        message: "Invalid form",
        requestedSchema: {
          type: "object",
          properties: { scope: { arbitrary: true } },
        },
      }).success,
    ).toBe(false);
    expect(
      codexAppServerCurrentTimeReadResponseSchema.safeParse({ currentTimeAt: 1_787_349_164.5 })
        .success,
    ).toBe(false);
  });

  test("exposes command approval methods separately from mutation methods", () => {
    expect(CODEX_APP_SERVER_COMMAND_REQUEST_METHODS).toEqual([
      CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL,
      CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
    ]);
    expect(isCodexAppServerCommandRequestMethod("execCommandApproval")).toBe(true);
    expect(isCodexAppServerCommandRequestMethod("item/commandExecution/requestApproval")).toBe(
      true,
    );
    expect(isCodexAppServerCommandRequestMethod("item/permissions/requestApproval")).toBe(false);
  });

  test("classifies file mutation and permission request approval methods", () => {
    expect(CODEX_APP_SERVER_FILE_MUTATION_REQUEST_METHODS).toEqual([
      CODEX_APP_SERVER_SERVER_REQUEST_METHOD.APPLY_PATCH_APPROVAL,
      CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_FILE_CHANGE_REQUEST_APPROVAL,
    ]);
    expect(CODEX_APP_SERVER_PERMISSION_REQUEST_METHODS).toEqual([
      CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_PERMISSIONS_REQUEST_APPROVAL,
    ]);
    expect(isCodexAppServerFileMutationRequestMethod("applyPatchApproval")).toBe(true);
    expect(isCodexAppServerFileMutationRequestMethod("item/fileChange/requestApproval")).toBe(true);
    expect(isCodexAppServerFileMutationRequestMethod("item/permissions/requestApproval")).toBe(
      false,
    );
    expect(isCodexAppServerPermissionRequestMethod("item/permissions/requestApproval")).toBe(true);
    expect(isCodexAppServerPermissionRequestMethod("item/tool/requestUserInput")).toBe(false);
  });

  test("recognizes complete permission profiles without treating partial shapes as valid", () => {
    expect(
      codexAppServerRequestPermissionProfileSchema.safeParse({
        network: null,
        fileSystem: {
          read: ["/repo"],
          write: null,
          entries: [{ path: { type: "path", path: "/repo" }, access: "read" }],
        },
      }).success,
    ).toBe(true);
    expect(codexAppServerRequestPermissionProfileSchema.safeParse({ network: null }).success).toBe(
      false,
    );
    expect(
      codexAppServerRequestPermissionProfileSchema.safeParse({
        network: null,
        fileSystem: {
          read: null,
          write: null,
          entries: [{ path: {}, access: "read" }],
        },
      }).success,
    ).toBe(false);
    for (const globScanMaxDepth of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        codexAppServerRequestPermissionProfileSchema.safeParse({
          network: null,
          fileSystem: { read: null, write: null, globScanMaxDepth },
        }).success,
      ).toBe(false);
    }
  });

  test("matches Codex MCP elicitation integer widths", () => {
    const request = {
      threadId: "thread-1",
      turnId: "turn-1",
      serverName: "openducktor",
      mode: "form",
      _meta: null,
      message: "Provide values",
      requestedSchema: { type: "object", properties: {} },
    } as const;
    const requestedSchema = {
      type: "object",
      properties: { label: { type: "string", minLength: 4_294_967_295 } },
    } as const;

    expect(
      codexAppServerMcpServerElicitationRequestParamsSchema.safeParse({
        ...request,
        requestedSchema,
      }).success,
    ).toBe(true);
    expect(
      codexAppServerMcpServerElicitationRequestParamsSchema.safeParse({
        ...request,
        requestedSchema: {
          ...requestedSchema,
          properties: { label: { type: "string", minLength: 4_294_967_296 } },
        },
      }).success,
    ).toBe(false);
    expect(
      codexAppServerMcpServerElicitationRequestParamsSchema.safeParse({
        ...request,
        requestedSchema: {
          ...requestedSchema,
          properties: {
            labels: {
              type: "array",
              minItems: Number.MAX_SAFE_INTEGER + 1,
              items: { type: "string", enum: ["one"] },
            },
          },
        },
      }).success,
    ).toBe(false);
  });

  test("preserves strict Codex MCP elicitation enum variants", () => {
    const legacyEnum = {
      type: "string",
      enum: ["repo", "workspace"],
      enumNames: ["Repository", "Workspace"],
    } as const;
    const titledEnum = {
      type: "string",
      oneOf: [
        { const: "repo", title: "Repository" },
        { const: "workspace", title: "Workspace" },
      ],
    } as const;

    expect(codexAppServerMcpElicitationPrimitiveSchema.parse(legacyEnum)).toEqual(legacyEnum);
    expect(codexAppServerMcpElicitationPrimitiveSchema.parse(titledEnum)).toEqual(titledEnum);
    expect(
      codexAppServerMcpElicitationPrimitiveSchema.safeParse({
        type: "string",
        oneOf: titledEnum.oneOf,
        unsupported: true,
      }).success,
    ).toBe(false);
  });

  test("requires the upstream v2 permission approval fields", () => {
    const params = {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      environmentId: null,
      startedAtMs: 1,
      cwd: "/repo",
      reason: null,
      permissions: {
        network: null,
        fileSystem: null,
      },
    };
    const { environmentId: _, ...withoutEnvironmentId } = params;
    const { reason: __, ...withoutReason } = params;

    expect(codexAppServerPermissionsRequestApprovalParamsSchema.safeParse(params).success).toBe(
      true,
    );
    expect(
      codexAppServerPermissionsRequestApprovalParamsSchema.safeParse(withoutEnvironmentId).success,
    ).toBe(false);
    expect(
      codexAppServerPermissionsRequestApprovalParamsSchema.safeParse(withoutReason).success,
    ).toBe(false);
    expect(
      codexAppServerPermissionsRequestApprovalParamsSchema.safeParse({
        ...params,
        startedAtMs: 1.5,
      }).success,
    ).toBe(false);
  });

  test("validates upstream command approval policy fields", () => {
    const params = {
      itemId: "item-1",
      environmentId: null,
      startedAtMs: 1,
      threadId: "thread-1",
      turnId: "turn-1",
      networkApprovalContext: { host: "example.com", protocol: "https" },
      proposedExecpolicyAmendment: ["git", "status"],
      proposedNetworkPolicyAmendments: [{ host: "example.com", action: "allow" }],
    };

    expect(
      codexAppServerCommandExecutionRequestApprovalParamsSchema.safeParse(params).success,
    ).toBe(true);
    expect(
      codexAppServerCommandExecutionRequestApprovalParamsSchema.safeParse({
        ...params,
        networkApprovalContext: ["https"],
      }).success,
    ).toBe(false);
    expect(
      codexAppServerCommandExecutionRequestApprovalParamsSchema.safeParse({
        ...params,
        proposedExecpolicyAmendment: ["git", 1],
      }).success,
    ).toBe(false);
    expect(
      codexAppServerCommandExecutionRequestApprovalParamsSchema.safeParse({
        ...params,
        proposedNetworkPolicyAmendments: [{ host: "example.com", action: "prompt" }],
      }).success,
    ).toBe(false);
    expect(
      codexAppServerCommandExecutionRequestApprovalParamsSchema.safeParse({
        ...params,
        startedAtMs: 1.5,
      }).success,
    ).toBe(false);
  });

  test("accepts only current Codex app-server request methods", () => {
    expect(
      codexAppServerRuntimeServerRequestSchema.safeParse({
        id: 1,
        method: "approval/request",
        params: { threadId: "thread-1", turnId: "turn-1", tool: "network" },
      }).success,
    ).toBe(false);
    expect(
      codexAppServerRuntimeServerRequestSchema.safeParse({
        id: 2,
        method: "item/commandExecution/requestApproval",
        params: { itemId: "item-1", threadId: "thread-1", turnId: "turn-1" },
      }).success,
    ).toBe(false);
  });

  test("matches Codex Rust integer wire fields", () => {
    expect(
      codexAppServerRuntimeServerRequestSchema.safeParse({
        id: 1.5,
        method: "attestation/generate",
        params: {},
      }).success,
    ).toBe(false);
    expect(
      codexAppServerRuntimeServerRequestSchema.safeParse({
        id: 1,
        method: "item/tool/requestUserInput",
        params: {
          autoResolutionMs: -1,
          isBlocking: true,
          itemId: "item-1",
          questions: [],
          threadId: "thread-1",
          turnId: "turn-1",
        },
      }).success,
    ).toBe(false);
    expect(
      codexAppServerRuntimeNotificationSchema.safeParse({
        method: "item/reasoning/textDelta",
        params: {
          contentIndex: 0.5,
          delta: "reasoning",
          itemId: "item-1",
          threadId: "thread-1",
          turnId: "turn-1",
        },
      }).success,
    ).toBe(false);
    const commandExecutionItem = {
      type: "commandExecution",
      id: "command-1",
      pluginId: null,
      scriptPath: null,
      command: "git status",
      cwd: "/repo",
      processId: null,
      source: "agent",
      status: "completed",
      commandActions: [],
      aggregatedOutput: "",
      exitCode: 0,
      durationMs: 1,
    } as const;
    expect(codexAppServerThreadItemSchema.safeParse(commandExecutionItem).success).toBe(true);
    expect(
      codexAppServerThreadItemSchema.safeParse({ ...commandExecutionItem, exitCode: 0.5 }).success,
    ).toBe(false);
    expect(
      codexAppServerThreadItemSchema.safeParse({
        ...commandExecutionItem,
        exitCode: 2_147_483_648,
      }).success,
    ).toBe(false);
    expect(
      codexAppServerThreadItemSchema.safeParse({ ...commandExecutionItem, durationMs: 1.5 })
        .success,
    ).toBe(false);
    expect(
      codexAppServerThreadItemSchema.safeParse({
        type: "sleep",
        id: "sleep-1",
        durationMs: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
    const agentMessageItem = {
      type: "agentMessage",
      id: "message-1",
      text: "Done",
      phase: "final_answer",
      memoryCitation: {
        entries: [{ path: "src/index.ts", lineStart: 1, lineEnd: 2, note: "source" }],
        threadIds: [],
      },
    } as const;
    expect(codexAppServerThreadItemSchema.safeParse(agentMessageItem).success).toBe(true);
    expect(
      codexAppServerThreadItemSchema.safeParse({
        ...agentMessageItem,
        memoryCitation: {
          ...agentMessageItem.memoryCitation,
          entries: [{ ...agentMessageItem.memoryCitation.entries[0], lineStart: -1 }],
        },
      }).success,
    ).toBe(false);
    const turn = {
      completedAt: null,
      durationMs: null,
      error: {
        message: "Unavailable",
        codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 503 } },
        additionalDetails: null,
      },
      id: "turn-1",
      items: [],
      itemsView: "full",
      startedAt: 1,
      status: "failed",
    } as const;
    expect(codexAppServerTurnSchema.safeParse(turn).success).toBe(true);
    expect(
      codexAppServerTurnSchema.safeParse({
        ...turn,
        error: {
          ...turn.error,
          codexErrorInfo: { httpConnectionFailed: { httpStatusCode: -1 } },
        },
      }).success,
    ).toBe(false);
    expect(
      codexAppServerTurnSchema.safeParse({
        ...turn,
        error: {
          ...turn.error,
          codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 65_536 } },
        },
      }).success,
    ).toBe(false);
  });

  test("parses the supported turn diff notification payload", () => {
    expect(
      codexAppServerRuntimeNotificationSchema.parse({
        method: "turn/diff/updated",
        params: { threadId: "thread-1", turnId: "turn-1", diff: "--- a/file\n+++ b/file" },
      }),
    ).toEqual({
      method: "turn/diff/updated",
      params: { threadId: "thread-1", turnId: "turn-1", diff: "--- a/file\n+++ b/file" },
    });
  });

  test("accepts known unconsumed notifications without weakening consumed payloads", () => {
    expect(
      codexAppServerRuntimeNotificationSchema.safeParse({
        method: "item/commandExecution/outputDelta",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          delta: "output",
        },
      }).success,
    ).toBe(true);
    expect(
      codexAppServerRuntimeNotificationSchema.safeParse({
        method: "turn/started",
        params: { threadId: "thread-1", turn: null },
      }).success,
    ).toBe(false);
    expect(
      codexAppServerRuntimeNotificationSchema.safeParse({
        method: "future/unknown",
        params: { threadId: "thread-1" },
      }).success,
    ).toBe(true);
  });

  test("validates the exact legacy file-change approval payload", () => {
    const request = {
      id: 1,
      method: "applyPatchApproval",
      params: {
        callId: "call-1",
        conversationId: "thread-1",
        fileChanges: {
          "src/new.ts": { type: "add", content: "export const value = 1;" },
          "src/old.ts": { type: "delete", content: "old" },
          "src/moved.ts": {
            type: "update",
            unified_diff: "@@ -1 +1 @@",
            move_path: "src/renamed.ts",
          },
        },
        grantRoot: null,
        reason: null,
      },
    };

    expect(codexAppServerRuntimeServerRequestSchema.safeParse(request).success).toBe(true);
    expect(
      codexAppServerRuntimeServerRequestSchema.safeParse({
        ...request,
        params: {
          ...request.params,
          fileChanges: { "src/new.ts": { type: "add" } },
        },
      }).success,
    ).toBe(false);
  });

  test("rejects incomplete Codex response and notification payloads", () => {
    expect(() =>
      parseCodexAppServerRequestResult("turn/start", {
        turn: {
          id: "turn-1",
          items: [],
          itemsView: "full",
          status: {},
          error: null,
          startedAt: 1,
          completedAt: null,
          durationMs: null,
        },
      }),
    ).toThrow();
    expect(() =>
      parseCodexAppServerRequestResult("model/list", {
        data: [
          {
            id: "gpt-5",
            model: "gpt-5",
            displayName: "GPT-5",
            description: "Model",
            hidden: false,
            supportedReasoningEfforts: [],
            defaultReasoningEffort: "medium",
            inputModalities: ["text"],
            supportsPersonality: true,
            additionalSpeedTiers: [],
            serviceTiers: [],
            isDefault: true,
            upgrade: null,
            upgradeInfo: null,
            availabilityNux: null,
          },
        ],
        nextCursor: null,
      }),
    ).toThrow();
    expect(() =>
      parseCodexAppServerRequestResult("skills/list", {
        data: [{ cwd: "/repo", skills: [{ name: "review", path: "/skill" }] }],
      }),
    ).toThrow();
    expect(
      codexAppServerRuntimeNotificationSchema.safeParse({
        method: "item/started",
        params: { threadId: "thread-1", turnId: "turn-1", item: {} },
      }).success,
    ).toBe(false);
  });

  test("recognizes Codex MCP server elicitation request params", () => {
    expect(
      codexAppServerMcpServerElicitationRequestParamsSchema.safeParse({
        threadId: "thread-1",
        turnId: "turn-1",
        serverName: "openducktor",
        mode: "form",
        _meta: { codex_approval_kind: "mcp_tool_call" },
        message: 'Allow openducktor to run tool "odt_read_task"?',
        requestedSchema: { type: "object", properties: {} },
      }).success,
    ).toBe(true);
    expect(
      codexAppServerMcpServerElicitationRequestParamsSchema.safeParse({
        threadId: "thread-1",
        turnId: "turn-1",
        serverName: "openducktor",
        mode: "form",
        _meta: undefined,
        message: "Allow request?",
        requestedSchema: { type: "object", properties: {} },
      }).success,
    ).toBe(false);
  });

  test("represents Codex subagent thread metadata from the app-server protocol", () => {
    const thread = {
      id: "child-thread",
      extra: {},
      sessionId: "session-tree",
      forkedFromId: null,
      parentThreadId: "parent-thread",
      preview: "Review the code",
      ephemeral: false,
      section: {
        id: "section-1",
        name: "Review",
        appearance: { icon: "search", color: "blue" },
      },
      sectionEnteredAt: 2,
      projectId: "project-1",
      historyMode: "paginated",
      modelProvider: "openai",
      createdAt: 1,
      updatedAt: 2,
      recencyAt: 2,
      status: { type: "idle" },
      path: null,
      cwd: "/repo",
      cliVersion: "0.0.0",
      source: {
        subAgent: {
          thread_spawn: {
            parent_thread_id: "parent-thread",
            depth: 1,
            agent_path: null,
            agent_nickname: "reviewer",
            agent_role: "review",
          },
        },
      },
      canAcceptDirectInput: true,
      threadSource: "subagent",
      agentNickname: "reviewer",
      agentRole: "review",
      gitInfo: { sha: "abc123", branch: "main", originUrl: "git@example.com:repo.git" },
      name: null,
      turns: [],
    } satisfies CodexAppServerThread;

    const { historyMode: _, ...withoutHistoryMode } = thread;

    expect(parseCodexAppServerRequestResult("thread/read", { thread })).toEqual({ thread });
    expect(() =>
      parseCodexAppServerRequestResult("thread/read", {
        thread: {
          ...thread,
          source: {
            subAgent: {
              thread_spawn: { ...thread.source.subAgent.thread_spawn, depth: 1.5 },
            },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      parseCodexAppServerRequestResult("thread/read", {
        thread: { ...thread, createdAt: 1.5 },
      }),
    ).toThrow();
    expect(() =>
      parseCodexAppServerRequestResult("thread/read", { thread: withoutHistoryMode }),
    ).toThrow();
    expect(thread.parentThreadId).toBe("parent-thread");
    expect(thread.source).toEqual({
      subAgent: {
        thread_spawn: {
          parent_thread_id: "parent-thread",
          depth: 1,
          agent_path: null,
          agent_nickname: "reviewer",
          agent_role: "review",
        },
      },
    });

    const launchResult = {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      activePermissionProfile: { id: ":workspace", extends: null },
      cwd: "/repo",
      instructionSources: ["/repo/AGENTS.md"],
      model: "gpt-5",
      modelProvider: "openai",
      multiAgentMode: "explicitRequestOnly",
      reasoningEffort: "high",
      runtimeWorkspaceRoots: ["/repo"],
      sandbox: {
        type: "workspaceWrite",
        excludeSlashTmp: false,
        excludeTmpdirEnvVar: false,
        networkAccess: false,
        writableRoots: ["/repo"],
      },
      serviceTier: null,
      thread,
    } as const;

    expect(parseCodexAppServerRequestResult("thread/start", launchResult)).toEqual(launchResult);
    const resumeResult = {
      ...launchResult,
      initialTurnsPage: { data: [], nextCursor: null, backwardsCursor: null },
      turnsBackwardsCursor: null,
      itemsBackwardsCursor: null,
    };
    expect(parseCodexAppServerRequestResult("thread/resume", resumeResult)).toEqual(resumeResult);
    expect(() =>
      parseCodexAppServerRequestResult("thread/start", {
        ...launchResult,
        runtimeWorkspaceRoots: undefined,
      }),
    ).toThrow();
  });

  test("represents Codex collab and subagent activity thread items", () => {
    const collabItem = {
      type: "collabAgentToolCall",
      id: "collab-1",
      tool: "wait",
      status: "failed",
      senderThreadId: "parent-thread",
      receiverThreadIds: ["child-failed"],
      prompt: null,
      model: null,
      reasoningEffort: null,
      agentsStates: { "child-failed": { status: "errored", message: null } },
    } satisfies CodexAppServerCollabAgentToolCallThreadItem;
    const activityItem = {
      type: "subAgentActivity",
      id: "activity-1",
      kind: "interrupted",
      agentThreadId: "child-failed",
      agentPath: "/root/worker",
    } satisfies CodexAppServerSubAgentActivityThreadItem;

    expect(collabItem.agentsStates["child-failed"]?.status).toBe("errored");
    expect(activityItem.agentThreadId).toBe("child-failed");
  });
});
