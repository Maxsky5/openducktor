const path = require("node:path");

const artifactFileExtensions = new Set([
  ".appimage",
  ".appx",
  ".deb",
  ".dmg",
  ".exe",
  ".msi",
  ".pacman",
  ".rpm",
  ".snap",
]);

function collectAppBundles(outDir) {
  const fs = require("node:fs");
  const appBundles = [];

  if (typeof outDir !== "string" || !fs.existsSync(outDir)) {
    return appBundles;
  }

  const visit = (entryPath) => {
    const stats = fs.statSync(entryPath);

    if (!stats.isDirectory()) {
      return;
    }

    if (path.extname(entryPath).toLowerCase() === ".app") {
      appBundles.push(path.resolve(entryPath));
      return;
    }

    for (const child of fs.readdirSync(entryPath)) {
      visit(path.join(entryPath, child));
    }
  };

  visit(outDir);
  return appBundles;
}

function selectPackageArtifacts(buildResult) {
  const artifactPaths = buildResult.artifactPaths ?? [];
  const installableArtifacts = artifactPaths
    .filter((artifactPath) => artifactFileExtensions.has(path.extname(artifactPath).toLowerCase()))
    .map((artifactPath) => path.resolve(artifactPath));

  return [...collectAppBundles(buildResult.outDir), ...installableArtifacts].sort((left, right) =>
    left.localeCompare(right),
  );
}

function formatPackageArtifacts(artifacts) {
  return [
    "",
    "Generated package artifacts:",
    ...artifacts.map((artifactPath) => `  ${artifactPath}`),
  ].join("\n");
}

async function afterAllArtifactBuild(buildResult) {
  const artifacts = selectPackageArtifacts(buildResult);

  if (artifacts.length > 0) {
    console.log(formatPackageArtifacts(artifacts));
  }

  return [];
}

exports.selectPackageArtifacts = selectPackageArtifacts;
exports.formatPackageArtifacts = formatPackageArtifacts;
exports.afterAllArtifactBuild = afterAllArtifactBuild;
exports.default = afterAllArtifactBuild;
