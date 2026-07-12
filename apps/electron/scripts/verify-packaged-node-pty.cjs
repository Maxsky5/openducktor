const { access } = require("node:fs/promises");
const { join } = require("node:path");

exports.default = async function verifyPackagedNodePty(context) {
  const root = join(
    context.appOutDir,
    "resources",
    "app.asar.unpacked",
    "node_modules",
    "node-pty",
  );
  const platform =
    context.electronPlatformName === "win32" ? "win32" : context.electronPlatformName;
  const arch = context.arch === 1 ? "x64" : context.arch === 3 ? "arm64" : process.arch;
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
    await access(join(root, "build", "Release", "spawn-helper")).catch(async () => {
      await access(join(root, "prebuilds", `${platform}-${arch}`, "spawn-helper"));
    });
  }
};
