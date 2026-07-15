import { execFileSync } from "node:child_process";
import { constants, cpSync, mkdtempSync, rmSync } from "node:fs";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

export const resolvePackagedResourcesRoot = (context) => {
  if (context.electronPlatformName === "darwin") {
    return join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      "Contents",
      "Resources",
    );
  }
  return join(context.appOutDir, "resources");
};

const electronBuilderArch = (arch) => {
  if (arch === 1) return "x64";
  if (arch === 3) return "arm64";
  return String(arch);
};

const packagedElectronExecutable = (context) => {
  const productFilename = context.packager.appInfo.productFilename;
  if (context.electronPlatformName === "darwin") {
    return join(context.appOutDir, `${productFilename}.app`, "Contents", "MacOS", productFilename);
  }
  if (context.electronPlatformName === "win32") {
    return join(context.appOutDir, `${productFilename}.exe`);
  }
  return join(context.appOutDir, context.packager.executableName ?? productFilename);
};

const verifyPackagedNodePtyRuntime = (context, root) => {
  if (context.electronPlatformName !== process.platform) return;
  if (electronBuilderArch(context.arch) !== process.arch) return;

  execFileSync(
    packagedElectronExecutable(context),
    [join(import.meta.dirname, "verify-packaged-node-pty-runtime.mjs"), root],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
    },
  );
};

const packagedNodePtyRoot = (context) =>
  join(resolvePackagedResourcesRoot(context), "app.asar.unpacked", "node_modules", "node-pty");

export const afterPack = async (context) => {
  const root = packagedNodePtyRoot(context);
  const platform =
    context.electronPlatformName === "win32" ? "win32" : context.electronPlatformName;
  const arch = electronBuilderArch(context.arch);
  const binding = platform === "win32" ? "conpty.node" : "pty.node";
  const nativeRoots = [
    join(root, "prebuilds", `${platform}-${arch}`),
    join(root, "build", "Release"),
  ];
  const existingRoots = [];
  for (const nativeRoot of nativeRoots) {
    try {
      await access(join(nativeRoot, binding));
      existingRoots.push(nativeRoot);
    } catch {
      // node-pty uses prebuilds where available and build/Release after a source rebuild.
    }
  }
  if (existingRoots.length === 0) {
    throw new Error(`Packaged node-pty is missing ${binding} for ${platform}-${arch}.`);
  }
  if (platform !== "win32") {
    await access(join(root, "build", "Release", "spawn-helper"), constants.X_OK).catch(async () => {
      await access(join(root, "prebuilds", `${platform}-${arch}`, "spawn-helper"), constants.X_OK);
    });
  }
  if (platform !== "darwin") verifyPackagedNodePtyRuntime(context, root);
};

const isSignedMacApp = (appPath) => {
  try {
    execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

export const afterSign = async (context) => {
  if (context.electronPlatformName !== "darwin") return;

  const root = packagedNodePtyRoot(context);
  const appPath = dirname(dirname(resolvePackagedResourcesRoot(context)));
  if (isSignedMacApp(appPath)) {
    verifyPackagedNodePtyRuntime(context, root);
    return;
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), "openducktor-node-pty-"));
  const copiedRoot = join(temporaryRoot, "node_modules", basename(root));
  try {
    cpSync(root, copiedRoot, { recursive: true });
    verifyPackagedNodePtyRuntime(context, copiedRoot);
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
};
