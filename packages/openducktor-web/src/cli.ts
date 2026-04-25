#!/usr/bin/env bun
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLauncher } from "./launcher";

type CliOptions = {
  workspaceMode: boolean;
  frontendPort: number;
  backendPort: number;
  explicitHostBinary?: string;
};

const DEFAULT_FRONTEND_PORT = 1420;
const DEFAULT_BACKEND_PORT = 14327;

const printHelp = (): void => {
  console.log(
    `Usage: openducktor-web [options]\n\nOptions:\n  --port <port>           Frontend Vite port (default ${DEFAULT_FRONTEND_PORT})\n  --backend-port <port>   Local Rust host port (default ${DEFAULT_BACKEND_PORT})\n  --host-binary <path>    Use an explicit openducktor-web-host binary\n  --workspace             Use the repo-local Rust workspace binary for development\n  -h, --help              Show this help`,
  );
};

const parsePort = (raw: string | undefined, flag: string): number => {
  if (!raw) {
    throw new Error(`Missing value for ${flag}.`);
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid ${flag} value: ${raw}. Expected a TCP port between 1 and 65535.`);
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(`Invalid ${flag} value: ${raw}. Expected a TCP port between 1 and 65535.`);
  }
  return parsed;
};

export const parseCliArgs = (args: string[]): CliOptions => {
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
      options.frontendPort = parsePort(args[index + 1], "--port");
      index += 1;
      continue;
    }
    if (arg === "--backend-port") {
      options.backendPort = parsePort(args[index + 1], "--backend-port");
      index += 1;
      continue;
    }
    if (arg === "--host-binary") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --host-binary.");
      }
      options.explicitHostBinary = value;
      index += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
};

const runCli = async (): Promise<void> => {
  const __filename = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(__filename), "..");
  const workspaceRoot = path.resolve(packageRoot, "../..");

  try {
    const cliOptions = parseCliArgs(process.argv.slice(2));
    const launcherOptions = {
      packageRoot,
      workspaceRoot,
      workspaceMode: cliOptions.workspaceMode,
      frontendPort: cliOptions.frontendPort,
      backendPort: cliOptions.backendPort,
    };
    const exitCode = await runLauncher(
      cliOptions.explicitHostBinary
        ? { ...launcherOptions, explicitHostBinary: cliOptions.explicitHostBinary }
        : launcherOptions,
    );
    process.exit(exitCode);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
};

if (import.meta.main) {
  await runCli();
}
