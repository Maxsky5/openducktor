import { describe, expect, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND, type RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { ProcessEnvironmentError } from "../../infrastructure/process/process-environment";
import type {
  RuntimeEnsureWorkspaceInput,
  RuntimeWorkspaceStarterPort,
} from "../../ports/runtime-registry-port";
import { createRuntimeWorkspaceStarterDispatcher } from "./runtime-workspace-starter-dispatcher";

const createStarter = (
  runtimeKind: RuntimeKind,
  calls: RuntimeKind[],
): RuntimeWorkspaceStarterPort => ({
  startWorkspaceRuntime(input) {
    calls.push(runtimeKind);
    return Effect.succeed({
      runtime: {
        kind: runtimeKind,
        runtimeId: `runtime-${runtimeKind}`,
        repoPath: input.repoPath,
        taskId: null,
        role: "workspace" as const,
        workingDirectory: input.workingDirectory,
        runtimeRoute: { type: "host_service" as const, identity: `runtime-${runtimeKind}` },
        startedAt: "2026-07-18T10:00:00.000Z",
        descriptor: input.descriptor,
      },
      configuredExecutablePath: `/tools/${input.runtimeKind}`,
      isAlive: () => true,
      stop: () => Effect.void,
    });
  },
});

describe("createRuntimeWorkspaceStarterDispatcher", () => {
  test("routes each runtime kind to its registered workspace starter", async () => {
    const calls: RuntimeKind[] = [];
    const dispatcher = createRuntimeWorkspaceStarterDispatcher({
      claude: createStarter("claude", calls),
      codex: createStarter("codex", calls),
      opencode: createStarter("opencode", calls),
    });

    for (const runtimeKind of ["claude", "codex", "opencode"] as const) {
      await Effect.runPromise(
        dispatcher.startWorkspaceRuntime({
          runtimeKind,
          repoPath: "/repo",
          workingDirectory: "/repo",
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind],
        }),
      );
    }

    expect(calls).toEqual(["claude", "codex", "opencode"]);
  });

  test("fails instead of falling back when a runtime kind is not registered", async () => {
    const dispatcher = createRuntimeWorkspaceStarterDispatcher({
      claude: createStarter("claude", []),
      codex: createStarter("codex", []),
      opencode: createStarter("opencode", []),
    });
    const input: RuntimeEnsureWorkspaceInput = {
      runtimeKind: "unknown",
      repoPath: "/repo",
      workingDirectory: "/repo",
      descriptor: RUNTIME_DESCRIPTORS_BY_KIND.claude,
    };

    await expect(Effect.runPromise(dispatcher.startWorkspaceRuntime(input))).rejects.toThrow(
      "Unsupported workspace runtime kind 'unknown'.",
    );
  });

  test("blocks every runtime when the user PATH is unavailable", async () => {
    const calls: RuntimeKind[] = [];
    const processEnvironmentError = new ProcessEnvironmentError({
      message:
        "Failed to resolve PATH from interactive login shell /bin/tcsh: the probe ended with exit code 1. Fix errors in the shell startup files and restart OpenDucktor.",
      reason: "unexpected_exit",
      shell: "/bin/tcsh",
    });
    const dispatcher = createRuntimeWorkspaceStarterDispatcher(
      {
        claude: createStarter("claude", calls),
        codex: createStarter("codex", calls),
        opencode: createStarter("opencode", calls),
      },
      processEnvironmentError,
    );

    for (const runtimeKind of ["claude", "codex", "opencode"] as const) {
      const exit = await Effect.runPromiseExit(
        dispatcher.startWorkspaceRuntime({
          runtimeKind,
          repoPath: "/repo",
          workingDirectory: "/repo",
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind],
        }),
      );

      expect(exit).toMatchObject({
        _tag: "Failure",
        cause: {
          _tag: "Fail",
          error: {
            _tag: "HostOperationError",
            operation: "runtimeWorkspace.resolveEnvironment",
            details: {
              runtimeKind,
              reason: "unexpected_exit",
              shell: "/bin/tcsh",
            },
          },
        },
      });
    }

    expect(calls).toEqual([]);
  });
});
