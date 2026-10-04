import {
  type AgentSessionRecord,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createRuntimeOrchestratorService as createEffectRuntimeOrchestratorService } from "./runtime-orchestrator-service";

export const createRuntimeOrchestratorService = (
  input: Parameters<typeof createEffectRuntimeOrchestratorService>[0],
) => createEffectRuntimeOrchestratorService(input);

export const createGitPort = (
  canonicalizePath: (path: string) => string = (path) =>
    path === "/repo" ? "/canonical/repo" : path,
  isGitRepository: (path: string) => boolean = (path) => path === "/canonical/repo",
): Parameters<typeof createEffectRuntimeOrchestratorService>[0]["gitPort"] =>
  ({
    canonicalizePath(path: string) {
      return Effect.tryPromise({
        try: async () => {
          return canonicalizePath(path);
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    isGitRepository(path: string) {
      return Effect.tryPromise({
        try: async () => {
          return isGitRepository(path);
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
  }) satisfies Parameters<typeof createEffectRuntimeOrchestratorService>[0]["gitPort"];

export const createRuntimeDefinitionsService = () => ({
  listRuntimeDefinitions(): RuntimeDescriptor[] {
    return Object.values(RUNTIME_DESCRIPTORS_BY_KIND);
  },
});

export const createTaskStore = (
  sessionOverrides: Partial<{
    externalSessionId: string;
    role: "build";
    startedAt: string;
    runtimeKind: "opencode" | "codex";
    workingDirectory: string;
    selectedModel: null;
  }> = {},
  extraAgentSessions: AgentSessionRecord[] = [],
): Parameters<typeof createEffectRuntimeOrchestratorService>[0]["taskReader"] =>
  ({
    getTaskMetadata() {
      return Effect.tryPromise({
        try: async () => {
          const session = {
            externalSessionId: "external-session-1",
            role: "build" as const,
            startedAt: "2026-05-10T10:00:00.000Z",
            runtimeKind: "opencode" as const,
            workingDirectory: "/canonical/repo/worktree",
            selectedModel: null,
            ...sessionOverrides,
          };
          return {
            spec: { markdown: "" },
            plan: { markdown: "" },
            agentSessions: [session, ...extraAgentSessions],
          };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
  }) satisfies Parameters<typeof createEffectRuntimeOrchestratorService>[0]["taskReader"];

type RuntimeSessionStopper = Parameters<
  typeof createEffectRuntimeOrchestratorService
>[0]["runtimeRegistry"];

export const createSessionStopper = (
  stopSession: RuntimeSessionStopper["stopSession"] = () => Effect.void,
): RuntimeSessionStopper => ({ stopSession });
