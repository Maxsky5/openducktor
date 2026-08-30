import { type OdtToolErrorPayload, odtToolErrorCodeSchema } from "@openducktor/contracts";
import { z } from "zod";
import type { OdtMcpBridgeError } from "../../application/mcp/odt-mcp-bridge-service";

export const bridgeErrorPayload = (
  cause: OdtMcpBridgeError | null,
  message: string,
): OdtToolErrorPayload => {
  const parsedCode = cause && "code" in cause ? odtToolErrorCodeSchema.safeParse(cause.code) : null;
  const code = parsedCode?.success ? parsedCode.data : "ODT_HOST_BRIDGE_ERROR";
  const rawDetails = cause && "details" in cause ? cause.details : undefined;

  if (rawDetails !== undefined) {
    const details = z.record(z.string(), z.json()).parse(rawDetails);
    return {
      ok: false,
      error: { code, message, details },
    };
  }

  return {
    ok: false,
    error: { code, message },
  };
};

export const bridgeMessagePayload = (message: string): OdtToolErrorPayload =>
  bridgeErrorPayload(null, message);
