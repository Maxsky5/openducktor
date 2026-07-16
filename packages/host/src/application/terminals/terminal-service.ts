import {
  type TerminalCloseRequest,
  type TerminalCreateRequest,
  type TerminalCreateResponse,
  type TerminalListFilter,
  type TerminalListResponse,
  type TerminalSummary,
  terminalCloseRequestSchema,
  terminalCreateRequestSchema,
  terminalListFilterSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { FilesystemPort } from "../../ports/filesystem-port";
import type { TerminalGrid, TerminalPtyPort } from "../../ports/terminal-pty-port";
import {
  createTerminalLaunchPolicy,
  type TerminalLaunchEnvironmentPort,
} from "./terminal-launch-policy";
import { TERMINAL_LIMITS } from "./terminal-limits";
import { TerminalServiceError } from "./terminal-service-error";
import {
  createTerminalSessionEngine,
  type TerminalSessionAttachInput,
} from "./terminal-session-engine";

const DEFAULT_GRID: TerminalGrid = { columns: 80, rows: 24 };

export type TerminalAttachInput = TerminalSessionAttachInput;

export type TerminalCloseByTaskResult = { closedTerminalIds: string[] };

export type TerminalService = {
  readonly hostInstanceId: string;
  create(input: TerminalCreateRequest): Effect.Effect<TerminalCreateResponse, TerminalServiceError>;
  list(filter: TerminalListFilter): Effect.Effect<TerminalListResponse, TerminalServiceError>;
  attach(input: TerminalAttachInput): Effect.Effect<void, TerminalServiceError>;
  write(terminalId: string, data: Uint8Array): Effect.Effect<void, TerminalServiceError>;
  resize(terminalId: string, grid: TerminalGrid): Effect.Effect<void, TerminalServiceError>;
  acknowledge(
    terminalId: string,
    attachmentId: string,
    sequenceEnd: number,
  ): Effect.Effect<void, TerminalServiceError>;
  detach(terminalId: string, attachmentId: string): Effect.Effect<void, TerminalServiceError>;
  close(input: TerminalCloseRequest): Effect.Effect<void, TerminalServiceError>;
  closeByTaskIds(
    taskIds: readonly string[],
  ): Effect.Effect<TerminalCloseByTaskResult, TerminalServiceError>;
  dispose(): Effect.Effect<void, TerminalServiceError>;
};

type CreateTerminalServiceInput = {
  filesystem: FilesystemPort;
  ptyPort: TerminalPtyPort;
  resolveLaunchEnvironment: TerminalLaunchEnvironmentPort;
  now?: () => Date;
  idFactory?: () => string;
  hostInstanceIdFactory?: () => string;
};

export const createTerminalService = ({
  filesystem,
  ptyPort,
  resolveLaunchEnvironment,
  now = () => new Date(),
  idFactory = () => globalThis.crypto.randomUUID(),
  hostInstanceIdFactory = () => globalThis.crypto.randomUUID(),
}: CreateTerminalServiceInput): Effect.Effect<TerminalService> =>
  Effect.gen(function* () {
    const hostInstanceId = hostInstanceIdFactory();
    const engine = createTerminalSessionEngine({ now, ptyPort });
    const launch = createTerminalLaunchPolicy({
      filesystem,
      resolveEnvironment: resolveLaunchEnvironment,
    });
    let accepting = true;

    const serviceFailure = (
      code: ConstructorParameters<typeof TerminalServiceError>[0]["code"],
      operation: ConstructorParameters<typeof TerminalServiceError>[0]["operation"],
      message: string,
    ): TerminalServiceError => new TerminalServiceError({ code, operation, message });

    const service: TerminalService = {
      hostInstanceId,
      create: (rawInput) =>
        Effect.gen(function* () {
          if (!accepting) {
            return yield* Effect.fail(
              serviceFailure("close_failed", "create", "Terminal service is shutting down."),
            );
          }
          const input = terminalCreateRequestSchema.parse(rawInput);
          if (engine.countLive() >= TERMINAL_LIMITS.livePerHost) {
            return yield* Effect.fail(
              serviceFailure(
                "host_terminal_limit",
                "create",
                "The host terminal limit has been reached.",
              ),
            );
          }
          const contextLimit = input.context.taskId
            ? TERMINAL_LIMITS.livePerTask
            : TERMINAL_LIMITS.liveUnassociated;
          if (engine.countLiveForContext(input.context.taskId) >= contextLimit) {
            return yield* Effect.fail(
              serviceFailure(
                "context_terminal_limit",
                "create",
                "The terminal limit for this context has been reached.",
              ),
            );
          }
          const plan = yield* launch(input, DEFAULT_GRID);
          const terminalId = idFactory();
          const summary: TerminalSummary = {
            terminalId,
            hostInstanceId,
            label: plan.cwd,
            context: input.context,
            initialWorkingDir: plan.cwd,
            initialWorkingDirAvailable: true,
            createdAt: now().toISOString(),
            lifecycle: "starting",
            connectionState: "disconnected",
            attentionState: "none",
            exit: null,
          };
          const started = yield* engine.start(summary, plan);
          return { ref: { terminalId }, summary: started };
        }),
      list: (rawFilter) =>
        Effect.gen(function* () {
          const filter = terminalListFilterSchema.parse(rawFilter);
          const matching = engine.list(filter);
          const terminals: TerminalSummary[] = [];
          for (const summary of matching) {
            const directory = yield* Effect.either(filesystem.stat(summary.initialWorkingDir));
            const available = directory._tag === "Right" && directory.right.isDirectory;
            engine.setInitialWorkingDirAvailable(summary.terminalId, available);
            terminals.push({ ...summary, initialWorkingDirAvailable: available });
          }
          return { hostInstanceId, terminals };
        }),
      attach: engine.attach,
      write: engine.write,
      resize: engine.resize,
      acknowledge: engine.acknowledge,
      detach: engine.detach,
      close: (rawInput) =>
        Effect.gen(function* () {
          const input = terminalCloseRequestSchema.parse(rawInput);
          yield* engine.close(input.terminalId, input.confirmTerminate);
        }),
      closeByTaskIds: (taskIds) =>
        engine
          .closeByTaskIds(taskIds)
          .pipe(Effect.map((closedTerminalIds) => ({ closedTerminalIds }))),
      dispose: () =>
        Effect.gen(function* () {
          accepting = false;
          yield* engine.dispose();
        }),
    };
    return service;
  });

export { TerminalServiceError } from "./terminal-service-error";
