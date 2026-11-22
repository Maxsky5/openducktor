import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { HostResourceError } from "../effect/host-errors";
import { resolvePathSymlinkParts } from "../infrastructure/resolve-path-symlinks";

const readVolumeCaseSensitivity = `
ObjC.import("Foundation");

function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const value = Ref();
  if (!url.getResourceValueForKeyError(value, $.NSURLVolumeSupportsCaseSensitiveNamesKey, null)) {
    throw new Error("Cannot read volume case sensitivity");
  }
  return String(ObjC.unwrap(value[0]));
}
`;

function macVolumeSupportsCaseSensitiveNames(existingPath: string): boolean {
  try {
    const output = execFileSync(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", readVolumeCaseSensitivity, existingPath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 3000 },
    ).trim();
    if (output === "true") return true;
    if (output === "false") return false;
    throw new Error("macOS returned an invalid volume case sensitivity value");
  } catch (cause) {
    throw new HostResourceError({
      message: `Cannot check case sensitivity for the config directory volume at ${existingPath}. Set OPENDUCKTOR_CONFIG_DIR to a separate directory with a different name.`,
      resource: "config-directory-volume",
      operation: "openducktor.resolve-config-dir",
      cause,
    });
  }
}

function isSameExistingPath(left: string, right: string): boolean {
  if (path.relative(left, right) === "") return true;

  // macOS firmlinks can name the same existing directory with different resolved paths.
  const leftStat = statSync(left, { bigint: true });
  const rightStat = statSync(right, { bigint: true });
  return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
}

export function isSameConfigDirectory(selectedRoot: string, productionRoot: string): boolean {
  const selected = resolvePathSymlinkParts(selectedRoot);
  if (selectedRoot === productionRoot) return true;

  const production = resolvePathSymlinkParts(productionRoot);
  const sameRemainingPath = path.relative(production.remainingPath, selected.remainingPath) === "";
  const possibleMacCaseAlias =
    process.platform === "darwin" &&
    production.remainingPath.toLowerCase() === selected.remainingPath.toLowerCase();
  return (
    (sameRemainingPath || possibleMacCaseAlias) &&
    isSameExistingPath(production.existingPath, selected.existingPath) &&
    (sameRemainingPath || !macVolumeSupportsCaseSensitiveNames(production.existingPath))
  );
}
