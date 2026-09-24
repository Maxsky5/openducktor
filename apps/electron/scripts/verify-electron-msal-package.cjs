const { existsSync, readdirSync, realpathSync, statSync } = require("node:fs");
const { createRequire } = require("node:module");
const { join, relative, resolve, sep } = require("node:path");
const { pathToFileURL } = require("node:url");

const brokerBinarySuffixes = [".node", ".dll", ".dylib", ".so"];

const requireFile = (path) => {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`Packaged MSAL persistence file is missing: ${path}`);
  }
};

const listFiles = (directory) => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
};

const requirePackagedModule = (packagedRequire, request, appAsar) => {
  const path = packagedRequire.resolve(request);
  const withinApp = relative(realpathSync(appAsar), realpathSync(path));
  if (withinApp.startsWith(`..${sep}`) || withinApp === ".." || withinApp.startsWith(sep)) {
    throw new Error(`Packaged module resolved outside app.asar: ${request} at ${path}`);
  }
  return packagedRequire(request);
};

const verifyPackagedMsalPackage = (
  resourcesDirectory,
  platform = process.platform,
  arch = process.arch,
) => {
  const appAsar = join(resourcesDirectory, "app.asar");
  const unpacked = join(resourcesDirectory, "app.asar.unpacked");
  const runtimePath = join("node_modules", "@azure", "msal-node-runtime");
  const extensionPath = join("node_modules", "@azure", "msal-node-extensions");
  const brokerFiles = [appAsar, unpacked]
    .flatMap((root) => listFiles(join(root, runtimePath, "dist")))
    .filter((path) => brokerBinarySuffixes.some((suffix) => path.endsWith(suffix)));
  if (brokerFiles.length > 0) {
    throw new Error(
      `Unused MSAL broker binaries returned to the package (${brokerFiles.length} files): ${brokerFiles.slice(0, 3).join(", ")}`,
    );
  }

  requireFile(join(appAsar, runtimePath, "package.json"));
  requireFile(join(appAsar, runtimePath, "dist", "index.cjs"));
  requireFile(join(appAsar, extensionPath, "package.json"));
  requireFile(join(appAsar, extensionPath, "dist", "index.mjs"));
  requireFile(join(unpacked, "node_modules", "keytar", "build", "Release", "keytar.node"));
  const packagedRequire = createRequire(join(appAsar, "package.json"));
  const runtime = requirePackagedModule(packagedRequire, "@azure/msal-node-runtime", appAsar);
  const extension = requirePackagedModule(packagedRequire, "@azure/msal-node-extensions", appAsar);
  if (!runtime.msalNodeRuntime) {
    throw new Error("The packaged MSAL runtime JavaScript module did not load.");
  }
  for (const name of [
    "PersistenceCachePlugin",
    "PersistenceCreator",
    "KeychainPersistence",
    "LibSecretPersistence",
    "FilePersistenceWithDataProtection",
  ]) {
    if (!extension[name]) {
      throw new Error(`The packaged MSAL persistence export is missing: ${name}`);
    }
  }

  if (platform === "darwin" || platform === "linux") {
    const keytar = requirePackagedModule(packagedRequire, "keytar", appAsar);
    if (!keytar.getPassword || !keytar.setPassword) {
      throw new Error("The packaged keytar native module did not load.");
    }
  }
  if (platform === "win32") {
    const dpapiPath = join(appAsar, extensionPath, "bin", arch, "dpapi.node");
    requireFile(join(unpacked, extensionPath, "bin", arch, "dpapi.node"));
    const dpapi = packagedRequire(dpapiPath);
    if (!dpapi.protectData || !dpapi.unprotectData) {
      throw new Error("The packaged Windows DPAPI native module did not load.");
    }
  }
  return { runtimePath: packagedRequire.resolve("@azure/msal-node-runtime") };
};

module.exports = { verifyPackagedMsalPackage };

if (require.main === module) {
  const run = async () => {
    const resourcesDirectory = process.argv[2];
    if (!resourcesDirectory) throw new Error("Expected the packaged app resources directory.");
    const result = verifyPackagedMsalPackage(resolve(resourcesDirectory));
    const extensionEsmPath = join(
      resolve(resourcesDirectory),
      "app.asar",
      "node_modules",
      "@azure",
      "msal-node-extensions",
      "dist",
      "index.mjs",
    );
    const extensionEsm = await import(pathToFileURL(extensionEsmPath).href);
    if (!extensionEsm.PersistenceCachePlugin || !extensionEsm.PersistenceCreator) {
      throw new Error("The packaged MSAL persistence ESM module did not load.");
    }
    console.log(`Verified packaged MSAL persistence and native storage: ${result.runtimePath}`);
  };
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
