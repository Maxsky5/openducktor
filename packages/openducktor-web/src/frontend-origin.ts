import { Effect } from "effect";
import { WebValidationError } from "@openducktor/remote-host/effect/web-errors";
import { parseHttpOriginEffect, portOfHttpOrigin } from "@openducktor/remote-host/http-origin";

export const validateFrontendOriginEffect = (
  origin: string,
): Effect.Effect<string, WebValidationError> =>
  Effect.gen(function* () {
    const trimmed = origin.trim();
    if (!trimmed) {
      return yield* new WebValidationError({
        field: "frontendOrigin",
        message: "browser frontend origin cannot be empty",
      });
    }

    const parsed = yield* parseHttpOriginEffect(trimmed, "browser frontend origin", {
      field: "frontendOrigin",
    });
    return parsed.origin;
  });

export const allowedFrontendOrigins = (
  frontendOrigin: string,
  frontendPort?: number,
): Set<string> => {
  const parsed = new URL(frontendOrigin);
  const port = String(frontendPort ?? Number(portOfHttpOrigin(parsed)));
  const loopbackOrigins = ["127.0.0.1", "localhost", "[::1]"].map(
    (host) => new URL(`http://${host}:${port}`).origin,
  );
  const origins = new Set([parsed.origin, ...loopbackOrigins]);
  parsed.hostname = parsed.hostname.replace(/\.$/u, "");
  origins.add(parsed.origin);
  return origins;
};
