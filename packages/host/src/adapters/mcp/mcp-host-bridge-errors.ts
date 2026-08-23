import {
  isJsonObject,
  jsonValueSchema,
  type JsonObject,
  type OdtToolErrorPayload,
  odtToolErrorCodeSchema,
} from "@openducktor/contracts";

type BridgeErrorPayload = OdtToolErrorPayload & Record<string, unknown>;

type BridgeErrorSource = {
  code?: unknown;
  details?: unknown;
};

const isRecord = (cause: unknown): cause is BridgeErrorSource =>
  typeof cause === "object" && cause !== null && !Array.isArray(cause);

const parseDetails = (cause: unknown): JsonObject | undefined => {
  if (!isRecord(cause)) {
    return undefined;
  }

  try {
    const parsed = jsonValueSchema.safeParse(cause.details);
    return parsed.success && isJsonObject(parsed.data) ? parsed.data : undefined;
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
