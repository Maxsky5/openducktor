import { beforeEach, describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { clearAppQueryClient } from "@/lib/query-client";
import { host } from "../../shared/host";
import { executeReuseStart } from "./start-session-reuse-strategy";

const persistedSessionRecord = (
  input: {
    sessionId: string;
    externalSessionId: string;
    role: AgentSessionRecord["role"];
    scenario: AgentSessionRecord["scenario"];
    startedAt: string;
    workingDirectory: string;
    runtimeKind?: AgentSessionRecord["runtimeKind"];
    selectedModel?: AgentSessionRecord["selectedModel"];
  } & Record<string, unknown>,
): AgentSessionRecord => ({
  runtimeKind: input.runtimeKind ?? "opencode",
  sessionId: input.sessionId,
  externalSessionId: input.externalSessionId,
  role: input.role,
  scenario: input.scenario,
  startedAt: input.startedAt,
  workingDirectory: input.workingDirectory,
  selectedModel: input.selectedModel ?? null,
});

describe("agent-orchestrator/handlers/start-session-reuse-strategy", () => {
  beforeEach(async () => {
    await clearAppQueryClient();
  });

  test("hydrates and returns a persisted reusable session", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    const sessionsRef = { current: {} as Record<string, unknown> };
    let loadCalls = 0;
    host.agentSessionsList = async () => [
      persistedSessionRecord({
        sessionId: "persisted-build",
        externalSessionId: "ext-build",
        role: "build",
        scenario: "build_after_human_request_changes",
        startedAt: "2026-02-22T08:20:00.000Z",
        workingDirectory: "/tmp/repo/worktree",
      }),
    ];

    try {
      await expect(
        executeReuseStart({
          ctx: {
            repoPath: "/tmp/repo",
            taskId: "task-1",
            role: "build",
            isStaleRepoOperation: () => false,
          },
          input: {
            startMode: "reuse",
            sourceSessionId: "persisted-build",
            scenario: "build_after_human_request_changes",
          },
          deps: {
            session: {
              setSessionsById: () => {},
              sessionsRef: sessionsRef as never,
              inFlightStartsByRepoTaskRef: { current: new Map() },
              loadAgentSessions: async () => {
                loadCalls += 1;
                sessionsRef.current = {
                  "persisted-build": {
                    sessionId: "persisted-build",
                    externalSessionId: "ext-build",
                    taskId: "task-1",
                    role: "build",
                    scenario: "build_after_human_request_changes",
                    status: "idle",
                    startedAt: "2026-02-22T08:20:00.000Z",
                    runtimeKind: "opencode",
                    runtimeId: null,
                    runId: null,
                    runtimeEndpoint: "http://127.0.0.1:4444",
                    workingDirectory: "/tmp/repo/worktree",
                    messages: [],
                    draftAssistantText: "",
                    draftAssistantMessageId: null,
                    draftReasoningText: "",
                    draftReasoningMessageId: null,
                    contextUsage: null,
                    pendingPermissions: [],
                    pendingQuestions: [],
                    todos: [],
                    modelCatalog: null,
                    selectedModel: null,
                    isLoadingModelCatalog: false,
                    promptOverrides: {},
                  },
                };
              },
              persistSessionRecord: async () => {},
              attachSessionListener: () => {},
            },
            runtime: {
              adapter: {} as never,
              ensureRuntime: async () => {
                throw new Error("should not resolve runtime");
              },
              resolveBuildContinuationTarget: async () => "/tmp/repo/worktree",
            },
            task: {
              taskRef: { current: [] },
              loadTaskDocuments: async () => ({
                specMarkdown: "",
                planMarkdown: "",
                qaMarkdown: "",
              }),
              refreshTaskData: async () => {},
              sendAgentMessage: async () => {},
            },
            model: {
              loadRepoPromptOverrides: async () => ({}),
            },
          },
        }),
      ).resolves.toEqual({
        kind: "reused",
        sessionId: "persisted-build",
      });
      expect(loadCalls).toBe(1);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("rejects reuse when the build continuation target no longer matches", async () => {
    await expect(
      executeReuseStart({
        ctx: {
          repoPath: "/tmp/repo",
          taskId: "task-1",
          role: "build",
          isStaleRepoOperation: () => false,
        },
        input: {
          startMode: "reuse",
          sourceSessionId: "existing-build",
          scenario: "build_after_human_request_changes",
        },
        deps: {
          session: {
            setSessionsById: () => {},
            sessionsRef: {
              current: {
                "existing-build": {
                  sessionId: "existing-build",
                  externalSessionId: "ext-build",
                  taskId: "task-1",
                  role: "build",
                  scenario: "build_after_human_request_changes",
                  status: "idle",
                  startedAt: "2026-02-22T08:20:00.000Z",
                  runtimeKind: "opencode",
                  runtimeId: null,
                  runId: null,
                  runtimeEndpoint: "http://127.0.0.1:4444",
                  workingDirectory: "/tmp/repo/old-worktree",
                  messages: [],
                  draftAssistantText: "",
                  draftAssistantMessageId: null,
                  draftReasoningText: "",
                  draftReasoningMessageId: null,
                  contextUsage: null,
                  pendingPermissions: [],
                  pendingQuestions: [],
                  todos: [],
                  modelCatalog: null,
                  selectedModel: null,
                  isLoadingModelCatalog: false,
                  promptOverrides: {},
                },
              },
            },
            inFlightStartsByRepoTaskRef: { current: new Map() },
            loadAgentSessions: async () => {},
            persistSessionRecord: async () => {},
            attachSessionListener: () => {},
          },
          runtime: {
            adapter: {} as never,
            ensureRuntime: async () => {
              throw new Error("should not resolve runtime");
            },
            resolveBuildContinuationTarget: async () => "/tmp/repo/new-worktree",
          },
          task: {
            taskRef: { current: [] },
            loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
            refreshTaskData: async () => {},
            sendAgentMessage: async () => {},
          },
          model: {
            loadRepoPromptOverrides: async () => ({}),
          },
        },
      }),
    ).rejects.toThrow("it does not match the current builder continuation target");
  });
});
