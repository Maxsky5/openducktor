import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSourceRuntimeDistribution } from "@openducktor/host";
import { Effect } from "effect";
import { startWebLauncherHostBackendEffect } from "./launcher";
import type { WebLogger } from "./logger";
import type { TypescriptHostBackend } from "./typescript-host-backend";

const launchModes = {
  installed: {
    descriptorRelativePath: ["runtime", "mcp-bridge.json"],
    oppositeDescriptorRelativePath: [
      "runtime",
      "dev-instances",
      "browser-0123456789ab",
      "mcp-bridge.json",
    ],
    workspaceMode: false,
  },
  workspace: {
    descriptorRelativePath: ["runtime", "dev-instances", "browser-0123456789ab", "mcp-bridge.json"],
    oppositeDescriptorRelativePath: ["runtime", "mcp-bridge.json"],
    workspaceMode: true,
  },
} as const;

type LaunchMode = keyof typeof launchModes;

export type DiscoveryScenarioResult = {
  descriptor: {
    hostTokenPresent: boolean;
    hostUrl: string;
    pidMatchesProcess: boolean;
  };
  oppositeAfterStop: string;
  oppositeDuringRun: string;
  selectedMissingAfterStop: boolean;
};

const isLaunchMode = (value: string | undefined): value is LaunchMode =>
  value !== undefined && Object.hasOwn(launchModes, value);

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

const isFileMissing = (filePath: string): Promise<boolean> =>
  readFile(filePath, "utf8").then(
    () => false,
    (error: unknown) => {
      if (isMissingFileError(error)) {
        return true;
      }
      throw error;
    },
  );

const testLogger: WebLogger = {
  error: () => Effect.void,
  info: () => Effect.void,
  success: () => Effect.void,
};

const runDiscoveryScenario = async (): Promise<DiscoveryScenarioResult> => {
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
  const descriptorPath = path.join(configDirectory, ...scenario.descriptorRelativePath);
  const oppositeDescriptorPath = path.join(
    configDirectory,
    ...scenario.oppositeDescriptorRelativePath,
  );
  const runtimeDistribution = createSourceRuntimeDistribution(
    path.resolve(import.meta.dir, "../../.."),
  );
  const discoveryOptions = scenario.workspaceMode
    ? {
        developmentInstanceId: "browser-0123456789ab",
        workspaceMode: true as const,
      }
    : { workspaceMode: false as const };
  let backend: TypescriptHostBackend | null = null;

  try {
    await mkdir(path.dirname(descriptorPath), { recursive: true });
    await mkdir(path.dirname(oppositeDescriptorPath), { recursive: true });
    await writeFile(oppositeDescriptorPath, oppositeDescriptor, "utf8");
    backend = await Effect.runPromise(
      startWebLauncherHostBackendEffect({
        appToken: "app-token",
        controlToken: "control-token",
        frontendOrigin: "http://127.0.0.1:1420",
        logger: testLogger,
        onBackgroundFailure: () => {},
        port: 0,
        runtimeDistribution,
        ...discoveryOptions,
      }),
    );

    const descriptor = JSON.parse(await readFile(descriptorPath, "utf8")) as {
      hostToken?: unknown;
      hostUrl?: unknown;
      pid?: unknown;
    };
    if (typeof descriptor.hostUrl !== "string") {
      throw new Error("Expected launcher discovery descriptor hostUrl to be a string.");
    }
    const oppositeDuringRun = await readFile(oppositeDescriptorPath, "utf8");

    await backend.stop();
    backend = null;

    const selectedMissingAfterStop = await isFileMissing(descriptorPath);
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
    await backend?.stop().catch(() => {});
  }
};

if (import.meta.main) {
  process.stdout.write(JSON.stringify(await runDiscoveryScenario()));
}
