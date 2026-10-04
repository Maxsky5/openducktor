import type { OpenCodeCreationSettings } from "@openducktor/contracts";
import {
  isAbsolutePath,
  normalizePathSeparators,
  trimTrailingPathSeparators,
} from "@openducktor/path-support";
import { posix, win32 } from "node:path";
import type { OpencodeSessionPolicy } from "./opencode-session-policy";
import type { SessionRecord } from "./types";
import { unwrapData } from "./data-utils";
import { toOpenCodeRequestError } from "./request-errors";
import {
  type OwnedPermissionSpan,
  type PermissionOwnership,
} from "./opencode-permission-ownership";
import type { OpencodePermissionRule } from "./workflow-tool-permissions";

const pathPermissions = new Set(["read", "edit", "list", "external_directory"]);
const filePermissions = new Set(["read", "edit"]);
const homePrefix = /^(?:~(?=\/|$)|\$HOME(?=\/|$))/;

export const buildCreationPermissions = async (input: {
  settings: OpenCodeCreationSettings;
  policy: OpencodeSessionPolicy;
  native: OpencodePermissionRule[];
  client: SessionRecord["client"];
  workingDirectory: string;
}): Promise<{ permission: OpencodePermissionRule[]; ownership: PermissionOwnership }> => {
  const rules = [...input.settings.defaults, ...input.settings.role];
  const needsHome = rules.some(
    (rule) => pathPermissions.has(rule.permission) && homePrefix.test(rule.pattern),
  );
  const needsWorktree = rules.some(
    (rule) =>
      filePermissions.has(rule.permission) &&
      (homePrefix.test(rule.pattern) || isAbsolutePath(rule.pattern)),
  );
  let paths: { home: string; worktree: string } | undefined;
  if (needsHome || needsWorktree) {
    const action = `read the selected OpenCode runtime paths for session permission setup in '${input.workingDirectory}'. Reconnect the runtime or update OpenCode if its path API is unsupported`;
    try {
      paths = unwrapData(
        await input.client.path.get({ directory: input.workingDirectory }),
        action,
      );
      if (needsHome && !paths.home?.trim())
        throw new Error("OpenCode did not return its home directory.");
      if (needsWorktree && (!paths.worktree?.trim() || !isAbsolutePath(paths.worktree)))
        throw new Error("OpenCode did not return an absolute worktree path.");
    } catch (error) {
      throw toOpenCodeRequestError(action, error);
    }
  }
  const compile = (rules: OpencodePermissionRule[]) =>
    rules.map((rule) => {
      let pattern = rule.pattern;
      if (paths && pathPermissions.has(rule.permission)) {
        const home = trimTrailingPathSeparators(paths.home);
        pattern = pattern.replace(homePrefix, () => home);
        if (filePermissions.has(rule.permission) && isAbsolutePath(pattern)) {
          pattern = filePattern(paths.worktree, pattern);
        }
      }
      return { ...rule, pattern };
    });
  const permission = [...input.native];
  const spans: OwnedPermissionSpan[] = [];
  const context = input.policy.scope.kind === "workflow" ? input.policy.scope.role : "repository";
  for (const [layer, rules] of [
    ["defaults", compile(input.settings.defaults)],
    ["role", compile(input.settings.role)],
    ["mandatory", input.policy.permission],
  ] as const) {
    if (rules.length > 0)
      spans.push({
        layer,
        context,
        start: permission.length,
        rules: rules.map((rule) => ({ ...rule })),
      });
    permission.push(...rules);
  }
  return { permission, ownership: { version: 1, legacyAmbiguous: false, spans } };
};

/** OpenCode reads and edits use worktree-relative inputs. External-directory inputs stay absolute. */
const filePattern = (worktree: string, pattern: string): string => {
  const path = /^(?:[a-z]:|[\\/]{2})/i.test(worktree) ? win32 : posix;
  const wildcard = pattern.search(/[*?]/);
  if (wildcard === -1) {
    const relative = path.relative(worktree, pattern);
    return path === win32 ? normalizePathSeparators(relative) : relative;
  }
  const split = Math.max(
    pattern.lastIndexOf("/", wildcard),
    path === win32 ? pattern.lastIndexOf("\\", wildcard) : -1,
  );
  const prefix = pattern.slice(0, split + 1);
  const nested = path.relative(prefix, worktree);
  // A wildcard above the worktree can also match the worktree itself. Removing that prefix changes its meaning.
  if (
    nested &&
    nested !== ".." &&
    !nested.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(nested)
  ) {
    throw new Error(
      `Cannot map file permission pattern '${pattern}' to OpenCode worktree '${worktree}' because a wildcard spans the worktree root. Use a worktree-relative pattern and retry.`,
    );
  }
  const relative = path.relative(worktree, prefix);
  const compiled = relative
    ? `${relative}${path.sep}${pattern.slice(split + 1)}`
    : pattern.slice(split + 1);
  return path === win32 ? normalizePathSeparators(compiled) : compiled;
};
