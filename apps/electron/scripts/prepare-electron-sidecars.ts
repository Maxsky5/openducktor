import type { Stats } from "node:fs";
import { chmod, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import { Effect } from "effect";
import { runElectronEffect } from "../src/effect/electron-boundary";
import {
  ElectronOperationError,
  ElectronValidationError,
  errorMessage,
} from "../src/effect/electron-errors";
import {
  type ElectronReleaseArch,
  type ElectronReleasePlatform,
  resolveHostReleaseArch,
  resolveHostReleasePlatform,
} from "./electron-release-targets";
import {
  ELECTRON_SIDECAR_IDS,
  type ElectronSidecarId,
  electronSidecarDisplayName,
  electronSidecarExecutableName,
} from "./electron-sidecar-manifest";

export type ElectronSidecarBuildPlan = {
  entrypoint: string;
  outputDirectory: string;
  outputPaths: Record<ElectronSidecarId, string>;
  workspaceRoot: string;
};

export type PreparedElectronSidecar = {
  id: ElectronSidecarId;
  outputPath: string;
};

type ResolveElectronSidecarBuildPlanInput = {
  electronPackageDirectory: string;
  platform: ElectronReleasePlatform;
  workspaceRoot: string;
};

type PrepareElectronSidecarsInput = ResolveElectronSidecarBuildPlanInput & {
  arch: ElectronReleaseArch;
  chmodFile?: (path: string, mode: number) => Promise<void>;
  compileMcp?: (plan: ElectronSidecarBuildPlan) => Promise<void>;
};

export const resolveElectronSidecarBuildPlan = ({
  electronPackageDirectory,
  platform,
  workspaceRoot,
}: ResolveElectronSidecarBuildPlanInput): ElectronSidecarBuildPlan => {
  const outputDirectory = join(electronPackageDirectory, "build", "sidecars");
  const outputPaths = Object.fromEntries(
    ELECTRON_SIDECAR_IDS.map((sidecarId) => [
      sidecarId,
      join(outputDirectory, electronSidecarExecutableName(sidecarId, platform)),
    ]),
  ) as Record<ElectronSidecarId, string>;

  return {
    entrypoint: join(workspaceRoot, "packages", "openducktor-mcp", "src", "index.ts"),
    outputDirectory,
    outputPaths,
    workspaceRoot,
  };
};

const assertSidecarFileEffect = ({
  label,
  path,
  platform,
}: {
  label: string;
  path: string;
  platform: ElectronReleasePlatform;
}): Effect.Effect<Stats, ElectronOperationError> =>
  Effect.tryPromise({
    try: async () => {
      const metadata = await stat(path);
      if (!metadata.isFile()) {
        throw new Error("expected a file but found a non-file entry");
      }
      if (metadata.size === 0) {
        throw new Error("expected a non-empty file");
      }
      if (platform !== "windows" && process.platform !== "win32" && (metadata.mode & 0o111) === 0) {
        throw new Error("expected an executable file");
      }
      return metadata;
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.sidecar.verify-compiled",
        message: `${label} is invalid: ${errorMessage(cause)}. Expected path: ${path}`,
        path,
        platform,
        cause,
      }),
  });

const assertFileExistsEffect = (
  path: string,
  label: string,
): Effect.Effect<void, ElectronValidationError> =>
  Effect.tryPromise({
    try: async () => {
      const metadata = await stat(path);
      if (!metadata.isFile()) {
        throw new Error("expected a file but found a non-file entry");
      }
    },
    catch: (cause) =>
      new ElectronValidationError({
        operation: "electron.sidecar.assert-file-exists",
        message: `${label} is missing: ${path}`,
        path,
        cause,
      }),
  });

const compileMcpSidecar = async (plan: ElectronSidecarBuildPlan): Promise<void> => {
  await $`bun build --compile --outfile ${plan.outputPaths["openducktor-mcp"]} ${plan.entrypoint}`;
};

const resetSidecarOutputEffect = (
  plan: ElectronSidecarBuildPlan,
): Effect.Effect<void, ElectronOperationError | ElectronValidationError> =>
  Effect.gen(function* () {
    yield* assertFileExistsEffect(plan.entrypoint, "OpenDucktor MCP entrypoint");
    yield* Effect.tryPromise({
      try: () => rm(plan.outputDirectory, { force: true, recursive: true }),
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.sidecar.clean-output",
          message: errorMessage(cause),
          path: plan.outputDirectory,
          cause,
        }),
    });
    yield* Effect.tryPromise({
      try: () => mkdir(plan.outputDirectory, { recursive: true }),
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.sidecar.create-output",
          message: errorMessage(cause),
          path: plan.outputDirectory,
          cause,
        }),
    });
  });

const compileAndVerifyMcpSidecarEffect = ({
  chmodFile,
  compile,
  plan,
  platform,
}: {
  chmodFile: (path: string, mode: number) => Promise<void>;
  compile: (plan: ElectronSidecarBuildPlan) => Promise<void>;
  plan: ElectronSidecarBuildPlan;
  platform: ElectronReleasePlatform;
}): Effect.Effect<PreparedElectronSidecar, ElectronOperationError> =>
  Effect.gen(function* () {
    const outputPath = plan.outputPaths["openducktor-mcp"];
    yield* Effect.tryPromise({
      try: () => compile(plan),
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.sidecar.compile-mcp",
          message: errorMessage(cause),
          path: outputPath,
          platform,
          cause,
        }),
    });
    if (platform !== "windows") {
      yield* Effect.tryPromise({
        try: () => chmodFile(outputPath, 0o755),
        catch: (cause) =>
          new ElectronOperationError({
            operation: "electron.sidecar.chmod",
            message: errorMessage(cause),
            path: outputPath,
            platform,
            cause,
          }),
      });
    }
    yield* assertSidecarFileEffect({
      label: "Compiled OpenDucktor MCP sidecar",
      path: outputPath,
      platform,
    });

    return { id: "openducktor-mcp", outputPath };
  });

export const prepareElectronSidecarsEffect = ({
  arch,
  chmodFile = chmod,
  compileMcp = compileMcpSidecar,
  ...input
}: PrepareElectronSidecarsInput): Effect.Effect<
  {
    plan: ElectronSidecarBuildPlan;
    sidecars: PreparedElectronSidecar[];
  },
  ElectronOperationError | ElectronValidationError
> =>
  Effect.gen(function* () {
    void arch;
    const plan = resolveElectronSidecarBuildPlan(input);

    yield* resetSidecarOutputEffect(plan);
    const mcpSidecar = yield* compileAndVerifyMcpSidecarEffect({
      chmodFile,
      compile: compileMcp,
      plan,
      platform: input.platform,
    });

    return {
      plan,
      sidecars: [mcpSidecar],
    };
  });

export const prepareElectronSidecars = ({
  arch,
  chmodFile = chmod,
  compileMcp = compileMcpSidecar,
  ...input
}: PrepareElectronSidecarsInput): Promise<{
  plan: ElectronSidecarBuildPlan;
  sidecars: PreparedElectronSidecar[];
}> =>
  runElectronEffect(
    prepareElectronSidecarsEffect({
      arch,
      chmodFile,
      compileMcp,
      ...input,
    }),
  );

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const electronPackageDirectory = dirname(scriptDirectory);
const workspaceRoot = resolve(electronPackageDirectory, "../..");

if (import.meta.main) {
  try {
    const prepared = await prepareElectronSidecars({
      arch: resolveHostReleaseArch(process.arch),
      electronPackageDirectory,
      platform: resolveHostReleasePlatform(process.platform),
      workspaceRoot,
    });
    for (const sidecar of prepared.sidecars) {
      console.log(
        `Prepared ${electronSidecarDisplayName(sidecar.id)} sidecar: ${sidecar.outputPath}`,
      );
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
