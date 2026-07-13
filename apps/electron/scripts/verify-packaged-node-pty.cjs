const { constants } = require("node:fs");
const { access } = require("node:fs/promises");
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

const resolvePackagedResourcesRoot = (context) =>
  context.electronPlatformName === "darwin"
    ? join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`,
        "Contents",
        "Resources",
      )
    : join(context.appOutDir, "resources");

exports.resolvePackagedResourcesRoot = resolvePackagedResourcesRoot;

const electronBuilderArch = (arch) => (arch === 1 ? "x64" : arch === 3 ? "arm64" : String(arch));

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
  const arch = electronBuilderArch(context.arch);
  if (arch !== process.arch) return;

  execFileSync(
    packagedElectronExecutable(context),
    [join(__dirname, "verify-packaged-node-pty-runtime.cjs"), root],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
    },
  );
};

exports.verifyPackagedNodePtyRuntime = verifyPackagedNodePtyRuntime;

exports.default = async function verifyPackagedNodePty(context) {
  const root = join(
    resolvePackagedResourcesRoot(context),
    "app.asar.unpacked",
    "node_modules",
    "node-pty",
  );
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
  // A macOS app bundle is not valid until electron-builder has signed it. Running
  // the helper from the unsigned bundle makes posix_spawn reject the executable,
  // so the afterSign hook performs the in-place runtime probe on macOS.
  if (platform !== "darwin") verifyPackagedNodePtyRuntime(context, root);
};
