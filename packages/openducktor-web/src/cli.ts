#!/usr/bin/env bun
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import {
  errorMessage,
  runWebBoundary,
  runWebSyncBoundary,
  type WebError,
  WebValidationError,
} from "./effect/web-errors";
import { runLauncherEffect } from "./launcher";
import { createWebLogger, type WebLogger } from "./logger";

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

const isKnownCliFlag = (value: string | undefined): boolean =>
  value === "--workspace" ||
  value === "--port" ||
  value === "--backend-port" ||
  value === "-h" ||
  value === "--help";

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
        const value = args[index + 1];
        if (isKnownCliFlag(value)) {
          return yield* new WebValidationError({
            message: "Missing value for --port.",
            field: "--port",
          });
        }
        options.frontendPort = yield* parsePortEffect(value, "--port");
        index += 1;
        continue;
      }
      if (arg === "--backend-port") {
        const value = args[index + 1];
        if (isKnownCliFlag(value)) {
          return yield* new WebValidationError({
            message: "Missing value for --backend-port.",
            field: "--backend-port",
          });
        }
        options.backendPort = yield* parsePortEffect(value, "--backend-port");
        index += 1;
        continue;
      }
      if (arg === "-h" || arg === "--help") {
        yield* Effect.sync(printHelp);
        yield* Effect.sync(() => process.exit(0));
        return options;
      }

      return yield* new WebValidationError({
        message: `Unknown option: ${arg}`,
        field: "option",
        details: { option: arg },
      });
    }

    return options;
  });

const runCliEffect = (logger: WebLogger): Effect.Effect<number, WebError> =>
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
    return yield* runLauncherEffect(launcherOptions, logger);
  });

const runCli = async (): Promise<void> => {
  let logger: WebLogger;
  try {
    logger = createWebLogger();
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
    return;
  }
  const exitCode = await runWebBoundary(runCliEffect(logger)).catch((error: unknown) => {
    logger.error(errorMessage(error));
    return 1;
  });
  process.exit(exitCode);
};

export const parseCliArgs = (args: string[]): CliOptions =>
  runWebSyncBoundary(parseCliArgsEffect(args));

if (import.meta.main) {
  await runCli();
}
