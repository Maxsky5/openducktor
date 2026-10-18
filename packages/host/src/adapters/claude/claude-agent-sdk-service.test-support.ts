import { Effect } from "effect";
import { createArtifactRuntimeDistribution } from "../runtimes/runtime-distribution";
import { createClaudeAgentSdkService } from "./claude-agent-sdk-service";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
import type {
  ClaudeAgentSdkEventEmitter,
  ClaudeSession,
  ClaudeSessionStore,
} from "./claude-agent-sdk-types";

export const createClaudeServiceFixture = (
  session: ClaudeSession | null,
  emit?: ClaudeAgentSdkEventEmitter,
  existingSessionStore?: ClaudeSessionStore,
  overrides: Partial<Parameters<typeof createClaudeAgentSdkService>[0]> = {},
) => {
  const sessionStore =
    existingSessionStore ??
    createClaudeAgentSdkSessionStore({
      now: () => "2026-06-25T20:00:00.000Z",
    });
  if (session) {
    sessionStore.set(session);
  }
  const serviceInput: Parameters<typeof createClaudeAgentSdkService>[0] = {
    claudeExecutablePath: process.execPath,
    fileSearch: { dispose: () => {}, prewarm: () => {}, release: () => {}, search: async () => [] },
    now: () => "2026-06-25T20:00:00.000Z",
    launchPolicy: {
      resolve: () => Effect.succeed({}),
    },
    onBackgroundFailure: () => Effect.void,
    resolveMcpBridgeConnection: () => {
      throw new Error("unused");
    },
    runtimeDistribution: createArtifactRuntimeDistribution({
      mcpLauncher: {
        kind: "executable",
        executablePath: process.execPath,
      },
    }),
    sessionStore,
    toolDiscovery: {
      discoverTool: () => Effect.die("unused"),
      resolveTool: () => Effect.die("unused"),
      resolveToolPath: (toolId) =>
        toolId === "claude" ? Effect.succeed(process.execPath) : Effect.die("unused"),
      validateToolPath: (toolId, executablePath) =>
        toolId === "claude" && executablePath === process.execPath
          ? Effect.succeed({
              displayLabel: "Saved path",
              path: executablePath,
              sourceCategory: "provided_path" as const,
            })
          : Effect.die("unused"),
    },
    ...overrides,
  };
  if (emit) {
    serviceInput.emit = emit;
  }
  return createClaudeAgentSdkService(serviceInput);
};
