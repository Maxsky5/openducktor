#!/usr/bin/env bun
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDevelopmentInstanceId } from "@openducktor/host";
import { Effect } from "effect";
import { parseBasePathEffect } from "./browser-url-validation";
import {
  errorMessage,
  runWebBoundary,
  runWebSyncBoundary,
  type WebError,
  WebResourceError,
  WebValidationError,
} from "./effect/web-errors";
import { type LauncherOptions, runLauncherEffect } from "./launcher";
import { createWebLogger, type WebLogger, writeWebLogEffect } from "./logger";
import { parseHostEffect, parseHttpOriginEffect } from "./http-origin";

type CliOptions = {
  workspaceMode: boolean;
  frontendPort: number;
  backendPort: number;
  host?: string;
  externalUrl?: string;
  basePath?: string;
};

type CliInvocation =
  | { readonly _tag: "Help" }
  | { readonly _tag: "Launch"; readonly options: CliOptions };

const DEFAULT_FRONTEND_PORT = 1420;
const DEFAULT_BACKEND_PORT = 14327;

const createBrowserDevelopmentInstanceId = () =>
  validateDevelopmentInstanceId(`browser-${randomBytes(6).toString("hex")}`);

export const createLauncherOptions = (
  cliOptions: CliOptions,
  packageRoot: string,
): LauncherOptions => {
  const commonOptions = {
    packageRoot,
    frontendPort: cliOptions.frontendPort,
    backendPort: cliOptions.backendPort,
    ...(cliOptions.host !== undefined && { host: cliOptions.host }),
    ...(cliOptions.externalUrl !== undefined && {
      externalUrl: cliOptions.externalUrl,
    }),
    ...(cliOptions.basePath !== undefined && { basePath: cliOptions.basePath }),
  };
  if (cliOptions.workspaceMode) {
    return {
      ...commonOptions,
      developmentInstanceId: createBrowserDevelopmentInstanceId(),
      workspaceMode: true,
      workspaceRoot: path.resolve(packageRoot, "../.."),
    };
  }
  return {
    ...commonOptions,
    workspaceMode: false,
  };
};

const printHelp = (): void => {
  console.log(
    `Usage: openducktor-web [options]\n\nOptions:\n  --port <port>           Frontend port; 0 lets the OS assign it (workspace default 0, installed default ${DEFAULT_FRONTEND_PORT})\n  --backend-port <port>   Local host port; 0 lets the OS assign it (workspace default 0, installed default ${DEFAULT_BACKEND_PORT})\n  --host <host>           Bind address for the frontend and host; wrap IPv6 addresses in brackets, for example [::1]; use a Tailscale IP or 0.0.0.0 to reach them from another machine (default 127.0.0.1)\n  --external-url <origin> URL browsers use to reach the frontend, for example http://100.64.0.1:1420; required when --host is not loopback\n  --base-path <path>      Serve the host under this path on the same origin, for example /api; use with a reverse proxy or Tailscale Serve\n  --workspace             Serve the repo-local frontend with Vite for development\n  -h, --help              Show this help`,
  );
};

const invalidPortError = (raw: string, flag: string): WebValidationError =>
  new WebValidationError({
    message: `Invalid ${flag} value: ${raw}. Expected an integer between 0 and 65535.`,
    field: flag,
    details: { raw },
  });

const isKnownCliFlag = (value: string | undefined): boolean =>
  value === "--workspace" ||
  value === "--port" ||
  value === "--backend-port" ||
  value === "--host" ||
  value === "--external-url" ||
  value === "--base-path" ||
  value === "-h" ||
  value === "--help";

const readFlagValue = (
  args: readonly string[],
  index: number,
  flag: string,
): Effect.Effect<string | undefined, WebValidationError> =>
  Effect.gen(function* () {
    const value = args[index + 1];
    if (isKnownCliFlag(value)) {
      return yield* new WebValidationError({
        message: `Missing value for ${flag}.`,
        field: flag,
      });
    }
    return value;
  });

const parseExternalUrlEffect = (
  raw: string | undefined,
  flag: string,
): Effect.Effect<string, WebValidationError> =>
  Effect.gen(function* () {
    if (raw === undefined) {
      return yield* new WebValidationError({
        message: `Missing value for ${flag}.`,
        field: flag,
      });
    }
    const parsed = yield* parseHttpOriginEffect(raw.trim(), `OpenDucktor web ${flag}`);
    return parsed.origin;
  });

const parsePortEffect = (
  raw: string | undefined,
  flag: string,
): Effect.Effect<number, WebValidationError> =>
  Effect.gen(function* () {
    if (raw === undefined) {
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
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
      return yield* invalidPortError(raw, flag);
    }
    return parsed;
  });

export const parseCliArgsEffect = (
  args: string[],
): Effect.Effect<CliInvocation, WebValidationError> =>
  Effect.gen(function* () {
    const workspaceMode = args.includes("--workspace");
    const options: CliOptions = {
      workspaceMode,
      frontendPort: workspaceMode ? 0 : DEFAULT_FRONTEND_PORT,
      backendPort: workspaceMode ? 0 : DEFAULT_BACKEND_PORT,
    };

    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "--workspace") {
        continue;
      }
      if (arg === "--port") {
        const value = yield* readFlagValue(args, index, "--port");
        options.frontendPort = yield* parsePortEffect(value, "--port");
        index += 1;
        continue;
      }
      if (arg === "--backend-port") {
        const value = yield* readFlagValue(args, index, "--backend-port");
        options.backendPort = yield* parsePortEffect(value, "--backend-port");
        index += 1;
        continue;
      }
      if (arg === "--host") {
        const value = yield* readFlagValue(args, index, "--host");
        options.host = yield* parseHostEffect(value, "--host");
        index += 1;
        continue;
      }
      if (arg === "--external-url") {
        const value = yield* readFlagValue(args, index, "--external-url");
        options.externalUrl = yield* parseExternalUrlEffect(value, "--external-url");
        index += 1;
        continue;
      }
      if (arg === "--base-path") {
        const value = yield* readFlagValue(args, index, "--base-path");
        options.basePath = yield* parseBasePathEffect(value, "--base-path");
        index += 1;
        continue;
      }
      if (arg === "-h" || arg === "--help") {
        return { _tag: "Help" } as const;
      }

      return yield* new WebValidationError({
        message: `Unknown option: ${arg}`,
        field: "option",
        details: { option: arg },
      });
    }

    return { _tag: "Launch", options } as const;
  });

const runCliEffect = (cliOptions: CliOptions, logger: WebLogger): Effect.Effect<number, WebError> =>
  Effect.gen(function* () {
    const __filename = fileURLToPath(import.meta.url);
    const packageRoot = path.resolve(path.dirname(__filename), "..");
    return yield* runLauncherEffect(createLauncherOptions(cliOptions, packageRoot), logger);
  });

const runCli = async (): Promise<void> => {
  const parseResult = await runWebBoundary(
    Effect.either(parseCliArgsEffect(process.argv.slice(2))),
  );
  if (parseResult._tag === "Right" && parseResult.right._tag === "Help") {
    printHelp();
    process.exit(0);
    return;
  }

  let logger: WebLogger;
  try {
    logger = await runWebBoundary(createWebLogger());
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
    return;
  }

  const reportFailure = async (cause: unknown): Promise<void> => {
    if (cause instanceof WebResourceError && cause.resource === "persistent-log") {
      console.error(`OpenDucktor web fatal boundary: ${errorMessage(cause)}`);
      return;
    }
    try {
      await runWebBoundary(writeWebLogEffect(logger, "error", errorMessage(cause)));
    } catch (loggingCause) {
      console.error(`OpenDucktor web fatal boundary: ${errorMessage(loggingCause)}`);
    }
  };

  if (parseResult._tag === "Left") {
    await reportFailure(parseResult.left);
    process.exit(1);
    return;
  }
  if (parseResult.right._tag === "Help") {
    return;
  }

  let exitCode: number;
  try {
    exitCode = await runWebBoundary(runCliEffect(parseResult.right.options, logger));
  } catch (cause) {
    await reportFailure(cause);
    exitCode = 1;
  }
  process.exit(exitCode);
};

export const parseCliArgs = (args: string[]): CliOptions => {
  const invocation = runWebSyncBoundary(parseCliArgsEffect(args));
  if (invocation._tag === "Help") {
    printHelp();
    process.exit(0);
  }
  return invocation.options;
};

if (import.meta.main) {
  await runCli();
}
