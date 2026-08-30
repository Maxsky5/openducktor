import { Effect } from "effect";
import { type HostErrorResponse, hostErrorResponseSchema } from "@openducktor/contracts";
import { errorMessage, runWebBoundary, WebDependencyError } from "./effect/web-errors";

export type LocalHostErrorPayload = { message: string; payload: HostErrorResponse | null };

type StructuredErrorPayloadResult =
  | { kind: "parsed"; value: LocalHostErrorPayload }
  | {
      kind: "invalid";
      cause: { readonly issues: readonly { readonly path: readonly PropertyKey[] }[] };
    }
  | { kind: "plain-text" };

const parseStructuredErrorPayload = (trimmedText: string): StructuredErrorPayloadResult => {
  let value: unknown;
  try {
    value = JSON.parse(trimmedText);
  } catch {
    return { kind: "plain-text" };
  }

  const parsed = hostErrorResponseSchema.safeParse(value);
  if (!parsed.success) {
    return { kind: "invalid", cause: parsed.error };
  }

  const message = parsed.data.error ?? parsed.data.message;
  if (!message) {
    return { kind: "plain-text" };
  }

  return { kind: "parsed", value: { message, payload: parsed.data } };
};

const readLocalHostErrorPayloadWithPolicyEffect = (
  response: Response,
  rejectInvalidInvokeFailure: boolean,
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
      if (structuredPayload.kind === "parsed") {
        return structuredPayload.value;
      }
      if (
        rejectInvalidInvokeFailure &&
        structuredPayload.kind === "invalid" &&
        structuredPayload.cause.issues.some((issue) => issue.path[0] === "failure")
      ) {
        return yield* new WebDependencyError({
          dependency: "local-web-host",
          operation: "parse-invoke-failure",
          message: "The local host returned an invalid invoke failure envelope.",
          cause: structuredPayload.cause,
        });
      }

      return { message: trimmedText, payload: null };
    }

    return {
      message: `OpenDucktor web host request failed with status ${response.status}.`,
      payload: null,
    };
  });

export const readLocalHostErrorPayloadEffect = (
  response: Response,
): Effect.Effect<LocalHostErrorPayload, WebDependencyError> =>
  readLocalHostErrorPayloadWithPolicyEffect(response, false);

export const readLocalHostInvokeErrorPayloadEffect = (
  response: Response,
): Effect.Effect<LocalHostErrorPayload, WebDependencyError> =>
  readLocalHostErrorPayloadWithPolicyEffect(response, true);

export const readLocalHostErrorPayload = (response: Response): Promise<LocalHostErrorPayload> =>
  runWebBoundary(readLocalHostErrorPayloadEffect(response));
