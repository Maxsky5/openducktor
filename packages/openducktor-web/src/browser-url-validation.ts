import { Effect } from "effect";
import { runWebSyncBoundary, WebValidationError } from "./effect/web-errors";

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
