import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ODT_HTML_PREVIEW_MAX_STORED_BYTES } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { HtmlPreviewFilePort } from "../../ports/html-preview-file-port";
import { isPathWithinRoot, readRegularFileNoFollow } from "./html-preview-fs";

const HTML_FILE_EXTENSION = /\.html?$/i;
// Judge bytes, not filenames alone: a renamed secret or .env does not start like an HTML document.
const HTML_DOCUMENT_START = /^\s*<(?:!doctype\s+html|html)[\s>]/i;

const isNetworkPath = (candidate: string): boolean =>
  candidate.startsWith("\\\\") || candidate.startsWith("//");

const normalizeReferencePath = (reference: string): string | null => {
  if (/^file:\/\//i.test(reference)) {
    try {
      return fileURLToPath(reference);
    } catch {
      return null;
    }
  }
  return /^[a-z]:/i.test(reference) ? reference.replaceAll("\\\\", "\\") : reference;
};

const formatMib = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

/**
 * Resolves symlinks on the target path or, when the file is missing or a broken symlink, walks up
 * to the nearest existing ancestor directory and canonicalizes it. This ensures paths under a
 * symlinked allowed root (such as macOS `/var/folders/...` -> `/private/var/folders/...`) stay
 * classified inside their real root instead of falling back to `outside_allowed`.
 */
const resolveWithNearestAncestor = async (filePath: string): Promise<string> => {
  const resolved = path.resolve(filePath);
  const trailing: string[] = [];
  let current = resolved;
  while (true) {
    try {
      const canonical = await realpath(current);
      return trailing.length === 0 ? canonical : path.join(canonical, ...trailing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return resolved;
      trailing.push(path.basename(current));
      current = parent;
    }
  }
};

const resolveCanonicalRoot = (root: string): Effect.Effect<string> =>
  Effect.promise(() => resolveWithNearestAncestor(root));

type PathRootPolicy = {
  allowedRoots: readonly string[];
  blockedRoots: readonly string[];
};

const resolvePathRootPolicy = (
  allowedRoots: readonly string[],
  blockedRoots: readonly string[],
): Effect.Effect<PathRootPolicy> =>
  Effect.gen(function* () {
    const resolvedAllowed = yield* Effect.forEach(allowedRoots, resolveCanonicalRoot);
    const resolvedBlocked = yield* Effect.forEach(blockedRoots, resolveCanonicalRoot);
    return {
      allowedRoots: [...new Set(resolvedAllowed)],
      blockedRoots: [...new Set(resolvedBlocked)],
    };
  });

type RootAccessCheck = "ok" | "blocked" | "outside_allowed" | "unreadable";

const evaluateRootAccess = (resolved: string, policy: PathRootPolicy): RootAccessCheck => {
  const isAllowed = policy.allowedRoots.some((allowed) =>
    isPathWithinRoot(resolved, allowed, { allowEqual: true }),
  );
  // A blocked root (such as `~/.openducktor`) still rejects files unless a more specific allowed
  // root nested inside it (such as `~/.openducktor/worktrees/<workspace>`) explicitly covers them.
  const isBlocked = policy.blockedRoots.some(
    (blocked) =>
      isPathWithinRoot(resolved, blocked, { allowEqual: true }) &&
      !policy.allowedRoots.some(
        (allowed) =>
          isPathWithinRoot(allowed, blocked, { allowEqual: false }) &&
          isPathWithinRoot(resolved, allowed, { allowEqual: true }),
      ),
  );
  if (isBlocked) return "blocked";
  if (!isAllowed) return "outside_allowed";
  return "ok";
};

const checkPathRootAccess = (
  filePath: string,
  policy: PathRootPolicy,
): Effect.Effect<RootAccessCheck> => {
  if (!path.isAbsolute(filePath) || isNetworkPath(filePath)) {
    return Effect.succeed("unreadable");
  }
  return Effect.promise(async (): Promise<RootAccessCheck> => {
    const resolved = await resolveWithNearestAncestor(filePath);
    return evaluateRootAccess(resolved, policy);
  });
};

export const createNodeHtmlPreviewFilePort = ({
  blockedRoots,
}: {
  blockedRoots: readonly string[];
}): HtmlPreviewFilePort => ({
  readHtmlFile: (filePath, allowedRoots) =>
    Effect.gen(function* () {
      if (
        !path.isAbsolute(filePath) ||
        isNetworkPath(filePath) ||
        !HTML_FILE_EXTENSION.test(filePath)
      ) {
        return yield* new HostValidationError({
          field: "path",
          message: `'${filePath}' is not a readable HTML document. Pass an absolute path to a regular .html file that starts with <!doctype html> or <html>, or pass html instead.`,
        });
      }

      const policy = yield* resolvePathRootPolicy(allowedRoots, blockedRoots);
      const rootCheck = yield* checkPathRootAccess(filePath, policy);
      if (rootCheck === "blocked") {
        return yield* new HostValidationError({
          field: "path",
          message: `'${filePath}' is inside the OpenDucktor config directory and cannot be published.`,
        });
      }
      if (rootCheck === "outside_allowed") {
        return yield* new HostValidationError({
          field: "path",
          message: `'${filePath}' is outside the workspace, worktree, and temporary directories and cannot be published.`,
        });
      }

      const opened = yield* readRegularFileNoFollow(filePath, {
        maxBytes: ODT_HTML_PREVIEW_MAX_STORED_BYTES,
        requireSingleLink: true,
      });
      if (opened.kind === "symlink") {
        return yield* new HostValidationError({
          field: "path",
          message: `'${filePath}' is a symlink. Pass the real path to a regular .html file, or pass html instead.`,
        });
      }
      if (opened.kind === "hardlink") {
        return yield* new HostValidationError({
          field: "path",
          message: `'${filePath}' is hard-linked to another path. Write a dedicated .html file or pass html instead.`,
        });
      }
      if (opened.kind === "too_large") {
        return yield* new HostValidationError({
          field: "path",
          message: `'${filePath}' is ${formatMib(opened.size)}; a published HTML file must be at most ${formatMib(ODT_HTML_PREVIEW_MAX_STORED_BYTES)}.`,
        });
      }
      if (opened.kind !== "ok") {
        return yield* new HostValidationError({
          field: "path",
          message: `'${filePath}' is not a readable HTML document. Pass an absolute path to a regular .html file, or pass html instead.`,
        });
      }

      const html = opened.bytes.toString("utf8");
      if (!HTML_DOCUMENT_START.test(html)) {
        return yield* new HostValidationError({
          field: "path",
          message: `'${filePath}' is not an HTML document. Start the file with <!doctype html> or <html>, or pass html instead.`,
        });
      }
      return html;
    }),

  readLocalImage: (reference, allowedRoots, maxBytes) =>
    Effect.gen(function* () {
      const filePath = normalizeReferencePath(reference);
      if (!filePath) return { kind: "invalid" as const };
      const policy = yield* resolvePathRootPolicy(allowedRoots, blockedRoots);
      const rootCheck = yield* checkPathRootAccess(filePath, policy);
      if (rootCheck === "blocked") return { kind: "blocked" as const };
      if (rootCheck === "outside_allowed") return { kind: "outside_allowed" as const };
      if (rootCheck !== "ok") return { kind: "invalid" as const };

      const opened = yield* readRegularFileNoFollow(filePath, {
        maxBytes,
        requireSingleLink: true,
      });
      if (opened.kind === "too_large") return { kind: "too_large" as const, size: opened.size };
      if (opened.kind !== "ok") return { kind: "invalid" as const };
      return {
        kind: "ok" as const,
        bytes: opened.bytes,
        size: opened.size,
        extension: path.extname(filePath).toLowerCase(),
      };
    }),
});
