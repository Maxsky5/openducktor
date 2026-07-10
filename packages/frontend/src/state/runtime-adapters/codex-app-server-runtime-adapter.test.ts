import { describe, expect, mock, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  DEFAULT_AGENT_RUNTIMES,
  DEFAULT_CODEX_RUNTIME_POLICY,
  resolveCodexEffectivePolicy,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { appQueryClient, clearAppQueryClient } from "@/lib/query-client";
import {
  configureShellBridge,
  createUnavailableShellBridge,
  type ShellBridge,
} from "@/lib/shell-bridge";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { host } from "../operations/shared/host";
import { runtimeCatalogQueryKeys } from "../queries/runtime-catalog";
import { createCodexAppServerRuntimeAdapter } from "./codex-app-server-runtime-adapter";

const createCodexRuntime = (runtimeId: string) => ({
  kind: "codex" as const,
  runtimeId,
  repoPath: "/repo",
  taskId: null,
  role: "workspace" as const,
  workingDirectory: "/repo",
  runtimeRoute: { type: "stdio" as const, identity: runtimeId },
  startedAt: "2026-02-22T09:00:00.000Z",
  descriptor: CODEX_RUNTIME_DESCRIPTOR,
});

const codexBuildRuntimePolicy = {
  kind: "codex" as const,
  policy: resolveCodexEffectivePolicy(DEFAULT_AGENT_RUNTIMES.codex, "build"),
};
const codexQaRuntimePolicy = {
  kind: "codex" as const,
  policy: resolveCodexEffectivePolicy(DEFAULT_AGENT_RUNTIMES.codex, "qa"),
};

const codexModelListResponse = {
  data: [
    {
      id: "gpt-5",
      model: "gpt-5",
      displayName: "GPT-5",
      inputModalities: ["text", "image"],
      supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balanced reasoning" }],
      isDefault: true,
    },
  ],
  nextCursor: null,
};

const configureCodexTestShellBridge = (
  overrides: Partial<Pick<ShellBridge, "subscribeCodexAppServerEvents">> = {},
): void => {
  configureShellBridge({
    client: {} as HostClient,
    subscribeRunEvents: async () => () => {},
    subscribeDevServerEvents: async () => ({
      transportEpoch: "test:0",
      unsubscribe: () => {},
    }),
    subscribeTaskEvents: async () => () => {},
    subscribeCodexAppServerEvents: async () => () => {},
    capabilities: {
      canOpenExternalUrls: true,
      canPreviewLocalAttachments: true,
    },
    openExternalUrl: async () => {},
    resolveLocalAttachmentPreviewSrc: async () => "asset://preview",
    ...overrides,
  } satisfies ShellBridge);
};

const waitForSessionIdleEvent = async (
  events: Array<{ type?: string }>,
  deadline = Date.now() + 1_000,
): Promise<void> => {
  if (events.some((event) => event.type === "session_idle") || Date.now() >= deadline) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 10));
  await waitForSessionIdleEvent(events, deadline);
};

const waitForSessionEvent = async (
  events: Array<{ type?: string }>,
  type: string,
  deadline = Date.now() + 1_000,
): Promise<void> => {
  if (events.some((event) => event.type === type) || Date.now() >= deadline) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 10));
  await waitForSessionEvent(events, type, deadline);
};

const waitForCodexEventListener = async (
  bridge: { listener?: (payload: unknown) => void },
  deadline = Date.now() + 1_000,
): Promise<(payload: unknown) => void> => {
  if (bridge.listener) {
    return bridge.listener;
  }
  if (Date.now() >= deadline) {
    throw new Error("Codex app-server event listener was not registered.");
  }

  await new Promise((resolve) => setTimeout(resolve, 10));
  return waitForCodexEventListener(bridge, deadline);
};

describe("createCodexAppServerRuntimeAdapter", () => {
  test("resolves host-managed runtime ids through the host bridge", async () => {
    await clearAppQueryClient();
    const originalRuntimeEnsure = host.runtimeEnsure;
    const originalRuntimeRequire = host.runtimeRequire;
    const originalCodexAppServerRequest = host.codexAppServerRequest;
    const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;
    const originalConsoleInfo = console.info;
    const runtimeEnsureCalls: unknown[][] = [];
    const runtimeRequireCalls: unknown[][] = [];
    const codexRequestCalls: unknown[][] = [];
    const consoleInfoCalls: unknown[][] = [];

    host.runtimeEnsure = mock(async (...args: unknown[]) => {
      runtimeEnsureCalls.push(args);
      return createCodexRuntime("runtime-codex-ensure");
    }) as typeof host.runtimeEnsure;
    host.runtimeRequire = mock(async (...args: unknown[]) => {
      runtimeRequireCalls.push(args);
      return createCodexRuntime("runtime-codex-live");
    }) as typeof host.runtimeRequire;
    host.codexAppServerRequest = mock(async (...args: unknown[]) => {
      codexRequestCalls.push(args);
      const [, method] = args as [string, string, unknown?];
      if (method === "model/list") {
        return codexModelListResponse;
      }
      if (method === "thread/start") {
        return { thread: { id: "thread-codex" }, startedAt: "2026-02-22T09:00:00.000Z" };
      }
      if (method === "thread/name/set") {
        return {};
      }
      throw new Error(`Unexpected Codex app-server request method: ${method}`);
    }) as typeof host.codexAppServerRequest;
    host.workspaceGetSettingsSnapshot = mock(async () =>
      createSettingsSnapshotFixture(),
    ) as typeof host.workspaceGetSettingsSnapshot;
    console.info = mock((...args: unknown[]) => {
      consoleInfoCalls.push(args);
    }) as typeof console.info;
    configureCodexTestShellBridge();

    try {
      const adapter = createCodexAppServerRuntimeAdapter();

      await expect(
        adapter.startSession({
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo",
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          runtimePolicy: codexQaRuntimePolicy,
          systemPrompt: "Use the repo rules.",
          model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
        }),
      ).resolves.toMatchObject({ externalSessionId: "thread-codex" });

      await expect(
        adapter.listAvailableModels({
          repoPath: "/repo",
          runtimeKind: "codex",
        }),
      ).resolves.toMatchObject({ runtime: { kind: "codex" } });

      expect(runtimeEnsureCalls).toEqual([]);
      expect(runtimeRequireCalls).toEqual([
        ["/repo", "codex"],
        ["/repo", "codex"],
      ]);
      expect(codexRequestCalls.map(([runtimeId, method]) => [runtimeId, method])).toEqual([
        ["runtime-codex-live", "model/list"],
        ["runtime-codex-live", "thread/start"],
        ["runtime-codex-live", "thread/name/set"],
      ]);
      expect(codexRequestCalls[2]?.[2]).toEqual({
        threadId: "thread-codex",
        name: "BUILD task-1",
      });
      expect(consoleInfoCalls).toContainEqual([
        "[OpenDucktor] Codex session policy",
        {
          operation: "thread/start",
          runtimeId: "runtime-codex-live",
          workingDirectory: "/repo",
          sandboxMode: codexQaRuntimePolicy.policy.sandboxMode,
          approvalPolicy: codexQaRuntimePolicy.policy.approvalPolicy,
          promptReviewer: codexQaRuntimePolicy.policy.approvalsReviewer,
          networkAccess: false,
        },
      ]);
    } finally {
      host.runtimeEnsure = originalRuntimeEnsure;
      host.runtimeRequire = originalRuntimeRequire;
      host.codexAppServerRequest = originalCodexAppServerRequest;
      host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
      console.info = originalConsoleInfo;
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("receives live app-server events from the shell bridge", async () => {
    await clearAppQueryClient();
    const originalRuntimeRequire = host.runtimeRequire;
    const originalCodexAppServerRequest = host.codexAppServerRequest;
    const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;
    const codexEventBridge: { listener?: (payload: unknown) => void } = {};
    const codexRequestCalls: unknown[][] = [];

    host.runtimeRequire = mock(async () =>
      createCodexRuntime("runtime-codex-live"),
    ) as typeof host.runtimeRequire;
    host.codexAppServerRequest = mock(async (...args: unknown[]) => {
      codexRequestCalls.push(args);
      const [, method] = args as [string, string, unknown?];
      if (method === "model/list") {
        return codexModelListResponse;
      }
      if (method === "thread/loaded/list") {
        return {
          data: ["thread-live"],
          nextCursor: null,
        };
      }
      if (method === "thread/list") {
        return {
          data: [
            {
              id: "thread-live",
              cwd: "/repo",
              createdAt: 1_778_112_000,
              status: { type: "active", activeFlags: [] },
            },
          ],
          nextCursor: null,
          backwardsCursor: null,
        };
      }
      if (method === "thread/resume") {
        return {
          thread: {
            id: "thread-live",
            cwd: "/repo",
            createdAt: 1_778_112_000,
            status: { type: "active", activeFlags: [] },
          },
          startedAt: "2026-02-22T09:00:00.000Z",
        };
      }
      throw new Error(`Unexpected Codex request '${method}'.`);
    }) as typeof host.codexAppServerRequest;
    host.workspaceGetSettingsSnapshot = mock(async () =>
      createSettingsSnapshotFixture({
        agentRuntimes: {
          ...DEFAULT_AGENT_RUNTIMES,
          codex: {
            enabled: true,
            defaults: { ...DEFAULT_CODEX_RUNTIME_POLICY },
            roleOverrides: {
              qa: {
                approvalPolicy: "untrusted",
                sandboxMode: "read-only",
                approvalsReviewer: "auto_review",
              },
            },
          },
        },
      }),
    ) as typeof host.workspaceGetSettingsSnapshot;
    configureCodexTestShellBridge({
      subscribeCodexAppServerEvents: async (listener) => {
        codexEventBridge.listener = listener;
        return () => {
          delete codexEventBridge.listener;
        };
      },
    });

    try {
      const adapter = createCodexAppServerRuntimeAdapter();
      const events: Array<{ type?: string }> = [];
      const unsubscribe = await adapter.subscribeEvents(
        {
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo",
          externalSessionId: "thread-live",
          runtimePolicy: codexBuildRuntimePolicy,
        },
        (event) => events.push(event),
      );

      expect(codexRequestCalls.find(([, method]) => method === "thread/resume")?.[2]).toEqual(
        expect.objectContaining({
          threadId: "thread-live",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox: "workspace-write",
        }),
      );

      const emitCodexEvent = await waitForCodexEventListener(codexEventBridge);
      const runtimeRef = {
        repoPath: "/repo",
        runtimeKind: "codex" as const,
        workingDirectory: "/repo",
      };
      const runtimeSkillKey = runtimeCatalogQueryKeys.repoSkills(runtimeRef);
      appQueryClient.setQueryData(runtimeSkillKey, { skills: [] });

      emitCodexEvent({
        runtimeId: "runtime-codex-live",
        kind: "server_request",
        message: { method: "item/tool/requestUserInput" },
      });
      await waitForSessionEvent(events, "session_error");
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "session_error",
          message: "Codex app-server stream event is missing receivedAt.",
        }),
      );

      emitCodexEvent({
        runtimeId: "runtime-codex-live",
        kind: "notification",
        receivedAt: "2026-02-22T09:00:01.000Z",
        message: {
          method: "turn/completed",
          params: {
            threadId: "thread-live",
            turn: { id: "turn-live", status: "completed" },
          },
        },
      });

      await waitForSessionIdleEvent(events);
      expect(events.some((event) => event.type === "session_idle")).toBe(true);

      emitCodexEvent({
        runtimeId: "runtime-codex-live",
        kind: "notification",
        receivedAt: "2026-02-22T09:00:02.000Z",
        message: {
          method: "skills/changed",
          params: { cwd: "/repo" },
        },
      });

      expect(appQueryClient.getQueryState(runtimeSkillKey)?.isInvalidated).toBe(true);
      unsubscribe();
    } finally {
      host.runtimeRequire = originalRuntimeRequire;
      host.codexAppServerRequest = originalCodexAppServerRequest;
      host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
      await clearAppQueryClient();
      configureShellBridge(createUnavailableShellBridge());
    }
  });
});
