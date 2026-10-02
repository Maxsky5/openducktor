import type { RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  errorMessage,
  HostDependencyError,
  HostInvariantError,
  HostOperationError,
  toHostOperationError,
} from "../../effect/host-errors";
import {
  DevServerProcessStartExitError,
  devServerExitMessage,
  type DevServerProcessHandle,
  type DevServerProcessPort,
} from "../../ports/dev-server-process-port";
import type {
  TerminalOutputSource,
  TerminalOutputSourcePort,
} from "../../ports/terminal-output-source-port";
import { TerminalPtyError } from "../../ports/terminal-pty-port";
import { stopScriptProcessHandle, type UpdateScriptState } from "./dev-server-runtime-scripts";
import {
  DEV_SERVER_CLICOLOR_FORCE,
  DEV_SERVER_COLORTERM,
  DEV_SERVER_FORCE_COLOR,
  DEV_SERVER_TERM,
  formatTerminalSystemMessage,
  nowIso,
  type DevServerGroupRuntime,
} from "./dev-server-state";

export const createDevServerScriptStarter = ({
  processPort,
  terminalSources,
  updateScriptState,
}: {
  processPort: DevServerProcessPort | undefined;
  terminalSources: TerminalOutputSourcePort | undefined;
  updateScriptState: UpdateScriptState;
}) => {
  const outputEncoder = new TextEncoder();
  const writeSystemMessage = (
    runtime: DevServerGroupRuntime,
    scriptId: string,
    message: string,
  ): void => {
    const output = runtime.terminalOutputs.get(scriptId);
    if (!output)
      throw new HostInvariantError({
        invariant: "dev_server_terminal_source_known",
        message: `Dev server script has no terminal output source: ${scriptId}`,
      });
    output.write(outputEncoder.encode(formatTerminalSystemMessage(message)));
  };
  const markStartFailed = (
    runtime: DevServerGroupRuntime,
    scriptId: string,
    message: string,
    exitCode: number | null = null,
  ): void => {
    updateScriptState(runtime, scriptId, (script) => {
      script.status = "failed";
      script.pid = null;
      script.startedAt = null;
      script.exitCode = exitCode;
      script.lastError = message;
    });
    writeSystemMessage(runtime, scriptId, message);
  };
  const handleProcessExit = (
    runtime: DevServerGroupRuntime,
    scriptId: string,
    output: TerminalOutputSource,
    pid: number,
    exitCode: number | null,
    signal: string | null,
    error: string | null,
  ): void => {
    const script = runtime.state.scripts.find((candidate) => candidate.scriptId === scriptId);
    const isStartingWithoutRecordedPid = script?.pid === null && script.status === "starting";
    if (
      !script ||
      runtime.terminalOutputs.get(scriptId) !== output ||
      (script.pid !== pid && !isStartingWithoutRecordedPid)
    ) {
      return;
    }
    runtime.processes.delete(scriptId);
    runtime.unresolvedStops.delete(scriptId);
    const expectedStop = script.status === "stopping";
    const message = error ?? devServerExitMessage(exitCode, signal);
    if (!expectedStop) {
      writeSystemMessage(runtime, scriptId, message);
    }
    updateScriptState(runtime, scriptId, (state) => {
      state.pid = null;
      state.startedAt = null;
      state.exitCode = exitCode;
      if (expectedStop) {
        state.status = "stopped";
        state.lastError = null;
      } else {
        state.status = "failed";
        state.lastError = message;
      }
    });
  };
  const startScript = (
    runtime: DevServerGroupRuntime,
    workingDirectory: string,
    scriptConfig: RepoConfig["devServers"][number],
  ) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (!processPort) {
          return yield* Effect.fail(
            new HostDependencyError({
              dependency: "DevServerProcessPort",
              operation: "dev_server.start_script",
              message: "Dev server process port is required to start dev servers.",
            }),
          );
        }
        if (!terminalSources)
          return yield* new HostDependencyError({
            dependency: "TerminalOutputSourcePort",
            operation: "dev_server.start_script",
            message:
              "Terminal output support is unavailable. Restart OpenDucktor before starting dev servers.",
          });
        let output: TerminalOutputSource;
        output = yield* terminalSources
          .openOutputSource({
            context:
              runtime.state.owner.kind === "task"
                ? { repoPath: runtime.state.repoPath, taskId: runtime.state.owner.taskId }
                : {
                    kind: "workspace_session",
                    repoPath: runtime.state.repoPath,
                    workspaceId: runtime.state.owner.workspaceId,
                    sessionId: runtime.state.owner.sessionId,
                  },
            workingDir: workingDirectory,
            label: scriptConfig.name,
            onForgotten: () => {
              if (runtime.terminalOutputs.get(scriptConfig.id) !== output) return;
              runtime.terminalOutputs.delete(scriptConfig.id);
              const script = runtime.state.scripts.find(
                (candidate) => candidate.scriptId === scriptConfig.id,
              );
              if (script)
                updateScriptState(runtime, scriptConfig.id, (state) => {
                  state.terminalId = null;
                });
            },
          })
          .pipe(Effect.mapError((cause) => toHostOperationError(cause, "dev_server.open_output")));
        const previousOutput = runtime.terminalOutputs.get(scriptConfig.id);
        runtime.terminalOutputs.delete(scriptConfig.id);
        previousOutput?.release();
        runtime.terminalOutputs.set(scriptConfig.id, output);
        updateScriptState(runtime, scriptConfig.id, (script) => {
          script.status = "starting";
          script.startedCommand = scriptConfig.command;
          script.terminalId = output.terminalId;
          script.pid = null;
          script.startedAt = null;
          script.exitCode = null;
          script.lastError = null;
        });
        writeSystemMessage(runtime, scriptConfig.id, `Starting \`${scriptConfig.command}\``);
        const nativeHandle = yield* processPort
          .start({
            command: scriptConfig.command,
            cwd: workingDirectory,
            env: {
              CLICOLOR_FORCE: DEV_SERVER_CLICOLOR_FORCE,
              COLORTERM: DEV_SERVER_COLORTERM,
              FORCE_COLOR: DEV_SERVER_FORCE_COLOR,
              TERM: DEV_SERVER_TERM,
            },
            onExit: ({ pid, exitCode, signal, error }) => {
              handleProcessExit(runtime, scriptConfig.id, output, pid, exitCode, signal, error);
              output.exit({ exitCode, signal });
            },
            onOutput: ({ data }) => output.write(outputEncoder.encode(data)),
          })
          .pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const script = runtime.state.scripts.find(
                  (candidate) => candidate.scriptId === scriptConfig.id,
                );
                if (script?.status !== "failed") {
                  const exitCode =
                    error instanceof DevServerProcessStartExitError ? error.exitCode : null;
                  markStartFailed(runtime, scriptConfig.id, errorMessage(error), exitCode);
                }
                output.exit({
                  exitCode: error instanceof DevServerProcessStartExitError ? error.exitCode : null,
                  signal: null,
                });
                return yield* Effect.fail(error);
              }),
            ),
          );
        const handle: DevServerProcessHandle = {
          ...nativeHandle,
          stop: () =>
            nativeHandle
              .stop()
              .pipe(
                Effect.tap(() => Effect.sync(() => output.exit({ exitCode: null, signal: null }))),
              ),
        };
        runtime.processes.set(scriptConfig.id, handle);
        const startingScript = runtime.state.scripts.find(
          (candidate) => candidate.scriptId === scriptConfig.id,
        );
        updateScriptState(runtime, scriptConfig.id, (script) => {
          script.pid = handle.pid;
        });
        if (startingScript?.status !== "starting") {
          return yield* new HostOperationError({
            operation: "dev_server.start_script",
            message: startingScript?.lastError ?? "Dev server exited before startup completed.",
          });
        }
        const failStartup = (cause: { message: string }) =>
          Effect.sync(() => {
            if (runtime.terminalOutputs.get(scriptConfig.id) !== output) return;
            updateScriptState(runtime, scriptConfig.id, (script) => {
              script.status = "failed";
              script.lastError = cause.message;
            });
          });
        const mapOutputFailure = (
          cause: { message: string },
          operation: "pause" | "resume" | "terminate",
        ) =>
          new TerminalPtyError({
            code: "operation_failed",
            operation,
            message: cause.message,
            cause,
          });
        yield* output
          .activate({
            supportsOutputPause: true,
            pauseOutput: () =>
              handle
                .pauseOutput()
                .pipe(Effect.mapError((cause) => mapOutputFailure(cause, "pause"))),
            resumeOutput: () =>
              handle
                .resumeOutput()
                .pipe(Effect.mapError((cause) => mapOutputFailure(cause, "resume"))),
            terminate: () =>
              Effect.gen(function* () {
                if (runtime.terminalOutputs.get(scriptConfig.id) === output) {
                  updateScriptState(runtime, scriptConfig.id, (state) => {
                    state.status = "stopping";
                  });
                }
                yield* handle.stop().pipe(
                  Effect.tapError(failStartup),
                  Effect.mapError((cause) => mapOutputFailure(cause, "terminate")),
                );
              }),
          })
          .pipe(
            Effect.mapError((cause) => toHostOperationError(cause, "dev_server.activate_output")),
            Effect.tapError(failStartup),
          );
        yield* restore(handle.waitForReady()).pipe(
          Effect.tapError(failStartup),
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              updateScriptState(runtime, scriptConfig.id, (script) => {
                script.status = "stopping";
              });
              yield* stopScriptProcessHandle({
                handle,
                runtime,
                scriptId: scriptConfig.id,
                updateScriptState,
              });
            }),
          ),
        );
        const script = runtime.state.scripts.find(
          (candidate) => candidate.scriptId === scriptConfig.id,
        );
        if (script?.status !== "starting") {
          return yield* new HostOperationError({
            operation: "dev_server.start_script",
            message: script?.lastError ?? "Dev server exited before startup completed.",
            details: { scriptId: scriptConfig.id },
          });
        }
        const startedAt = nowIso();
        updateScriptState(runtime, scriptConfig.id, (script) => {
          script.status = "running";
          script.pid = handle.pid;
          script.startedAt = startedAt;
          script.exitCode = null;
          script.lastError = null;
        });
      }),
    );
  return startScript;
};
