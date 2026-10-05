import { RUNTIME_DESCRIPTORS_BY_KIND, type RuntimeKind } from "@openducktor/contracts";
import type {
  RuntimeDriver,
  RuntimeDrivers,
  RuntimeHandle,
  RuntimeSettings,
  RuntimeStartContext,
} from "@openducktor/runtime-orchestration";
import { Effect } from "effect";
import type { HostError } from "../effect/host-errors";

export type TestRuntimeStart = (
  kind: RuntimeKind,
  context: RuntimeStartContext,
) => Effect.Effect<RuntimeHandle, HostError>;

/** A started test runtime. `events` records each start and stop in order. */
export const testRuntimeHandle = (
  kind: RuntimeKind,
  runtimeId: string,
  events: string[] = [],
): RuntimeHandle => ({
  runtime: {
    kind,
    runtimeId,
    runtimeRoute: { type: "host_service", identity: runtimeId },
    startedAt: "2026-10-03T10:00:00.000Z",
    descriptor: RUNTIME_DESCRIPTORS_BY_KIND[kind],
  },
  configuredExecutablePath: kind,
  effectiveExecutablePath: `/bin/${kind}`,
  stop: () => Effect.sync(() => void events.push(`stop:${runtimeId}`)),
});

/** Test drivers that start through `start` and accept every executable. */
export const createTestRuntimeDrivers = (
  start: TestRuntimeStart,
  overrides: Partial<Omit<RuntimeDriver<HostError>, "descriptor" | "start">> = {},
): RuntimeDrivers<HostError> => {
  const driverFor = (kind: RuntimeKind): RuntimeDriver<HostError> => ({
    descriptor: RUNTIME_DESCRIPTORS_BY_KIND[kind],
    start: (context) => start(kind, context),
    probeVersion: () => Effect.succeed(null),
    validateExecutable: () => Effect.void,
    stopSession: () => Effect.void,
    probeSession: () => Effect.succeed({ supported: true, hasLiveSession: false }),
    ...overrides,
  });
  return {
    opencode: driverFor("opencode"),
    codex: driverFor("codex"),
    claude: driverFor("claude"),
  };
};

/** Saved runtime settings with every kind disabled, except the given ones. */
export const testRuntimeSettings = (
  enabled: Partial<Record<RuntimeKind, string>> = {},
): RuntimeSettings => ({
  opencode: { enabled: "opencode" in enabled, executablePath: enabled.opencode ?? "" },
  codex: { enabled: "codex" in enabled, executablePath: enabled.codex ?? "" },
  claude: { enabled: "claude" in enabled, executablePath: enabled.claude ?? "" },
});
