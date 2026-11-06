import { Effect } from "effect";
import { type HostErrorResponse, hostErrorResponseSchema } from "@openducktor/contracts";
import {
  errorMessage,
  runWebBoundary,
  WebDependencyError,
} from "@openducktor/remote-host/effect/web-errors";

export type LocalHostErrorPayload = { message: string; payload: HostErrorResponse | null };

/** The structured payload of a JSON error body, or null for another body. */
const parseStructuredErrorPayload = (trimmedText: string): LocalHostErrorPayload | null => {
  let value: unknown;
  try {
    value = JSON.parse(trimmedText);
  } catch {
    return null;
  }
  const parsed = hostErrorResponseSchema.safeParse(value);
  const message = parsed.success ? (parsed.data.error ?? parsed.data.message) : undefined;
  if (!parsed.success || !message) return null;
  return { message, payload: parsed.data };
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
      return parseStructuredErrorPayload(trimmedText) ?? { message: trimmedText, payload: null };
    }

    return {
      message: `OpenDucktor web host request failed with status ${response.status}.`,
      payload: null,
    };
  });

export const readLocalHostErrorPayload = (response: Response): Promise<LocalHostErrorPayload> =>
  runWebBoundary(readLocalHostErrorPayloadEffect(response));
