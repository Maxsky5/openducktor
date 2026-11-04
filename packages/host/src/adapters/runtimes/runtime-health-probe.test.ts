import { describe, expect, test } from "bun:test";
import { knownRuntimeKindValues, type RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, HostPathAccessError } from "../../effect/host-errors";
import {
  RuntimeExecutableIncompatibleError,
  type RuntimeExecutableProbeError,
  type RuntimeExecutableProbesByKind,
} from "../../ports/runtime-executable-probe-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { createFakeOpenCodeV2 } from "../../test-support/opencode-v2-standalone";
import { createOpenCodeExecutableProbe } from "../opencode/opencode-executable-probe";
import { createToolDiscoveryAdapter } from "../system/tool-discovery";
import { createRuntimeHealthProbe } from "./runtime-health-probe";

const executablePaths = {
  claude: "/usr/local/bin/claude",
  codex: "/usr/local/bin/codex",
  opencode: "/usr/local/bin/opencode",
} satisfies Record<RuntimeKind, string>;

const versionCommandOptions = { timeoutMs: 2_000 };

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
    createToolDiscoveryAdapter({ readEnv: () => ({}), systemCommands }),
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

  test("keeps the guidance of an incompatible executable and the found version", async () => {
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
    expect(health.version).toBe("edgee 0.1.7");
    expect(health.error).toBe(`OpenCode health protocol failed for ${executablePaths.opencode}.`);
  });

  test("reports an operational probe failure with its own message and the found version", async () => {
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

    const health = await Effect.runPromise(
      probe.getRuntimeHealth("opencode", executablePaths.opencode),
    );

    expect(health).toEqual({
      kind: "opencode",
      enabled: true,
      ok: false,
      executablePath: executablePaths.opencode,
      version: "1.18.9",
      error: "Failed to stop the probe process.",
    });
  });

  test("keeps the found version when the OpenCode probe cannot start the executable", async () => {
    const fixture = await createFakeOpenCodeV2("exit");
    try {
      const versionCalls: string[] = [];
      const systemCommands: SystemCommandPort = {
        ...createSystemCommands(),
        resolveCommandPath(command) {
          return Effect.succeed(command === fixture.executablePath ? command : null);
        },
        versionCommand(command) {
          versionCalls.push(command);
          return Effect.succeed("1.18.9");
        },
      };
      const probe = createProbe(systemCommands, {
        ...createExecutableProbes(),
        opencode: createOpenCodeExecutableProbe({ startupTimeoutMs: 2_000 }),
      });

      const health = await Effect.runPromise(
        probe.getRuntimeHealth("opencode", fixture.executablePath),
      );

      expect(versionCalls).toEqual([fixture.executablePath]);
      expect(health.ok).toBe(false);
      expect(health.version).toBe("1.18.9");
      expect(health.error).toContain(
        "did not start. OpenCode stopped before it was ready: native startup failed.",
      );
      expect(health.error).toContain("or run `opencode upgrade`. Then try again.");
    } finally {
      await fixture.cleanup();
    }
  });

  test("keeps a protocol-ready runtime available when version display fails", async () => {
    const systemCommands = createSystemCommands({ version: null });
    const probe = createProbe(systemCommands);

    const health = await Effect.runPromise(probe.getRuntimeHealth("codex", executablePaths.codex));

    expect(health.ok).toBe(true);
    expect(health.version).toBeNull();
    expect(health.error).toBeNull();
  });

  test("runs version display for every runtime with a short bounded timeout", async () => {
    const versionCalls: Array<Parameters<SystemCommandPort["versionCommand"]>> = [];
    const systemCommands: SystemCommandPort = {
      ...createSystemCommands(),
      versionCommand(...input) {
        versionCalls.push(input);
        return Effect.succeed("1.18.9");
      },
    };
    const probe = createProbe(systemCommands);
    const kinds = knownRuntimeKindValues;

    await Effect.runPromise(
      Effect.all(
        kinds.map((kind) => probe.getRuntimeHealth(kind, executablePaths[kind])),
        { concurrency: 1 },
      ),
    );

    expect(versionCalls).toEqual(
      kinds.map((kind) => [executablePaths[kind], ["--version"], versionCommandOptions]),
    );
  });

  test("reads the version of a running runtime without starting a second runtime", async () => {
    const versionCalls: Array<Parameters<SystemCommandPort["versionCommand"]>> = [];
    const protocolProbes: RuntimeKind[] = [];
    const probe = createProbe(
      {
        ...createSystemCommands(),
        versionCommand(...input) {
          versionCalls.push(input);
          return Effect.succeed("codex-cli 0.160.0");
        },
      },
      createExecutableProbes((kind) => Effect.sync(() => void protocolProbes.push(kind))),
    );

    await expect(Effect.runPromise(probe.readVersion(executablePaths.codex))).resolves.toBe(
      "codex-cli 0.160.0",
    );

    expect(versionCalls).toEqual([[executablePaths.codex, ["--version"], versionCommandOptions]]);
    expect(protocolProbes).toEqual([]);
  });

  test("leaves the version unknown when the version command fails", async () => {
    const probe = createProbe({
      ...createSystemCommands(),
      versionCommand(command) {
        return Effect.fail(
          new HostPathAccessError({
            operation: "test.version",
            path: command,
            message: "The executable cannot run.",
          }),
        );
      },
    });

    await expect(Effect.runPromise(probe.readVersion(executablePaths.claude))).resolves.toBeNull();
  });
});
