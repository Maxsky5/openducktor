import { describe, expect, test } from "bun:test";
import type { RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import {
  RuntimeExecutableIncompatibleError,
  type RuntimeExecutableProbeError,
  type RuntimeExecutableProbesByKind,
} from "../../ports/runtime-executable-probe-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { createToolDiscoveryAdapter } from "../system/tool-discovery";
import { createRuntimeHealthProbe } from "./runtime-health-probe";

const executablePaths = {
  claude: "/usr/local/bin/claude",
  codex: "/usr/local/bin/codex",
  opencode: "/usr/local/bin/opencode",
} satisfies Record<RuntimeKind, string>;

const createSystemCommands = ({
  version = "runtime version output",
}: {
  version?: string | null;
} = {}): SystemCommandPort => ({
  resolveCommandPath(command) {
    return Effect.succeed(Object.values(executablePaths).includes(command) ? command : null);
  },
  versionCommand() {
    return Effect.succeed(version);
  },
  runCommandAllowFailure() {
    return Effect.succeed({ ok: false, stdout: "", stderr: "" });
  },
});

const createExecutableProbes = (
  probeExecutable: (
    kind: RuntimeKind,
    executablePath: string,
  ) => Effect.Effect<void, RuntimeExecutableProbeError> = () => Effect.void,
) =>
  ({
    claude: {
      probeExecutable: (executablePath) => probeExecutable("claude", executablePath),
    },
    codex: {
      probeExecutable: (executablePath) => probeExecutable("codex", executablePath),
    },
    opencode: {
      probeExecutable: (executablePath) => probeExecutable("opencode", executablePath),
    },
  }) satisfies RuntimeExecutableProbesByKind;

const createProbe = (
  systemCommands: SystemCommandPort,
  executableProbes = createExecutableProbes(),
) =>
  createRuntimeHealthProbe(
    systemCommands,
    createToolDiscoveryAdapter({ env: {}, systemCommands }),
    executableProbes,
  );

describe("createRuntimeHealthProbe", () => {
  test("reports an actionable error before probing a missing exact path", async () => {
    const calls: string[] = [];
    const systemCommands = createSystemCommands();
    const probe = createProbe(
      systemCommands,
      createExecutableProbes((_kind, executablePath) => {
        calls.push(executablePath);
        return Effect.void;
      }),
    );

    const health = await Effect.runPromise(probe.getRuntimeHealth("codex", "/missing/bin/codex"));

    expect(health.ok).toBe(false);
    expect(health.executablePath).toBe("/missing/bin/codex");
    expect(health.error).toContain("Saved Codex path points to a missing or non-executable file");
    expect(calls).toEqual([]);
  });

  test("uses the matching protocol probe and keeps version output for display", async () => {
    const calls: Array<[RuntimeKind, string]> = [];
    const systemCommands = createSystemCommands({ version: "new-format version 42" });
    const probe = createProbe(
      systemCommands,
      createExecutableProbes((kind, executablePath) => {
        calls.push([kind, executablePath]);
        return Effect.void;
      }),
    );

    const health = await Effect.runPromise(
      probe.getRuntimeHealth("claude", executablePaths.claude),
    );

    expect(health).toEqual({
      kind: "claude",
      enabled: true,
      ok: true,
      executablePath: executablePaths.claude,
      version: "new-format version 42",
      error: null,
    });
    expect(calls).toEqual([["claude", executablePaths.claude]]);
  });

  test("does not treat a successful version command as runtime identity", async () => {
    const systemCommands = createSystemCommands({ version: "edgee 0.1.7" });
    const probe = createProbe(
      systemCommands,
      createExecutableProbes((kind, executablePath) =>
        kind === "opencode"
          ? Effect.fail(
              new RuntimeExecutableIncompatibleError({
                message: `OpenCode health protocol failed for ${executablePath}.`,
              }),
            )
          : Effect.void,
      ),
    );

    const health = await Effect.runPromise(
      probe.getRuntimeHealth("opencode", executablePaths.opencode),
    );

    expect(health.ok).toBe(false);
    expect(health.version).toBeNull();
    expect(health.error).toBe(
      `The executable at ${executablePaths.opencode} is not a compatible OpenCode runtime.`,
    );
  });

  test("returns a short user-facing error when the selected executable fails its runtime protocol", async () => {
    const systemCommands = createSystemCommands({ version: "codex-cli 0.147.0" });
    const probe = createProbe(
      systemCommands,
      createExecutableProbes(() =>
        Effect.fail(
          new RuntimeExecutableIncompatibleError({
            message:
              "Claude Code process exited with code 2. stderr: \u001b[31merror: unexpected argument '--output-format' found\u001b[0m",
          }),
        ),
      ),
    );

    const health = await Effect.runPromise(
      probe.getRuntimeHealth("claude", executablePaths.claude),
    );

    expect(health.error).toBe(
      `The executable at ${executablePaths.claude} is not a compatible Claude runtime.`,
    );
    expect(health.error).not.toContain("\u001b");
    expect(health.error).not.toContain("unexpected argument");
  });

  test("propagates operational probe failures instead of reporting an incompatible runtime", async () => {
    const systemCommands = createSystemCommands({ version: "1.18.9" });
    const probe = createProbe(
      systemCommands,
      createExecutableProbes(() =>
        Effect.fail(
          new HostOperationError({
            operation: "opencodeExecutableProbe.cleanup",
            message: "Failed to stop the probe process.",
          }),
        ),
      ),
    );

    const failure = await Effect.runPromise(
      Effect.flip(probe.getRuntimeHealth("opencode", executablePaths.opencode)),
    );

    expect(failure).toMatchObject({
      _tag: "HostOperationError",
      operation: "opencodeExecutableProbe.cleanup",
      message: "Failed to stop the probe process.",
    });
  });

  test("keeps a protocol-ready runtime available when version display fails", async () => {
    const systemCommands = createSystemCommands({ version: null });
    const probe = createProbe(systemCommands);

    const health = await Effect.runPromise(probe.getRuntimeHealth("codex", executablePaths.codex));

    expect(health.ok).toBe(true);
    expect(health.version).toBeNull();
    expect(health.error).toBeNull();
  });

  test("runs version display with a short bounded timeout", async () => {
    const versionCalls: Array<Parameters<SystemCommandPort["versionCommand"]>> = [];
    const systemCommands: SystemCommandPort = {
      ...createSystemCommands(),
      versionCommand(...input) {
        versionCalls.push(input);
        return Effect.succeed("1.18.9");
      },
    };
    const probe = createProbe(systemCommands);

    await Effect.runPromise(probe.getRuntimeHealth("opencode", executablePaths.opencode));

    expect(versionCalls).toEqual([
      [
        executablePaths.opencode,
        ["--version"],
        {
          env: { OPENCODE_CONFIG_CONTENT: '{"logLevel":"INFO"}' },
          timeoutMs: 2_000,
        },
      ],
    ]);
  });
});
