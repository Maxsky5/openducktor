import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { imagePreviewMime, ODT_HTML_PREVIEW_MAX_STORED_BYTES } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type {
  HtmlPreviewFilePort,
  LocalPreviewImageReference,
} from "../../ports/html-preview-file-port";
import { isPathWithinRoot, readRegularFileNoFollow } from "./html-preview-fs";

const HTML_FILE_EXTENSION = /\.html?$/i;
const HTML_LEADING_COMMENTS = /^\s*(?:<!--[\s\S]*?-->\s*)*/;
const HTML_MARKUP_START =
  /^<(?:!doctype\s+html(?:\s[^>]*)?>|[a-z][a-z\d:-]*(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>)/i;

const isNetworkPath = (candidate: string): boolean =>
  candidate.startsWith("\\\\") || candidate.startsWith("//");

// Escape delimiters that would end an HTML attribute, srcset candidate, or CSS URL.
const escapeImageFragment = (fragment: string): string =>
  fragment.replace(
    /[\s"'\x60<>=&\\(),]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const resolveLocalImage = (
  reference: string,
  relative: boolean,
  baseDir?: string,
): LocalPreviewImageReference | null => {
  if (!relative && !/^file:\/\//i.test(reference)) {
    const filePath = /^[a-z]:/i.test(reference) ? reference.replaceAll("\\\\", "\\") : reference;
    const extension = path.extname(filePath).toLowerCase();
    const hash = filePath.indexOf("#");
    // Keep native filenames that contain a literal hash and end in a supported image extension.
    if (hash !== -1 && extension !== ".avif" && !imagePreviewMime(extension)) {
      const svgPath = filePath.slice(0, hash);
      if (path.extname(svgPath).toLowerCase() === ".svg") {
        return {
          filePath: svgPath,
          extension: ".svg",
          fragment: escapeImageFragment(filePath.slice(hash)),
        };
      }
    }
    return { filePath, extension, fragment: "" };
  }

  try {
    const directory =
      baseDir === undefined
        ? "file:///"
        : pathToFileURL(baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep);
    const url = new URL(reference, directory);
    // Classify a relative URL without a base directory without assigning it a host path.
    const filePath = relative && baseDir === undefined ? undefined : fileURLToPath(url);
    const pathname = filePath ?? decodeURIComponent(url.pathname);
    return {
      filePath,
      extension: path.extname(pathname).toLowerCase(),
      fragment: escapeImageFragment(url.hash),
    };
  } catch {
    return null;
  }
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
          message: `'${filePath}' is not a readable HTML file. Pass an absolute path to a regular .html or .htm file, or use inline html.`,
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
      const markup = html.replace(HTML_LEADING_COMMENTS, "");
      if (!HTML_MARKUP_START.test(markup)) {
        return yield* new HostValidationError({
          field: "path",
          message: `'${filePath}' is not an HTML document or fragment. Start the file with HTML markup, or use inline html.`,
        });
      }
      return { html, baseDir: path.dirname(filePath) };
    }),

  validateImageBaseDir: (baseDir, allowedRoots) =>
    Effect.gen(function* () {
      const invalidDirectory = new HostValidationError({
        field: "baseDir",
        message:
          "baseDir must be an absolute path to a directory in the workspace, worktree, or temporary directory.",
      });
      const policy = yield* resolvePathRootPolicy(allowedRoots, blockedRoots);
      const access = yield* checkPathRootAccess(baseDir, policy);
      if (access !== "ok") return yield* invalidDirectory;
      const entry = yield* Effect.tryPromise({
        try: () => stat(baseDir),
        catch: () => invalidDirectory,
      });
      if (!entry.isDirectory()) return yield* invalidDirectory;
    }),

  resolveLocalImage,

  readLocalImage: (filePath, allowedRoots, maxBytes) =>
    Effect.gen(function* () {
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
      };
    }),
});
