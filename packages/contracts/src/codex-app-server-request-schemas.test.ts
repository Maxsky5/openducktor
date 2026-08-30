import { describe, expect, test } from "bun:test";
import { parseCodexAppServerClientRequest } from "./codex-app-server-request-schemas";
import { parseCodexAppServerRequestResult } from "./codex-app-server-result-schemas";

describe("Codex app-server 0.149 experimental request schemas", () => {
  const fullExperimentalRequests = [
    {
      method: "initialize",
      params: {
        clientInfo: { name: "openducktor", title: "OpenDucktor", version: "0.149.0" },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          mcpServerOpenaiFormElicitation: true,
          optOutNotificationMethods: ["thread/started"],
          extensions: { "openai/form": { version: "1" } },
        },
      },
    },
    {
      method: "thread/start",
      params: {
        model: "gpt-5.3-codex",
        modelProvider: "openai",
        allowProviderModelFallback: false,
        serviceTier: "priority",
        cwd: "/repo",
        runtimeWorkspaceRoots: ["/repo", "/shared"],
        approvalPolicy: "on-request",
        approvalsReviewer: "guardian_subagent",
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
                deferLoading: false,
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
      },
    },
    {
      method: "thread/resume",
      params: {
        threadId: "thread-1",
        history: [
          {
            type: "message",
            id: "message-1",
            role: "user",
            content: [{ type: "input_text", text: "Resume this thread" }],
            phase: "commentary",
            internal_chat_message_metadata_passthrough: { turn_id: "turn-1" },
          },
          {
            type: "function_call_output",
            call_id: "call-1",
            output: [
              { type: "input_text", text: "result" },
              { type: "input_image", image_url: "data:image/png;base64,abc", detail: "high" },
              { type: "encrypted_content", encrypted_content: "ciphertext" },
            ],
          },
          {
            type: "local_shell_call",
            call_id: "shell-1",
            status: "completed",
            action: {
              type: "exec",
              command: ["git", "status"],
              timeout_ms: 10_000,
              working_directory: "/repo",
              env: { CI: "1" },
              user: null,
            },
          },
        ],
        path: "/repo/.codex/session.jsonl",
        model: "gpt-5.3-codex",
        modelProvider: "openai",
        serviceTier: "priority",
        cwd: "/repo",
        runtimeWorkspaceRoots: ["/repo", "/shared"],
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: "workspace-write",
        permissions: "developer",
        config: { model_reasoning_summary: "concise" },
        baseInstructions: "Base instructions",
        developerInstructions: "Developer instructions",
        personality: "friendly",
        excludeTurns: true,
        initialTurnsPage: { limit: 25, sortDirection: "desc", itemsView: "full" },
      },
    },
    {
      method: "thread/fork",
      params: {
        threadId: "thread-1",
        lastTurnId: "turn-10",
        beforeTurnId: null,
        path: "/repo/.codex/session.jsonl",
        model: "gpt-5.3-codex",
        modelProvider: "openai",
        serviceTier: "priority",
        cwd: "/repo",
        runtimeWorkspaceRoots: ["/repo", "/shared"],
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandbox: "workspace-write",
        permissions: "developer",
        config: { model_reasoning_summary: "concise" },
        baseInstructions: "Base instructions",
        developerInstructions: "Developer instructions",
        ephemeral: false,
        threadSource: "user",
        excludeTurns: true,
        deferGoalContinuation: true,
      },
    },
    {
      method: "thread/list",
      params: {
        cursor: "cursor-1",
        limit: 50,
        sortKey: "section_position",
        sortDirection: "asc",
        modelProviders: ["openai"],
        sourceKinds: ["appServer", "subAgentThreadSpawn"],
        archived: false,
        sectionId: "section-1",
        projectId: "project-1",
        cwd: ["/repo", "/shared"],
        useStateDbOnly: true,
        searchTerm: "schema",
        parentThreadId: "parent-1",
        ancestorThreadId: null,
      },
    },
    {
      method: "skills/list",
      params: { cwds: ["/repo", "/shared"], forceReload: true },
    },
    {
      method: "turn/start",
      params: {
        threadId: "thread-1",
        clientUserMessageId: "message-1",
        input: [
          {
            type: "text",
            text: "Review @src/index.ts",
            text_elements: [{ byteRange: { start: 7, end: 20 }, placeholder: "source" }],
          },
          { type: "image", detail: "original", url: "https://example.com/image.png" },
          { type: "localImage", detail: "high", path: "/tmp/image.png" },
          { type: "audio", url: "https://example.com/audio.wav" },
          { type: "localAudio", path: "/tmp/audio.wav" },
          { type: "skill", name: "review", path: "/skills/review/SKILL.md" },
          { type: "mention", name: "index.ts", path: "/repo/src/index.ts" },
        ],
        responsesapiClientMetadata: { source: "openducktor" },
        additionalContext: {
          repository: { value: "OpenDucktor", kind: "application" },
          pasted: { value: "Untrusted text", kind: "untrusted" },
        },
        environments: [
          {
            environmentId: "environment-1",
            cwd: "/repo",
            runtimeWorkspaceRoots: ["/repo"],
          },
        ],
        cwd: "/repo",
        runtimeWorkspaceRoots: ["/repo", "/shared"],
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "externalSandbox", networkAccess: "restricted" },
        permissions: "developer",
        model: "gpt-5.3-codex",
        serviceTier: "priority",
        effort: "future-adaptive",
        summary: "detailed",
        personality: "pragmatic",
        outputSchema: { type: "object", properties: { result: { type: "string" } } },
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-5.3-codex",
            reasoning_effort: "future-collaboration",
            developer_instructions: null,
          },
        },
        multiAgentMode: "proactive",
      },
    },
    {
      method: "turn/steer",
      params: {
        threadId: "thread-1",
        clientUserMessageId: "message-2",
        input: [{ type: "audio", url: "https://example.com/steer.wav" }],
        responsesapiClientMetadata: { source: "openducktor" },
        additionalContext: {
          correction: { value: "Focus on request schemas", kind: "application" },
        },
        expectedTurnId: "turn-1",
      },
    },
  ];

  for (const request of fullExperimentalRequests) {
    test(`preserves every generated experimental field for ${request.method}`, () => {
      expect(parseCodexAppServerClientRequest(request)).toEqual(request);
    });
  }

  const removedOrInvalidFields = [
    { method: "thread/start", params: { effort: "high" } },
    { method: "thread/resume", params: { threadId: "thread-1", effort: "high" } },
    { method: "thread/fork", params: { threadId: "thread-1", effort: "high" } },
    { method: "thread/fork", params: { threadId: "thread-1", personality: "friendly" } },
    { method: "skills/list", params: { cwd: "/repo" } },
    { method: "thread/resume", params: { threadId: "thread-1", excludeTurns: null } },
    { method: "thread/fork", params: { threadId: "thread-1", ephemeral: null } },
    { method: "skills/list", params: { forceReload: null } },
  ];

  for (const request of removedOrInvalidFields) {
    test(`rejects removed or invalid ${request.method} fields`, () => {
      expect(() => parseCodexAppServerClientRequest(request)).toThrow();
    });
  }

  test("rejects invalid u32 pagination limits", () => {
    for (const limit of [-1, 1.5, 4_294_967_296]) {
      const requests = [
        { method: "model/list", params: { limit } },
        { method: "thread/list", params: { limit } },
        { method: "thread/loaded/list", params: { limit } },
        { method: "thread/turns/list", params: { threadId: "thread-1", limit } },
        {
          method: "thread/resume",
          params: { threadId: "thread-1", initialTurnsPage: { limit } },
        },
      ];
      for (const request of requests) {
        expect(() => parseCodexAppServerClientRequest(request)).toThrow();
      }
    }
  });

  test("rejects invalid usize text byte ranges", () => {
    for (const start of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        parseCodexAppServerClientRequest({
          method: "turn/start",
          params: {
            threadId: "thread-1",
            input: [
              {
                type: "text",
                text: "Review @src/index.ts",
                text_elements: [{ byteRange: { start, end: 20 }, placeholder: "source" }],
              },
            ],
          },
        }),
      ).toThrow();
    }
  });

  test("rejects invalid u64 local shell timeouts", () => {
    for (const timeout_ms of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        parseCodexAppServerClientRequest({
          method: "thread/resume",
          params: {
            threadId: "thread-1",
            history: [
              {
                type: "local_shell_call",
                call_id: "shell-1",
                status: "completed",
                action: {
                  type: "exec",
                  command: ["git", "status"],
                  timeout_ms,
                  working_directory: "/repo",
                  env: null,
                  user: null,
                },
              },
            ],
          },
        }),
      ).toThrow();
    }
  });

  test("parses model/list future reasoning efforts without later model metadata", () => {
    const response = {
      data: [
        {
          additionalSpeedTiers: [],
          availabilityNux: null,
          defaultReasoningEffort: "future-adaptive",
          defaultServiceTier: null,
          description: "Codex 0.149 model",
          displayName: "GPT-5.3 Codex",
          hidden: false,
          id: "gpt-5.3-codex",
          inputModalities: ["text", "image"],
          isDefault: true,
          model: "gpt-5.3-codex",
          serviceTiers: [],
          supportedReasoningEfforts: [
            { reasoningEffort: "future-adaptive", description: "Future reasoning" },
          ],
          supportsPersonality: true,
          upgrade: null,
          upgradeInfo: null,
        },
      ],
      nextCursor: null,
    };

    expect(parseCodexAppServerRequestResult("model/list", response)).toEqual(response);
  });

  test("rejects empty reasoning efforts", () => {
    expect(() =>
      parseCodexAppServerClientRequest({
        method: "turn/start",
        params: { threadId: "thread-1", input: [], effort: "" },
      }),
    ).toThrow();
  });

  for (const historyItem of [null, "message", 1, true]) {
    test(`rejects primitive thread/resume history item ${String(historyItem)}`, () => {
      expect(() =>
        parseCodexAppServerClientRequest({
          method: "thread/resume",
          params: { threadId: "thread-1", history: [historyItem] },
        }),
      ).toThrow();
    });
  }
});
