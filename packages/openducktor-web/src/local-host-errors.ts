import { Effect } from "effect";
import { errorMessage, runWebBoundary, WebDependencyError } from "./effect/web-errors";

export type LocalHostErrorPayload = { message: string; payload: unknown | null };

const parseStructuredErrorPayload = (trimmedText: string): LocalHostErrorPayload | null => {
  try {
    const payload = JSON.parse(trimmedText) as { error?: unknown; message?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return { message: payload.error, payload };
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return { message: payload.message, payload };
    }
  } catch {
    return null;
  }

  return null;
};

export const readLocalHostErrorPayloadEffect = (
  response: Response,
): Effect.Effect<LocalHostErrorPayload, WebDependencyError> =>
  Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "local-web-host",
          operation: "read-error-response",
          message: errorMessage(cause),
          cause,
          details: { status: response.status },
        }),
    });
    const trimmedText = text.trim();

    if (trimmedText) {
      const structuredPayload = parseStructuredErrorPayload(trimmedText);
      if (structuredPayload) {
        return structuredPayload;
      }

      return { message: trimmedText, payload: null };
    }

    return {
      message: `OpenDucktor web host request failed with status ${response.status}.`,
      payload: null,
    };
  });

export const readLocalHostErrorPayload = (response: Response): Promise<LocalHostErrorPayload> =>
  runWebBoundary(readLocalHostErrorPayloadEffect(response));
