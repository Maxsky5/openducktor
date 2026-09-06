import type { TaskExecutionSelectedFile } from "../task-execution-file-explorer-model";

export type ChatFileLink =
  | { kind: "external" | "fragment" }
  | { kind: "file"; file: TaskExecutionSelectedFile }
  | { kind: "invalid"; message: string };

type InvalidFileLink = Extract<ChatFileLink, { kind: "invalid" }>;

const DRIVE = /^[a-z]:/i;
// Let the shared renderer handle URL schemes and block unsafe URLs.
const URL_SCHEME = /^(?:https?|ircs?|mailto|xmpp|javascript|vbscript|data|blob):/i;
// oxlint-disable-next-line no-control-regex -- Control characters must never enter a filesystem path.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const ROOT_FILE_CITATION = /^(?:[^/:]+:[+-]?\d|[^/:]+\.[^/:]+:)/;

// ASCII drive letters, literal or percent-encoded. Encoded colons remain filename characters.
const ENCODED_DRIVE = /^(?:[a-z]|%[46][1-9a-f]|%[57][0-9a]):/i;
const ENCODED_SEPARATOR = /^(?:[/\\]|%2f|%5c)/i;

/** Parse line suffixes before decoding so encoded colons and hashes stay in file names. */
export function resolveChatFileLink(href: string, rootPath: string | null): ChatFileLink {
  if (href.startsWith("#")) return { kind: "fragment" };
  if (!isChatLocalDestination(href)) return { kind: "external" };
  if (!rootPath) return invalid("The Task's Build Worktree is unavailable.");
  if (!href || CONTROL_CHARACTERS.test(href))
    return invalid("The file destination is empty or contains control characters.");
  const destination = parseFileDestination(href);
  if (destination.kind === "invalid") return destination;
  let path: string;
  try {
    path = decodeURIComponent(destination.path);
  } catch {
    return invalid("The file path has invalid percent encoding.");
  }
  if (CONTROL_CHARACTERS.test(path)) return invalid("The file path contains control characters.");
  if (/^file:/i.test(href) && /^\/[a-z]:[/\\]/i.test(path)) path = path.slice(1);
  return resolveWorktreeFile(path, rootPath);
}

export const isChatLocalDestination = (href: string): boolean =>
  !URL_SCHEME.test(href) &&
  !href.startsWith("#") &&
  (DRIVE.test(href) || /^file:/i.test(href) || !SCHEME.test(href) || ROOT_FILE_CITATION.test(href));

function parseFileDestination(href: string): { kind: "path"; path: string } | InvalidFileLink {
  const isFileUri = /^file:/i.test(href);
  if (isFileUri && !/^file:\/\/\//i.test(href))
    return invalid("Use a local file URI without a remote authority.");
  let path = isFileUri ? href.slice("file://".length) : href;
  // A drive colon belongs to the path, even when its letter is encoded.
  const drivePath = isFileUri ? path.slice(1) : path;
  const drive = ENCODED_DRIVE.exec(drivePath)?.[0];
  let prefix = "";
  if (drive) {
    path = drivePath.slice(drive.length);
    if (!ENCODED_SEPARATOR.test(path))
      return invalid("Drive-relative file paths are not supported.");
    prefix = (isFileUri ? "/" : "") + drive;
  }
  if (path.includes("?")) return invalid("File links do not support query strings.");
  const fragment = path.indexOf("#");
  if (fragment >= 0) {
    const match = /^#L([1-9]\d*)(?:-L([1-9]\d*))?$/.exec(path.slice(fragment));
    if (!match || (match[2] && Number(match[2]) < Number(match[1])))
      return invalid("The file line reference is invalid.");
    path = path.slice(0, fragment);
  }
  const location = /:([1-9]\d*)(?::([1-9]\d*))?$/.exec(path);
  if (location) path = path.slice(0, location.index);
  if (path.includes(":")) return invalid("The file line reference is invalid.");
  return { kind: "path", path: prefix + path };
}

function resolveWorktreeFile(path: string, rootPath: string): ChatFileLink {
  const hasDrive = /^[a-z]:[/\\]/i.test(path);
  const windows = /^[a-z]:[/\\]/i.test(rootPath);
  if (path.startsWith("//") || path.startsWith("\\\\"))
    return invalid("Network file paths are not supported.");
  if (windows) path = path.replaceAll("\\", "/");
  if ((hasDrive && (!windows || !/^[a-z]:\//i.test(path))) || (windows && path.startsWith("/")))
    return invalid("The absolute path does not match the Build Worktree platform.");
  if (!path || path.endsWith("/") || /(?:^|\/)\.{1,2}$/.test(path))
    return invalid("The destination must name a file.");
  const absolute = path.startsWith("/") || hasDrive;
  const parts = segments(path);
  if (!parts) return invalid("The file path leaves the Build Worktree.");
  const rootParts = segments(windows ? rootPath.replaceAll("\\", "/") : rootPath);
  if (!rootParts) return invalid("The Build Worktree path is invalid.");
  if (absolute) {
    const matchesRoot = rootParts.every((part, index) =>
      windows ? part.toLowerCase() === parts[index]?.toLowerCase() : part === parts[index],
    );
    if (!matchesRoot) return invalid("The file is outside the Task's Build Worktree.");
    parts.splice(0, rootParts.length);
  }
  if (!parts.length) return invalid("The destination must name a file.");
  return { kind: "file", file: { rootPath, relativePath: parts.join("/") } };
}

const segments = (path: string): string[] | null => {
  const result: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!result.length) return null;
      result.pop();
    } else result.push(part);
  }
  return result;
};

const invalid = (message: string): InvalidFileLink => ({
  kind: "invalid",
  message,
});
