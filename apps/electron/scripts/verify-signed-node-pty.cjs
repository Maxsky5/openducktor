const { execFileSync } = require("node:child_process");
const { cpSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, dirname, join } = require("node:path");
const {
  resolvePackagedResourcesRoot,
  verifyPackagedNodePtyRuntime,
} = require("./verify-packaged-node-pty.cjs");

exports.default = async function verifySignedNodePty(context) {
  if (context.electronPlatformName !== "darwin") return;

  const resourcesRoot = resolvePackagedResourcesRoot(context);
  const root = join(resourcesRoot, "app.asar.unpacked", "node_modules", "node-pty");
  const appPath = dirname(dirname(resourcesRoot));

  try {
    execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
      stdio: "ignore",
    });
    verifyPackagedNodePtyRuntime(context, root);
    return;
  } catch {
    // Local packaging disables certificate discovery. electron-builder still
    // emits afterSign, but macOS rejects posix_spawn from that invalid bundle.
    // Probe an exact copy so the packaged binding/helper pair is still executed.
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
