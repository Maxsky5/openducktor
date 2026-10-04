import { describe, expect, test } from "bun:test";
import {
  type HostRuntimeStatus,
  knownRuntimeKindValues,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeKind,
  type WorkspaceRuntimeMcpObservation,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { type HostError, HostOperationError } from "../../effect/host-errors";
import { createAgentSessionRuntimeAdapterTestDouble } from "../../test-support/service-test-doubles";
import { createRuntimeMcpDiagnosticsService } from "./runtime-mcp-diagnostics-service";

const status = (kind: RuntimeKind, overrides: Partial<HostRuntimeStatus>): HostRuntimeStatus => ({
  kind,
  enabled: true,
  configuredExecutablePath: kind,
  effectiveExecutablePath: `/bin/${kind}`,
  version: null,
  state: "ready",
  trigger: "host_startup",
  runtimeId: `${kind}-runtime`,
  startedAt: "2026-10-03T10:00:00.000Z",
  updatedAt: "2026-10-03T10:00:00.000Z",
  failure: null,
  revision: 1,
  ...overrides,
});

const observation: WorkspaceRuntimeMcpObservation = {
  workingDirectory: "/repo/worktree",
  state: "connected",
  serverStatus: "connected",
  toolIds: ["openducktor_odt_read_task"],
  detail: null,
};

const createHarness = async (input: {
  statuses: Record<RuntimeKind, HostRuntimeStatus>;
  supportsMcpStatus?: ReadonlySet<RuntimeKind>;
  readMcpConnections?: Partial<
    Record<
      RuntimeKind,
      (repoPath: string) => Effect.Effect<ReadonlyArray<WorkspaceRuntimeMcpObservation>, HostError>
    >
  >;
}) => {
  const adapterRegistry = createLiveSessionAdapterRegistry();
  const reads: Array<{ kind: RuntimeKind; repoPath: string }> = [];
  for (const runtimeKind of knownRuntimeKindValues) {
    const read = input.readMcpConnections?.[runtimeKind];
    if (!read) continue;
    const runtimeId = input.statuses[runtimeKind].runtimeId ?? `${runtimeKind}-detached`;
    await Effect.runPromise(
      adapterRegistry.register(
        createAgentSessionRuntimeAdapterTestDouble(
          { runtimeId, runtimeKind },
          {
            readMcpConnections: (repoPath: string) => {
              reads.push({ kind: runtimeKind, repoPath });
              return read(repoPath);
            },
          },
        ),
      ),
    );
  }
  const supported =
    input.supportsMcpStatus ?? new Set<RuntimeKind>(["opencode", "codex", "claude"]);
  const service = createRuntimeMcpDiagnosticsService({
    checkBridge: () => Effect.dieMessage("Unexpected bridge check."),
    registry: { status: (kind) => Effect.succeed(input.statuses[kind]) },
    adapterRegistry,
    descriptorFor: (kind) => {
      const descriptor = RUNTIME_DESCRIPTORS_BY_KIND[kind];
      return {
        ...descriptor,
        capabilities: {
          ...descriptor.capabilities,
          optionalSurfaces: {
            ...descriptor.capabilities.optionalSurfaces,
            supportsMcpStatus: supported.has(kind),
          },
        },
      };
    },
    resolveRepoPath: (repoPath) => Effect.succeed(repoPath === "/alias" ? "/repo" : repoPath),
  });
  return { reads, service };
};

describe("createRuntimeMcpDiagnosticsService", () => {
  test("reports each kind from observed state without starting or connecting anything", async () => {
    const { reads, service } = await createHarness({
      statuses: {
        opencode: status("opencode", {}),
        codex: status("codex", {
          state: "error",
          runtimeId: null,
          failure: {
            trigger: "crash",
            phase: "run",
            message: "The Codex runtime stopped.",
            nextAction: "Restart the runtime from Diagnostics.",
            occurredAt: "2026-10-03T10:01:00.000Z",
          },
        }),
        claude: status("claude", {}),
      },
      supportsMcpStatus: new Set(["opencode", "codex"]),
      readMcpConnections: { opencode: () => Effect.succeed([observation]) },
    });

    const check = await Effect.runPromise(service.workspaceRuntimeMcpCheck("/alias"));

    expect(check).toEqual({
      repoPath: "/repo",
      checkedAt: expect.any(String),
      runtimes: [
        {
          kind: "opencode",
          state: "observed",
          runtimeId: "opencode-runtime",
          observations: [observation],
          detail: null,
        },
        {
          kind: "codex",
          state: "unavailable",
          runtimeId: null,
          observations: [],
          detail: "The runtime is error.",
        },
        { kind: "claude", state: "unsupported", runtimeId: null, observations: [], detail: null },
      ],
    });
    expect(reads).toEqual([{ kind: "opencode", repoPath: "/repo" }]);
  });

  test("reports not_checked when a ready runtime has no MCP connection for the workspace", async () => {
    const { service } = await createHarness({
      statuses: {
        opencode: status("opencode", {}),
        codex: status("codex", { state: "starting", runtimeId: null }),
        claude: status("claude", { state: "disabled", enabled: false, runtimeId: null }),
      },
      readMcpConnections: { opencode: () => Effect.succeed([]) },
    });

    const check = await Effect.runPromise(service.workspaceRuntimeMcpCheck("/repo"));

    expect(check.runtimes).toEqual([
      {
        kind: "opencode",
        state: "not_checked",
        runtimeId: "opencode-runtime",
        observations: [],
        detail: null,
      },
      {
        kind: "codex",
        state: "unavailable",
        runtimeId: null,
        observations: [],
        detail: "The runtime is starting.",
      },
      {
        kind: "claude",
        state: "unavailable",
        runtimeId: null,
        observations: [],
        detail: "The runtime is disabled.",
      },
    ]);
  });

  test("reports a ready runtime without an MCP reader as unsupported and a failed read as unavailable", async () => {
    const { service } = await createHarness({
      statuses: {
        opencode: status("opencode", {}),
        codex: status("codex", {}),
        claude: status("claude", { state: "disabled", enabled: false, runtimeId: null }),
      },
      supportsMcpStatus: new Set(["opencode", "codex"]),
      readMcpConnections: {
        codex: () =>
          Effect.fail(
            new HostOperationError({ operation: "test.mcp", message: "MCP status timed out." }),
          ),
      },
    });

    const check = await Effect.runPromise(service.workspaceRuntimeMcpCheck("/repo"));

    expect(check.runtimes.slice(0, 2)).toEqual([
      {
        kind: "opencode",
        state: "unsupported",
        runtimeId: "opencode-runtime",
        observations: [],
        detail: null,
      },
      {
        kind: "codex",
        state: "unavailable",
        runtimeId: "codex-runtime",
        observations: [],
        detail: "Cannot read MCP connections: MCP status timed out.",
      },
    ]);
  });
});
