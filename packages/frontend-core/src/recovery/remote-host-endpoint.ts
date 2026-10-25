import { remoteEndpointSchema } from "@openducktor/contracts";

export type RemoteHostEndpointOptions = {
  /** True when the client page uses HTTPS, so a browser cannot reach an HTTP host. */
  requireHttps: boolean;
};

/**
 * Applies the shared host address rules and returns the canonical endpoint. It throws an `Error`
 * with the rule message, so each client shows the same reason.
 */
export const parseRemoteHostEndpoint = (
  value: string,
  { requireHttps }: RemoteHostEndpointOptions,
): string => {
  const endpoint = value.trim();
  const result = remoteEndpointSchema.safeParse(endpoint);
  if (!result.success) throw new Error(result.error.issues.map((issue) => issue.message).join(" "));
  const url = new URL(endpoint);
  if (requireHttps && url.protocol !== "https:") {
    throw new Error("This web app needs an HTTPS host address. Use the host's HTTPS endpoint.");
  }
  return url.href.replace(/\/$/, "");
};
