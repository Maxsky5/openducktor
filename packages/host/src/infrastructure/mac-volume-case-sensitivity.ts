import { execFileSync } from "node:child_process";
import { HostResourceError } from "../effect/host-errors";

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

export function macVolumeSupportsCaseSensitiveNames(existingPath: string): boolean {
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
