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
  ".zip",
]);

function selectPackageArtifacts(artifactPaths) {
  return artifactPaths
    .filter((artifactPath) => artifactFileExtensions.has(path.extname(artifactPath).toLowerCase()))
    .map((artifactPath) => path.resolve(artifactPath))
    .sort((left, right) => left.localeCompare(right));
}

function formatPackageArtifacts(artifacts) {
  return [
    "",
    "Generated package artifacts:",
    ...artifacts.map((artifactPath) => `  ${artifactPath}`),
  ].join("\n");
}

async function afterAllArtifactBuild(buildResult) {
  const artifacts = selectPackageArtifacts(buildResult.artifactPaths ?? []);

  if (artifacts.length > 0) {
    console.log(formatPackageArtifacts(artifacts));
  }

  return [];
}

exports.selectPackageArtifacts = selectPackageArtifacts;
exports.formatPackageArtifacts = formatPackageArtifacts;
exports.afterAllArtifactBuild = afterAllArtifactBuild;
exports.default = afterAllArtifactBuild;
