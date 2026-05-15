import { spawn } from "node:child_process";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareMcpSidecar } from "./prepare-mcp-sidecar";

export type ElectronReleasePlatform = "linux" | "macos" | "windows";
export type ElectronReleaseArch = "arm64" | "x64";

export type ElectronReleaseBuildOptions = {
  arch: ElectronReleaseArch;
  electronPackageDirectory: string;
  outputDirectory: string;
  platform: ElectronReleasePlatform;
  signed: boolean;
  workspaceRoot: string;
};

type RunCommandInput = {
  args: string[];
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
};

const platformFlags: Record<ElectronReleasePlatform, "--linux" | "--mac" | "--win"> = {
  linux: "--linux",
  macos: "--mac",
  windows: "--win",
};

const artifactExtensions: Record<ElectronReleasePlatform, ReadonlySet<string>> = {
  linux: new Set([".AppImage", ".deb", ".blockmap"]),
  macos: new Set([".dmg", ".zip", ".blockmap"]),
  windows: new Set([".exe", ".zip", ".blockmap"]),
};

export const detectHostReleasePlatform = (
  platform: NodeJS.Platform,
): ElectronReleasePlatform | undefined => {
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  if (platform === "win32") return "windows";
  return undefined;
};

export const detectHostReleaseArch = (
  arch: NodeJS.Architecture,
): ElectronReleaseArch | undefined => {
  if (arch === "arm64") return "arm64";
  if (arch === "x64") return "x64";
  return undefined;
};

export const resolveElectronBuilderArgs = ({
  arch,
  platform,
  signed,
}: Pick<ElectronReleaseBuildOptions, "arch" | "platform" | "signed">): string[] => {
  const args = [
    "--config",
    "electron-builder.yml",
    platformFlags[platform],
    `--${arch}`,
    "--publish",
    "never",
  ];

  if (!signed && platform === "macos") {
    args.push("-c.mac.notarize=false");
  }

  return args;
};

export const resolveElectronBuilderEnv = (
  signed: boolean,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  const builderEnv = { ...env };

  if (signed) {
    return builderEnv;
  }

  builderEnv.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  delete builderEnv.CSC_LINK;
  delete builderEnv.CSC_KEY_PASSWORD;
  delete builderEnv.CSC_NAME;
  delete builderEnv.APPLE_ID;
  delete builderEnv.APPLE_APP_SPECIFIC_PASSWORD;
  delete builderEnv.APPLE_TEAM_ID;

  return builderEnv;
};

export const isReleaseArtifact = (platform: ElectronReleasePlatform, fileName: string): boolean =>
  artifactExtensions[platform].has(extname(fileName));

const assertDirectoryExists = async (path: string, label: string): Promise<void> => {
  try {
    const metadata = await stat(path);
    if (metadata.isDirectory()) {
      return;
    }
  } catch {
    // Report a single actionable error below.
  }

  throw new Error(`${label} is missing: ${path}`);
};

const runCommand = ({ args, command, cwd, env = process.env }: RunCommandInput): Promise<void> =>
  new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    child.on("error", rejectCommand);
    child.on("exit", (exitCode) => {
      if (exitCode === 0) {
        resolveCommand();
        return;
      }

      rejectCommand(
        new Error(`${command} ${args.join(" ")} exited with code ${exitCode ?? "unknown"}`),
      );
    });
  });

export const collectReleaseArtifacts = async ({
  outputDirectory,
  platform,
  releaseDirectory,
}: {
  outputDirectory: string;
  platform: ElectronReleasePlatform;
  releaseDirectory: string;
}): Promise<string[]> => {
  const releaseGlob = new Bun.Glob("*");
  const copiedArtifacts: string[] = [];

  await assertDirectoryExists(releaseDirectory, "Electron release directory");
  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(outputDirectory, { recursive: true });

  for await (const entry of releaseGlob.scan({
    cwd: releaseDirectory,
    onlyFiles: true,
  })) {
    if (!isReleaseArtifact(platform, entry)) {
      continue;
    }

    const sourcePath = join(releaseDirectory, entry);
    const targetPath = join(outputDirectory, entry);
    await copyFile(sourcePath, targetPath);
    copiedArtifacts.push(targetPath);
  }

  if (copiedArtifacts.length === 0) {
    throw new Error(`No Electron release artifacts were produced for ${platform}.`);
  }

  return copiedArtifacts;
};

export const buildElectronReleaseArtifact = async ({
  arch,
  electronPackageDirectory,
  outputDirectory,
  platform,
  signed,
  workspaceRoot,
}: ElectronReleaseBuildOptions): Promise<string[]> => {
  const releaseDirectory = join(electronPackageDirectory, "release");

  await rm(releaseDirectory, { force: true, recursive: true });
  await rm(outputDirectory, { force: true, recursive: true });
  await prepareMcpSidecar({
    electronPackageDirectory,
    platform: process.platform,
    workspaceRoot,
  });

  await runCommand({
    args: ["run", "build"],
    command: "bun",
    cwd: electronPackageDirectory,
  });
  await runCommand({
    args: resolveElectronBuilderArgs({ arch, platform, signed }),
    command: "electron-builder",
    cwd: electronPackageDirectory,
    env: resolveElectronBuilderEnv(signed, process.env),
  });

  return collectReleaseArtifacts({
    outputDirectory,
    platform,
    releaseDirectory,
  });
};

const readFlagValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
};

const hasFlag = (args: string[], name: string): boolean => args.includes(name);

const parsePlatform = (value: string | undefined): ElectronReleasePlatform => {
  const platform = value ?? detectHostReleasePlatform(process.platform);
  if (platform === "linux" || platform === "macos" || platform === "windows") {
    return platform;
  }

  throw new Error("Expected --platform to be one of: linux, macos, windows.");
};

const parseArch = (value: string | undefined): ElectronReleaseArch => {
  const arch = value ?? detectHostReleaseArch(process.arch);
  if (arch === "arm64" || arch === "x64") {
    return arch;
  }

  throw new Error("Expected --arch to be one of: arm64, x64.");
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const electronPackageDirectory = dirname(scriptDirectory);
const workspaceRoot = resolve(electronPackageDirectory, "../..");

if (import.meta.main) {
  const args = process.argv.slice(2);
  const outputDirectory = resolve(
    electronPackageDirectory,
    readFlagValue(args, "--output-dir") ?? "release-publish",
  );
  const artifacts = await buildElectronReleaseArtifact({
    arch: parseArch(readFlagValue(args, "--arch")),
    electronPackageDirectory,
    outputDirectory,
    platform: parsePlatform(readFlagValue(args, "--platform")),
    signed: hasFlag(args, "--signed"),
    workspaceRoot,
  });

  console.log("Electron release artifacts:");
  for (const artifact of artifacts) {
    console.log(`- ${artifact}`);
  }
}
