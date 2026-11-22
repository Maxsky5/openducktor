import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { HostResourceError } from "../effect/host-errors";
import { resolvePathSymlinkParts } from "../infrastructure/resolve-path-symlinks";

const readVolumeNameRule = `
ObjC.import("Foundation");

function getResourceValue(url, key) {
  const value = Ref();
  if (!url.getResourceValueForKeyError(value, key, null)) {
    throw new Error("Cannot read volume resource " + key);
  }
  return value[0];
}

function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  if (argv[1] === "apfs") {
    ObjC.import("AppKit");
    const mount = getResourceValue(url, $.NSURLVolumeURLKey);
    const type = Ref();
    const workspace = $.NSWorkspace.sharedWorkspace;
    if (!workspace.getFileSystemInfoForPathIsRemovableIsWritableIsUnmountableDescriptionType(
      mount.path, null, null, null, null, type
    )) {
      throw new Error("Cannot read filesystem type");
    }
    const name = ObjC.unwrap(type[0]);
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("Invalid filesystem type");
    }
    return String(name === "apfs");
  }
  const caseSensitive = ObjC.unwrap(getResourceValue(url, $.NSURLVolumeSupportsCaseSensitiveNamesKey));
  if (typeof caseSensitive !== "boolean") {
    throw new Error("Invalid volume case sensitivity");
  }
  return String(!caseSensitive);
}
`;

function checkMacVolume(existingPath: string, rule: "apfs" | "case-insensitive"): boolean {
  try {
    const output = execFileSync(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", readVolumeNameRule, existingPath, rule],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 3000 },
    ).trim();
    if (output === "true") return true;
    if (output === "false") return false;
    throw new Error("macOS returned an invalid volume rule value");
  } catch (cause) {
    throw new HostResourceError({
      message: `Cannot check ${rule === "apfs" ? "filesystem type" : "case sensitivity"} for the config directory volume at ${existingPath}. Set OPENDUCKTOR_CONFIG_DIR to a separate directory with a different name.`,
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
  const left = production.remainingPath;
  const right = selected.remainingPath;
  if (path.relative(left, right) === "") {
    return isSameExistingPath(production.existingPath, selected.existingPath);
  }
  if (process.platform !== "darwin") return false;

  const sameIgnoringCase = left.toLowerCase() === right.toLowerCase();
  const leftNfc = left.normalize("NFC");
  const rightNfc = right.normalize("NFC");
  const sameAfterNormalization = leftNfc === rightNfc;
  const sameAfterBoth = leftNfc.toLowerCase() === rightNfc.toLowerCase();
  if (
    (!sameIgnoringCase && !sameAfterBoth) ||
    !isSameExistingPath(production.existingPath, selected.existingPath)
  ) {
    return false;
  }

  const normalizesNames =
    (sameAfterNormalization || !sameIgnoringCase) &&
    checkMacVolume(production.existingPath, "apfs");
  if (sameAfterNormalization && normalizesNames) return true;
  return (
    (sameIgnoringCase || (sameAfterBoth && normalizesNames)) &&
    checkMacVolume(production.existingPath, "case-insensitive")
  );
}
