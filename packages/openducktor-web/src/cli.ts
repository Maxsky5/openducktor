#!/usr/bin/env bun
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import {
  errorMessage,
  runWebBoundary,
  runWebSyncBoundary,
  WebOperationError,
  WebValidationError,
} from "./effect/web-errors";
import { runLauncher } from "./launcher";
import { logError } from "./logger";

type CliOptions = {
  workspaceMode: boolean;
  frontendPort: number;
  backendPort: number;
};

const DEFAULT_FRONTEND_PORT = 1420;
const DEFAULT_BACKEND_PORT = 14327;

const printHelp = (): void => {
  console.log(
    `Usage: openducktor-web [options]\n\nOptions:\n  --port <port>           Frontend Vite port (default ${DEFAULT_FRONTEND_PORT})\n  --backend-port <port>   Local TypeScript host port (default ${DEFAULT_BACKEND_PORT})\n  --workspace             Serve the repo-local frontend with Vite for development\n  -h, --help              Show this help`,
  );
};

const invalidPortError = (raw: string, flag: string): WebValidationError =>
  new WebValidationError({
    message: `Invalid ${flag} value: ${raw}. Expected a TCP port between 1 and 65535.`,
    field: flag,
    details: { raw },
  });

const parsePortEffect = (
  raw: string | undefined,
  flag: string,
): Effect.Effect<number, WebValidationError> =>
  Effect.gen(function* () {
    if (!raw) {
      return yield* new WebValidationError({
        message: `Missing value for ${flag}.`,
        field: flag,
      });
    }
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) {
      return yield* invalidPortError(raw, flag);
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
      return yield* invalidPortError(raw, flag);
    }
    return parsed;
  });

export const parseCliArgsEffect = (args: string[]): Effect.Effect<CliOptions, WebValidationError> =>
  Effect.gen(function* () {
    const options: CliOptions = {
      workspaceMode: false,
      frontendPort: DEFAULT_FRONTEND_PORT,
      backendPort: DEFAULT_BACKEND_PORT,
    };

    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "--workspace") {
        options.workspaceMode = true;
        continue;
      }
      if (arg === "--port") {
        options.frontendPort = yield* parsePortEffect(args[index + 1], "--port");
        index += 1;
        continue;
      }
      if (arg === "--backend-port") {
        options.backendPort = yield* parsePortEffect(args[index + 1], "--backend-port");
        index += 1;
        continue;
      }
      if (arg === "-h" || arg === "--help") {
        yield* Effect.sync(printHelp);
        yield* Effect.sync(() => process.exit(0));
      }

      return yield* new WebValidationError({
        message: `Unknown option: ${arg}`,
        field: "option",
        details: { option: arg },
      });
    }

    return options;
  });

const runCliEffect = (): Effect.Effect<number, WebOperationError | WebValidationError> =>
  Effect.gen(function* () {
    const __filename = fileURLToPath(import.meta.url);
    const packageRoot = path.resolve(path.dirname(__filename), "..");
    const cliOptions = yield* parseCliArgsEffect(process.argv.slice(2));
    const launcherOptions = {
      packageRoot,
      ...(cliOptions.workspaceMode ? { workspaceRoot: path.resolve(packageRoot, "../..") } : {}),
      workspaceMode: cliOptions.workspaceMode,
      frontendPort: cliOptions.frontendPort,
      backendPort: cliOptions.backendPort,
    };
    return yield* Effect.tryPromise({
      try: () => runLauncher(launcherOptions),
      catch: (cause) =>
        new WebOperationError({
          operation: "web.cli.launch",
          message: errorMessage(cause),
          cause,
        }),
    });
  });

const runCli = async (): Promise<void> => {
  const exitCode = await runWebBoundary(runCliEffect()).catch((error: unknown) => {
    logError(errorMessage(error));
    return 1;
  });
  process.exit(exitCode);
};

export const parseCliArgs = (args: string[]): CliOptions =>
  runWebSyncBoundary(parseCliArgsEffect(args));

if (import.meta.main) {
  await runCli();
}
