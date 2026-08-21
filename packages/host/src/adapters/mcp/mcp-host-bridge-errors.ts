import {
  jsonValueSchema,
  type JsonValue,
  type OdtToolErrorPayload,
  odtToolErrorCodeSchema,
} from "@openducktor/contracts";

type BridgeErrorPayload = OdtToolErrorPayload & Record<string, JsonValue>;

const isRecord = (cause: unknown): cause is Record<string, unknown> =>
  typeof cause === "object" && cause !== null && !Array.isArray(cause);

const isJsonRecord = (value: JsonValue): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseDetails = (cause: unknown): Record<string, JsonValue> | undefined => {
  if (!isRecord(cause)) {
    return undefined;
  }

  try {
    const parsed = jsonValueSchema.safeParse(cause.details);
    return parsed.success && isJsonRecord(parsed.data) ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

export const bridgeErrorPayload = (cause: unknown, message: string): BridgeErrorPayload => {
  const parsedCode = isRecord(cause)
    ? odtToolErrorCodeSchema.safeParse(cause.code)
    : { success: false as const };
  const details = parseDetails(cause);

  if (details) {
    return {
      ok: false,
      error: {
        code: parsedCode.success ? parsedCode.data : "ODT_HOST_BRIDGE_ERROR",
        message,
        details,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: parsedCode.success ? parsedCode.data : "ODT_HOST_BRIDGE_ERROR",
      message,
    },
  };
};

export const bridgeMessagePayload = (message: string): OdtToolErrorPayload =>
  bridgeErrorPayload(null, message);
