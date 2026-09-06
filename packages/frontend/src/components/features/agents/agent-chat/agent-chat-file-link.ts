import type { TaskExecutionSelectedFile } from "../task-execution-file-explorer-model";

export type ChatFileLink =
  | { kind: "external" | "fragment" }
  | { kind: "file"; file: TaskExecutionSelectedFile }
  | { kind: "invalid"; message: string };

const invalid = (message: string): ChatFileLink => ({ kind: "invalid", message });
const DRIVE = /^[a-z]:/i;
// URL schemes retain the shared renderer's sanitizer, including blocked executable URLs.
const URL_SCHEME = /^(?:https?|ircs?|mailto|xmpp|javascript|vbscript|data|blob):/i;
// oxlint-disable-next-line no-control-regex -- Control characters must never enter a filesystem path.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const ROOT_FILE_CITATION = /^(?:[^/:]+:[+-]?\d|[^/:]+\.[^/:]+:)/;

export const isChatLocalDestination = (href: string): boolean =>
  !URL_SCHEME.test(href) &&
  !href.startsWith("#") &&
  (DRIVE.test(href) || /^file:/i.test(href) || !SCHEME.test(href) || ROOT_FILE_CITATION.test(href));

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

export function resolveChatFileLink(href: string, rootPath: string | null): ChatFileLink {
  if (href.startsWith("#")) return { kind: "fragment" };
  if (!isChatLocalDestination(href)) return { kind: "external" };
  if (!rootPath) return invalid("The Task's Build Worktree is unavailable.");
  if (!href || CONTROL_CHARACTERS.test(href))
    return invalid("The file destination is empty or contains control characters.");
  const isFileUri = /^file:/i.test(href);
  if (isFileUri && !/^file:\/\/\//i.test(href))
    return invalid("Use a local file URI without a remote authority.");
  // Markdown encodes native backslashes; recognize separators before the single path decode.
  if (DRIVE.test(href) && !/^[a-z]:(?:[/\\]|%2f|%5c)/i.test(href))
    return invalid("Drive-relative file paths are not supported.");
  let path = href;
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
  if (/:(?![/\\])/.test(path.replace(/^file:/i, "").replace(DRIVE, "")))
    return invalid("The file line reference is invalid.");
  if (isFileUri) path = path.slice("file://".length);
  try {
    path = decodeURIComponent(path);
  } catch {
    return invalid("The file path has invalid percent encoding.");
  }
  if (CONTROL_CHARACTERS.test(path)) return invalid("The file path contains control characters.");
  const hasDrive = /^[a-z]:[/\\]/i.test(path) || (isFileUri && /^\/[a-z]:\//i.test(path));
  const windows = /^[a-z]:[/\\]/i.test(rootPath);
  if (windows && isFileUri && /^\/[a-z]:\//i.test(path)) path = path.slice(1);
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
