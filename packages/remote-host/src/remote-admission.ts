import {
  REMOTE_PAIRING_CODE_LIFETIME_MS,
  type RemoteAccessState,
  type RemoteAuthorization,
  type RemoteConnectionRequest,
  type RemoteFailure,
  type RemotePairingEnd,
  parseRemoteAuthorizationToken,
  readBearerToken,
  remoteAuthorizationTokenSchema,
} from "@openducktor/contracts";
import type {
  RemoteApprovalStore,
  RemoteApprovalStoreError,
  RemoteClientApproval,
  SerialLane,
} from "@openducktor/host";
import { Clock, Data, Effect, Exit, Scope, type Fiber } from "effect";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

export class RemoteAccessError extends Data.TaggedError("RemoteAccessError")<{
  readonly failure: RemoteFailure;
}> {}

/** The client that a check admits, and the new saved access after a pairing. */
export type RemoteAdmissionGrant = { clientId: string; authorization?: RemoteAuthorization };

/**
 * The admission port of remote work. `run` keeps the host admission order, so a revoke never runs
 * between a check and the connection that it admits.
 */
export type RemoteAdmissionPort = {
  run: SerialLane["run"];
  authorize(
    input: RemoteConnectionRequest,
    proof: string | null,
  ): Effect.Effect<RemoteAdmissionGrant, RemoteAccessError>;
};

/** Wrong codes that close a pairing window. */
const MAX_FAILED_GUESSES = 5;

/** The SHA-256 of a saved access token. The host stores only this hash. */
const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest();

const refused = (
  code: RemoteFailure["code"],
  message: string,
  nextAction = "On the host, select Add device in Remote control, then enter the new code.",
) => new RemoteAccessError({ failure: { code, message, nextAction } });

export const remoteDisabled = (): RemoteAccessError =>
  refused(
    "remote_disabled",
    "Remote control is off.",
    "Turn on Remote control on the host, then retry.",
  );

const storageFailure = (cause: { message: string }) =>
  new RemoteAccessError({
    failure: {
      code: "authorization_storage_failed",
      message: cause.message,
      nextAction: "Check the host remote-access directory and its permissions, then retry.",
    },
  });

/**
 * The pairing window, the saved approvals, and the checks of saved access and pairing codes. All
 * calls run in the controller lane.
 */
export const createRemoteAdmission = (options: {
  lane: SerialLane;
  approvalStore: Effect.Effect<RemoteApprovalStore, RemoteApprovalStoreError>;
  /** True while remote control accepts connections. */
  available(): boolean;
  /** Runs after the host closes a pairing window by itself: a pairing, an expiry, or a refusal. */
  onChange(): void;
}) => {
  const scope = Scope.makeUnsafe();
  let store: RemoteApprovalStore | null = null;
  let approvals: RemoteClientApproval[] = [];
  let pairing: RemoteAccessState["pairing"] = null;
  let pairingExpiry: Fiber.Fiber<void> | null = null;
  let pairingEnd: RemotePairingEnd | null = null;
  let failedGuesses = 0;

  const clientReference = (id: string) => {
    let length = 8;
    while (
      approvals.some(
        (client) => client.clientId !== id && client.clientId.startsWith(id.slice(0, length)),
      )
    )
      length += 4;
    return id.slice(0, length);
  };
  /** Closes the pairing window. A later code needs a new request. */
  const close = (end: RemotePairingEnd | null) => {
    pairing = null;
    pairingEnd = end;
    pairingExpiry?.interruptUnsafe();
    pairingExpiry = null;
  };
  const open = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      close(null);
      const now = yield* Clock.currentTimeMillis;
      pairing = {
        code: randomInt(0, 1_000_000).toString().padStart(6, "0"),
        expiresAt: new Date(now + REMOTE_PAIRING_CODE_LIFETIME_MS).toISOString(),
      };
      const opened = pairing;
      pairingExpiry = yield* Effect.forkIn(
        Effect.sleep(REMOTE_PAIRING_CODE_LIFETIME_MS).pipe(
          Effect.andThen(
            options.lane.run(
              Effect.sync(() => {
                if (pairing !== opened) return;
                // Clear this handle first so this fiber does not interrupt itself.
                pairingExpiry = null;
                close("expired");
                options.onChange();
              }),
            ),
          ),
        ),
        scope,
      );
    });
  const authorize = (
    input: RemoteConnectionRequest,
    proof: string | null,
  ): Effect.Effect<RemoteAdmissionGrant, RemoteAccessError> =>
    Effect.gen(function* () {
      if (!store || !options.available()) return yield* remoteDisabled();
      if (proof !== null && input.pairingCode !== undefined)
        return yield* refused("invalid_protocol", "Submit one authorization proof only.");
      if (proof !== null) {
        const token = readBearerToken(proof, remoteAuthorizationTokenSchema);
        const clientId = token && parseRemoteAuthorizationToken(token)?.clientId;
        if (!token || !clientId)
          return yield* refused("authorization_rejected", "Saved access is invalid or revoked.");
        const approval = yield* store.read(clientId).pipe(Effect.mapError(storageFailure));
        if (!approval || !timingSafeEqual(hashToken(token), Buffer.from(approval.tokenHash, "hex")))
          return yield* refused("authorization_rejected", "Saved access is invalid or revoked.");
        return { clientId };
      }
      if (input.pairingCode === undefined)
        return yield* refused("authorization_required", "Enter the pairing code from this host.");
      const now = yield* Clock.currentTimeMillis;
      if (!pairing || Date.parse(pairing.expiresAt) <= now)
        return yield* refused("pairing_refused", "No pairing code is open on the host.");
      if (input.pairingCode !== pairing.code) {
        failedGuesses += 1;
        // Wrong guesses close the window, so guessing never outlasts one operator request.
        if (failedGuesses >= MAX_FAILED_GUESSES) {
          close("refused");
          options.onChange();
        }
        return yield* refused(
          "pairing_refused",
          "The pairing code is wrong, expired, or already used.",
        );
      }
      const clientId = randomUUID();
      const token = `${clientId}.${randomBytes(32).toString("base64url")}`;
      const approval: RemoteClientApproval = {
        clientId,
        clientKind: input.clientKind,
        tokenHash: hashToken(token).toString("hex"),
      };
      yield* store.create(approval).pipe(Effect.mapError(storageFailure));
      approvals.push(approval);
      close("paired");
      options.onChange();
      return { clientId, authorization: { hostId: store.hostId, clientId, token } };
    });

  return {
    port: { run: options.lane.run, authorize } satisfies RemoteAdmissionPort,
    /** Opens the store once and reads the saved approvals again. */
    load: Effect.gen(function* () {
      if (!store) {
        const acquired = yield* Effect.result(options.approvalStore);
        if (acquired._tag === "Failure") return yield* storageFailure(acquired.failure);
        store = acquired.success;
      }
      approvals = yield* store.list().pipe(Effect.mapError(storageFailure));
      return store;
    }),
    /** Opens a pairing window with a new code and a new count of wrong codes. */
    start: (): Effect.Effect<void> =>
      Effect.suspend(() => {
        failedGuesses = 0;
        return open();
      }),
    /**
     * Gives a new code when the open window or the last window expired. The count of wrong codes
     * stays, so renewals never give fresh guesses. In other states it starts a new window.
     */
    renew: (): Effect.Effect<void> =>
      Effect.suspend(() => {
        if (!pairing && pairingEnd !== "expired") failedGuesses = 0;
        return open();
      }),
    /** Closes the pairing window. `null` means that remote control stopped. */
    stop: close,
    revoke: (clientId: string): Effect.Effect<void, RemoteAccessError> =>
      Effect.gen(function* () {
        if (!store) return yield* remoteDisabled();
        yield* store.revoke(clientId).pipe(Effect.mapError(storageFailure));
        approvals = approvals.filter((client) => client.clientId !== clientId);
      }),
    /** The pairing and device fields of the operator state. */
    view: (
      available: boolean,
      connected: ReadonlySet<string>,
    ): Pick<RemoteAccessState, "pairing" | "pairingEnd" | "clients"> => ({
      pairing: available ? pairing : null,
      ...(available && !pairing && pairingEnd && { pairingEnd }),
      clients: approvals.map((client) => ({
        clientId: client.clientId,
        kind: client.clientKind,
        reference: clientReference(client.clientId),
        status: connected.has(client.clientId) ? "connected" : "offline",
      })),
    }),
    dispose: (): Effect.Effect<void> => Scope.close(scope, Exit.void),
  };
};

export type RemoteAdmission = ReturnType<typeof createRemoteAdmission>;
