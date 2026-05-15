const fs = require("node:fs");
const path = require("node:path");

const displayedArtifactExtensions = new Set([
  ".app",
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
  const appBundles = [];

  const visit = (entryPath) => {
    const stats = fs.statSync(entryPath);

    if (!stats.isDirectory()) {
      return;
    }

    if (displayedArtifactExtensions.has(path.extname(entryPath).toLowerCase())) {
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
  const installableArtifacts = buildResult.artifactPaths
    .filter((artifactPath) =>
      displayedArtifactExtensions.has(path.extname(artifactPath).toLowerCase()),
    )
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

  console.log(formatPackageArtifacts(artifacts));

  return [];
}

exports.selectPackageArtifacts = selectPackageArtifacts;
exports.formatPackageArtifacts = formatPackageArtifacts;
exports.afterAllArtifactBuild = afterAllArtifactBuild;
exports.default = afterAllArtifactBuild;
