import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { processNativeFileName, workspaceProcessNativeDirectory } from "../src/index";

/** The file name of the library that Cargo writes on this host. */
const libraryFileName = (): string => {
  if (process.platform === "darwin") return "libopenducktor_process_native.dylib";
  if (process.platform === "win32") return "openducktor_process_native.dll";
  return "libopenducktor_process_native.so";
};

/**
 * Builds the module of this host. The release workflow `build-process-native.yml` builds the
 * module of each platform with Cargo itself.
 */
export const buildProcessNative = (): string => {
  const packageDirectory = path.join(import.meta.dirname, "..");
  const result = Bun.spawnSync(["cargo", "build", "--release", "--locked"], {
    cwd: packageDirectory,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      "The process native module did not build. Install Rust from https://rustup.rs and run `bun run --filter @openducktor/process-native build` again.",
    );
  }
  const outputDirectory = workspaceProcessNativeDirectory();
  const output = path.join(outputDirectory, processNativeFileName());
  mkdirSync(outputDirectory, { recursive: true });
  copyFileSync(path.join(packageDirectory, "target", "release", libraryFileName()), output);
  return output;
};

/**
 * Builds the module of this host for a source build. A release job downloads the module of each
 * platform first and sets `OPENDUCKTOR_PROCESS_NATIVE=prebuilt`, so its build only copies them.
 */
export const prepareHostProcessNative = (env: NodeJS.ProcessEnv = process.env): void => {
  const mode = env.OPENDUCKTOR_PROCESS_NATIVE;
  if (mode === "prebuilt") return;
  if (mode !== undefined && mode !== "")
    throw new Error(
      `Set OPENDUCKTOR_PROCESS_NATIVE to prebuilt, or leave it unset. Received ${mode}.`,
    );
  buildProcessNative();
};

/** The module files that `bun run build` or a release job wrote for each platform. */
export const listBuiltProcessNativeFiles = (): string[] => {
  const directory = workspaceProcessNativeDirectory();
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) =>
    /^process-native\.[a-z0-9]+-[a-z0-9]+\.node$/.test(name),
  );
};

/** Copies built module files into the `native` directory of a shell build. */
export const copyProcessNativeModules = (input: {
  fileNames: string[];
  targetDirectory: string;
}) => {
  const sourceDirectory = workspaceProcessNativeDirectory();
  mkdirSync(input.targetDirectory, { recursive: true });
  for (const fileName of input.fileNames) {
    const source = path.join(sourceDirectory, fileName);
    if (!existsSync(source)) {
      throw new Error(
        `The native process module ${fileName} is missing. Run \`bun run --filter @openducktor/process-native build\`, or download the release build of this platform.`,
      );
    }
    copyFileSync(source, path.join(input.targetDirectory, fileName));
  }
};

if (import.meta.main) {
  console.log(`Built ${buildProcessNative()}`);
}
