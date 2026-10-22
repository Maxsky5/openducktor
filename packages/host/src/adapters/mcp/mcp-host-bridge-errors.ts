import { type OdtToolErrorPayload, odtToolErrorCodeSchema } from "@openducktor/contracts";
import { z } from "zod";
import {
  BrowserServiceError,
  browserServiceErrorToFailure,
} from "../../application/browser/browser-service-error";
import type { OdtMcpBrowserBridgeError } from "../../application/mcp/odt-mcp-bridge-service";

const errorDetailsSchema = z.record(z.string(), z.json());

/** The agent reads the message. `details.browserFailure` keeps the browser failure code. */
const browserErrorPayload = (cause: BrowserServiceError): OdtToolErrorPayload => ({
  ok: false,
  error: {
    code: "ODT_TOOL_EXECUTION_ERROR",
    message: cause.message,
    details: errorDetailsSchema.parse({ browserFailure: browserServiceErrorToFailure(cause) }),
  },
});

export const bridgeErrorPayload = (
  cause: OdtMcpBrowserBridgeError | null,
  message: string,
): OdtToolErrorPayload => {
  if (cause instanceof BrowserServiceError) {
    return browserErrorPayload(cause);
  }
  const parsedCode = cause && "code" in cause ? odtToolErrorCodeSchema.safeParse(cause.code) : null;
  const code = parsedCode?.success ? parsedCode.data : "ODT_HOST_BRIDGE_ERROR";
  const rawDetails = cause && "details" in cause ? cause.details : undefined;

  if (rawDetails !== undefined) {
    const details = errorDetailsSchema.parse(rawDetails);
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
