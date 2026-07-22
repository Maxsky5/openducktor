import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSourceRuntimeDistribution } from "@openducktor/host";
import { Effect } from "effect";
import { startWebLauncherHostBackendEffect } from "./launcher";
import type { WebLogger } from "./logger";
import type { TypescriptHostBackend } from "./typescript-host-backend";

const launchModes = {
  installed: {
    descriptorName: "mcp-bridge.json",
    oppositeDescriptorName: "mcp-bridge-dev.json",
    workspaceMode: false,
  },
  workspace: {
    descriptorName: "mcp-bridge-dev.json",
    oppositeDescriptorName: "mcp-bridge.json",
    workspaceMode: true,
  },
} as const;

type LaunchMode = keyof typeof launchModes;

const isLaunchMode = (value: string | undefined): value is LaunchMode =>
  value !== undefined && Object.hasOwn(launchModes, value);

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

const sourceRuntimeDistribution = createSourceRuntimeDistribution(
  path.resolve(import.meta.dir, "../../.."),
);
const testLogger: WebLogger = {
  error: () => Effect.void,
  info: () => Effect.void,
  success: () => Effect.void,
};

const runDiscoveryScenario = async () => {
  const launchMode = process.argv[2];
  if (!isLaunchMode(launchMode)) {
    throw new Error(
      `Expected launcher discovery mode workspace or installed, received ${launchMode}.`,
    );
  }
  const oppositeDescriptor = process.argv[3];
  if (oppositeDescriptor === undefined) {
    throw new Error("Expected the opposite launcher discovery descriptor fixture.");
  }
  const configDirectory = process.env.OPENDUCKTOR_CONFIG_DIR;
  if (!configDirectory) {
    throw new Error("Expected OPENDUCKTOR_CONFIG_DIR for launcher discovery fixture isolation.");
  }

  const scenario = launchModes[launchMode];
  const runtimeDirectory = path.join(configDirectory, "runtime");
  const descriptorPath = path.join(runtimeDirectory, scenario.descriptorName);
  const oppositeDescriptorPath = path.join(runtimeDirectory, scenario.oppositeDescriptorName);
  let backend: TypescriptHostBackend | null = null;
  let stopped = false;

  try {
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(oppositeDescriptorPath, oppositeDescriptor, "utf8");
    backend = await Effect.runPromise(
      startWebLauncherHostBackendEffect({
        appToken: "app-token",
        controlToken: "control-token",
        frontendOrigin: "http://127.0.0.1:1420",
        logger: testLogger,
        onBackgroundFailure: () => {},
        port: 0,
        runtimeDistribution: sourceRuntimeDistribution,
        workspaceMode: scenario.workspaceMode,
      }),
    );

    const descriptor = JSON.parse(await readFile(descriptorPath, "utf8")) as {
      hostToken?: unknown;
      hostUrl?: unknown;
      pid?: unknown;
    };
    const oppositeDuringRun = await readFile(oppositeDescriptorPath, "utf8");

    await backend.stop();
    stopped = true;

    const selectedMissingAfterStop = await readFile(descriptorPath, "utf8").then(
      () => false,
      (error: unknown) => {
        if (isMissingFileError(error)) {
          return true;
        }
        throw error;
      },
    );
    const oppositeAfterStop = await readFile(oppositeDescriptorPath, "utf8");

    return {
      descriptor: {
        hostTokenPresent:
          typeof descriptor.hostToken === "string" && descriptor.hostToken.length > 0,
        hostUrl: descriptor.hostUrl,
        pidMatchesProcess: descriptor.pid === process.pid,
      },
      oppositeAfterStop,
      oppositeDuringRun,
      selectedMissingAfterStop,
    };
  } finally {
    if (!stopped) {
      await backend?.stop().catch(() => {});
    }
  }
};

process.stdout.write(JSON.stringify(await runDiscoveryScenario()));
