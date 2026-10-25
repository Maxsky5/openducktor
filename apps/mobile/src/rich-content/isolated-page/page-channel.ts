/**
 * The JSON message channel between the app and an isolated page. Both sides validate every
 * message with the same Zod schemas: the app with `IsolatedPageView`, the page with
 * `page-src/shared/page-runtime.ts`. This module has no React Native import, so pages can bundle it.
 *
 * Each page posts `page_ready` once its message listener runs. The app sends no message before
 * that. A page channel lists only the page's own messages; the view adds `page_ready`.
 */
import { z } from "zod";

export const pageReadyMessageSchema = z.strictObject({ type: z.literal("page_ready") });

/** The message schemas of a page. Pages with the same messages can share one channel. */
export type PageChannel<Inbound, Outbound> = {
  /** Messages from the app to the page. */
  readonly inbound: z.ZodType<Inbound>;
  /** Messages from the page to the app, without `page_ready`. */
  readonly outbound: z.ZodType<Outbound>;
};

export const definePageChannel = <Inbound, Outbound>(
  inbound: z.ZodType<Inbound>,
  outbound: z.ZodType<Outbound>,
): PageChannel<Inbound, Outbound> => ({ inbound, outbound });

export type DecodedPageMessage<Message> =
  | { readonly ok: true; readonly message: Message }
  | { readonly ok: false; readonly error: string };

/** Validates a message before it leaves. An invalid message is a bug in the sender. */
export const encodePageMessage = <Message>(
  schema: z.ZodType<Message>,
  message: Message,
): string => {
  const parsed = schema.safeParse(message);
  if (!parsed.success) {
    throw new Error(`An isolated page message is not valid: ${z.prettifyError(parsed.error)}`);
  }
  return JSON.stringify(parsed.data);
};

const NOT_JSON = { ok: false, error: "The message is not JSON." } as const;

const readJson = (
  data: string,
): { readonly ok: true; readonly value: unknown } | typeof NOT_JSON => {
  try {
    return { ok: true, value: JSON.parse(data) };
  } catch {
    return NOT_JSON;
  }
};

export const decodePageMessage = <Message>(
  schema: z.ZodType<Message>,
  data: string,
): DecodedPageMessage<Message> => {
  const json = readJson(data);
  if (!json.ok) return json;
  const parsed = schema.safeParse(json.value);
  return parsed.success
    ? { ok: true, message: parsed.data }
    : { ok: false, error: z.prettifyError(parsed.error) };
};

/** A message from a page to the app: `page_ready`, or a message of the page channel. */
export type PageToAppMessage<Outbound> =
  | { readonly kind: "ready" }
  | { readonly kind: "message"; readonly message: Outbound };

/**
 * Decodes a message from a page to the app. It reads the JSON once for both schemas, because a
 * page message can be several megabytes.
 */
export const decodePageToAppMessage = <Outbound>(
  outbound: z.ZodType<Outbound>,
  data: string,
): DecodedPageMessage<PageToAppMessage<Outbound>> => {
  const json = readJson(data);
  if (!json.ok) return json;
  if (pageReadyMessageSchema.safeParse(json.value).success) {
    return { ok: true, message: { kind: "ready" } };
  }
  const parsed = outbound.safeParse(json.value);
  return parsed.success
    ? { ok: true, message: { kind: "message", message: parsed.data } }
    : { ok: false, error: z.prettifyError(parsed.error) };
};
