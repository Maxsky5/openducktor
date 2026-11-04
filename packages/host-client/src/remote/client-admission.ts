import {
  REMOTE_PROTOCOL_VERSION,
  remoteNegotiationResultSchema,
  type RemoteClientHello,
  type RemoteHostDescriptor,
  type RemoteClientKind,
  type RemoteConnectionRequest,
  type RemoteNegotiationResult,
} from "@openducktor/contracts";
import { z, type JSONType } from "zod";
import {
  authorizationMatches,
  type RemoteAuthorizationStore,
  type SavedRemoteAuthorization,
} from "./authorization";
import { RemoteConnectionError, remoteError } from "./transport";

type AcceptedNegotiation = Extract<RemoteNegotiationResult, { status: "accepted" }>;

/** Sends one negotiation to the host: `proof` is the saved access token, or null to pair. */
export type NegotiationPost = (
  payload: RemoteConnectionRequest,
  proof: string | null,
) => Promise<JSONType>;

/** An accepted negotiation and the saved access token that it used, or null after a pairing. */
export type ClientAdmissionResult = { accepted: AcceptedNegotiation; proof: string | null };

/**
 * The host ID of a discovered host that supports secure pairing and the required capabilities. The
 * client sends no credential to a host that fails this check.
 */
export const securePairingHostId = (
  discovered: RemoteHostDescriptor,
  hello: RemoteClientHello,
): string => {
  const hostId = z.uuid().safeParse(discovered.hostId);
  const advertised = discovered.protocols.find(
    (protocol) => protocol.version === REMOTE_PROTOCOL_VERSION,
  );
  if (discovered.accessPolicy !== "pairing" || !hostId.success || !advertised)
    throw new RemoteConnectionError({
      code: "protocol_mismatch",
      message: "This host does not support secure pairing.",
      nextAction: "Update OpenDucktor on the host before connecting.",
      updateSide: "host",
      host: discovered,
    });
  if (
    !hello.supportedProtocolVersions.includes(REMOTE_PROTOCOL_VERSION) ||
    hello.requiredCapabilities.some((capability) => !advertised.capabilities.includes(capability))
  )
    throw remoteError(
      "capability_missing",
      "The host and client do not share the required secure protocol capabilities.",
      "Update the host and this app to compatible versions.",
    );
  return hostId.data;
};

/** The protocol that the host accepted, after a check that it matches the discovery and the client. */
export const acceptedProtocol = (
  accepted: AcceptedNegotiation,
  discovered: RemoteHostDescriptor,
  hello: RemoteClientHello,
): RemoteHostDescriptor["protocols"][number] => {
  if (accepted.host.hostInstanceId !== discovered.hostInstanceId)
    throw remoteError(
      "unavailable",
      "The host restarted during negotiation.",
      "Reconnect to synchronize the current host.",
    );
  const negotiated = accepted.host.protocols.find(
    (protocol) => protocol.version === accepted.protocolVersion,
  );
  if (
    !hello.supportedProtocolVersions.includes(accepted.protocolVersion) ||
    !negotiated ||
    hello.requiredCapabilities.some((capability) => !negotiated.capabilities.includes(capability))
  )
    throw remoteError(
      "invalid_protocol",
      "The host accepted an unsupported protocol or omitted required capabilities.",
      "Update the host to implement its advertised remote contract.",
    );
  return negotiated;
};

const isRejectedAccess = (cause: unknown): cause is RemoteConnectionError =>
  cause instanceof RemoteConnectionError && cause.failure.code === "authorization_rejected";

/**
 * The saved access of one client for one host. It sends the saved token first, and the pairing code
 * after the host refuses the token. A refused token stays refused for this client.
 */
export const createClientAdmission = (options: {
  base: string;
  hello: RemoteClientHello;
  store: RemoteAuthorizationStore;
  clientKind: RemoteClientKind;
}) => {
  const refusedTokens = new Set<string>();
  /** The token of the current admission, so a later refusal can mark it. */
  let currentToken: string | null = null;

  /** The saved token for `hostId`, or null when the client pairs with a code. */
  const readProof = async (hostId: string, pairingCode: string | undefined) => {
    let saved: SavedRemoteAuthorization | null;
    try {
      saved = await options.store.read(options.base);
    } catch (cause) {
      if (!isRejectedAccess(cause))
        throw remoteError(
          "authorization_storage_failed",
          "Could not read saved access on this device.",
          "Check device storage permissions, then retry.",
        );
      if (pairingCode === undefined) throw cause;
      return null;
    }
    if (saved === null) return null;
    if (saved.endpoint !== options.base || !authorizationMatches(saved.authorization, hostId)) {
      if (pairingCode === undefined)
        throw remoteError(
          "authorization_rejected",
          "Saved access does not match this host.",
          "Enter the current host pairing code.",
        );
      return null;
    }
    return refusedTokens.has(saved.authorization.token) ? null : saved.authorization.token;
  };

  const negotiate = async (
    post: NegotiationPost,
    proof: string | null,
    pairingCode: string | undefined,
  ): Promise<RemoteNegotiationResult> => {
    const payload: RemoteConnectionRequest = { ...options.hello, clientKind: options.clientKind };
    if (proof === null && pairingCode !== undefined) payload.pairingCode = pairingCode;
    const result = remoteNegotiationResultSchema.safeParse(await post(payload, proof));
    if (!result.success)
      throw remoteError(
        "invalid_protocol",
        "Remote negotiation has an invalid shape.",
        "Update the host or correct the work endpoint.",
      );
    return result.data;
  };

  return {
    /**
     * Negotiates one connection with the saved token or the pairing code. `aborted` stops a retry
     * with the code after the host refused the token.
     */
    negotiate: async (input: {
      hostId: string;
      pairingCode: string | undefined;
      post: NegotiationPost;
      aborted(): boolean;
    }): Promise<ClientAdmissionResult> => {
      let proof = await readProof(input.hostId, input.pairingCode);
      let result: RemoteNegotiationResult;
      try {
        result = await negotiate(input.post, proof, input.pairingCode);
      } catch (cause) {
        if (!isRejectedAccess(cause) || !proof) throw cause;
        refusedTokens.add(proof);
        if (input.pairingCode === undefined || input.aborted()) throw cause;
        proof = null;
        result = await negotiate(input.post, null, input.pairingCode);
      }
      if (result.status === "rejected") throw new RemoteConnectionError(result.failure);
      return { accepted: result, proof };
    },
    /** Checks the grant of an accepted negotiation and saves new access on this device. */
    keep: async ({ accepted, proof }: ClientAdmissionResult, hostId: string): Promise<void> => {
      if (
        accepted.host.hostId !== hostId ||
        accepted.host.accessPolicy !== "pairing" ||
        Boolean(accepted.authorization) !== (proof === null) ||
        (accepted.authorization && !authorizationMatches(accepted.authorization, hostId))
      )
        throw remoteError(
          "invalid_protocol",
          "The host returned an invalid authorization grant.",
          "Update the host and this app, then retry.",
        );
      if (accepted.authorization) {
        try {
          await options.store.save({
            version: 1,
            endpoint: options.base,
            authorization: accepted.authorization,
          });
        } catch {
          throw remoteError(
            "authorization_storage_failed",
            "Could not save access on this device.",
            "Check device storage permissions, then enter a fresh host code.",
          );
        }
      }
      currentToken = accepted.authorization?.token ?? proof;
    },
    /** Marks the token of the current admission as refused, after the host revoked it. */
    refuseCurrent: (): void => {
      if (currentToken) refusedTokens.add(currentToken);
    },
  };
};

export type ClientAdmission = ReturnType<typeof createClientAdmission>;
