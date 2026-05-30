import { type OdtToolErrorPayload, odtToolErrorCodeSchema } from "@openducktor/contracts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const bridgeErrorPayload = (error: unknown, message: string): OdtToolErrorPayload => {
  const parsedCode = isRecord(error)
    ? odtToolErrorCodeSchema.safeParse(error.code)
    : { success: false as const };
  const details = isRecord(error) && isRecord(error.details) ? error.details : undefined;

  return {
    ok: false,
    error: {
      code: parsedCode.success ? parsedCode.data : "ODT_HOST_BRIDGE_ERROR",
      message,
      ...(details ? { details } : {}),
    },
  };
};

export const bridgeMessagePayload = (message: string): OdtToolErrorPayload =>
  bridgeErrorPayload(null, message);
