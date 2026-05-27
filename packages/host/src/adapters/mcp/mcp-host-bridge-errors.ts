import { type OdtToolErrorCode, odtToolErrorCodeSchema } from "@openducktor/contracts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export type BridgeErrorPayload = {
  code?: OdtToolErrorCode;
  details?: Record<string, unknown>;
  error: string;
};

export const bridgeErrorPayload = (error: unknown, message: string): BridgeErrorPayload => {
  const payload: BridgeErrorPayload = { error: message };
  if (!isRecord(error)) {
    return payload;
  }

  const parsedCode = odtToolErrorCodeSchema.safeParse(error.code);
  if (parsedCode.success) {
    payload.code = parsedCode.data;
  }
  if (isRecord(error.details)) {
    payload.details = error.details;
  }

  return payload;
};
