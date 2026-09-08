import { Effect } from "effect";
import { runWebSyncBoundary, WebValidationError } from "./effect/web-errors";

// Keep mount paths separate from unprefixed HTTP and WebSocket route namespaces.
const BACKEND_ROUTE_NAMESPACES = new Set([
  "health",
  "session",
  "shutdown",
  "events",
  "local-attachment-preview",
  "invoke",
  "task-events",
  "task-assets",
  "terminal",
]);

export const parseBasePathEffect = (
  raw: string | undefined,
  flag: string,
): Effect.Effect<string, WebValidationError> =>
  Effect.gen(function* () {
    if (raw === undefined) {
      return yield* new WebValidationError({
        message: `Missing value for ${flag}.`,
        field: flag,
      });
    }
    const trimmed = raw.trim().replace(/\/+$/u, "");
    const segments = trimmed.split("/");
    if (
      trimmed === "" ||
      !/^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/u.test(trimmed) ||
      segments.includes(".") ||
      segments.includes("..")
    ) {
      return yield* new WebValidationError({
        message: `Invalid ${flag} value: ${raw}. Expected a path starting with / with no empty, dot, or double-dot segments, query string, or fragment.`,
        field: flag,
        details: { raw },
      });
    }
    if (BACKEND_ROUTE_NAMESPACES.has(segments[1] ?? "")) {
      return yield* new WebValidationError({
        message: `Invalid ${flag} value: ${raw}. The first path segment conflicts with a backend route namespace. Use /api or another nonconflicting path.`,
        field: flag,
        details: { raw },
      });
    }
    return trimmed;
  });

export const validateExternalBrowserUrlEffect = (
  url: string,
): Effect.Effect<string, WebValidationError> =>
  Effect.gen(function* () {
    const trimmedUrl = url.trim();
    const parsedUrl = yield* Effect.try({
      try: () => new URL(trimmedUrl),
      catch: (cause) =>
        new WebValidationError({
          message: "OpenDucktor web can only open absolute http or https URLs.",
          cause,
          details: { url },
        }),
    });

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return yield* new WebValidationError({
        message: "OpenDucktor web can only open http or https URLs.",
        details: { url },
      });
    }

    return parsedUrl.href;
  });

export const validateExternalBrowserUrl = (url: string): string =>
  runWebSyncBoundary(validateExternalBrowserUrlEffect(url));
