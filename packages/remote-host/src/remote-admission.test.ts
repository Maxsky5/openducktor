import { describe, expect, test } from "bun:test";
import {
  REMOTE_PAIRING_CODE_LIFETIME_MS,
  type RemoteConnectionRequest,
} from "@openducktor/contracts";
import { createSerialLane } from "@openducktor/host";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { createRemoteAdmission, type RemoteAdmission } from "./remote-admission";
import { memoryApprovalStore } from "./remote-approval.test-support";

const request = (pairingCode: string): RemoteConnectionRequest => ({
  appVersion: "client-1",
  supportedProtocolVersions: [4],
  requiredCapabilities: [],
  optionalCapabilities: [],
  clientKind: "browser",
  pairingCode,
});

/** Runs `body` with a loaded admission on a test clock. */
const withAdmission = (body: (admission: RemoteAdmission) => Effect.Effect<void, unknown>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const admission = createRemoteAdmission({
        lane: createSerialLane(),
        approvalStore: Effect.succeed(memoryApprovalStore()),
        available: () => true,
        onChange: () => {},
      });
      yield* admission.load;
      yield* body(admission);
      yield* admission.dispose();
    }).pipe(Effect.provide(TestClock.layer())),
  );

const openCode = (admission: RemoteAdmission): string => {
  const { pairing } = admission.view(true, new Set());
  if (!pairing) throw new Error("No pairing window is open.");
  return pairing.code;
};

/** A code that is not the open one. */
const wrongCode = (admission: RemoteAdmission): string =>
  openCode(admission) === "000000" ? "111111" : "000000";

const guessWrong = (admission: RemoteAdmission, times: number) =>
  Effect.gen(function* () {
    for (let guess = 0; guess < times; guess++)
      yield* Effect.flip(admission.port.authorize(request(wrongCode(admission)), null));
  });

describe("remote admission", () => {
  test("closes the window as expired after the code lifetime", async () => {
    await withAdmission((admission) =>
      Effect.gen(function* () {
        yield* admission.start();
        yield* TestClock.adjust(REMOTE_PAIRING_CODE_LIFETIME_MS);
        expect(admission.view(true, new Set())).toMatchObject({
          pairing: null,
          pairingEnd: "expired",
        });
      }),
    );
  });

  test("a renewal after expiry keeps the count of wrong codes", async () => {
    await withAdmission((admission) =>
      Effect.gen(function* () {
        yield* admission.start();
        yield* guessWrong(admission, 4);
        yield* TestClock.adjust(REMOTE_PAIRING_CODE_LIFETIME_MS);
        yield* admission.renew();
        yield* guessWrong(admission, 1);
        expect(admission.view(true, new Set())).toMatchObject({
          pairing: null,
          pairingEnd: "refused",
        });
      }),
    );
  });

  test("Add device after an expiry starts a new count of wrong codes", async () => {
    await withAdmission((admission) =>
      Effect.gen(function* () {
        yield* admission.start();
        yield* guessWrong(admission, 4);
        yield* TestClock.adjust(REMOTE_PAIRING_CODE_LIFETIME_MS);
        yield* admission.start();
        yield* guessWrong(admission, 4);
        expect(admission.view(true, new Set()).pairing).not.toBeNull();
      }),
    );
  });

  test("a renewal without an expired window starts a new count", async () => {
    await withAdmission((admission) =>
      Effect.gen(function* () {
        yield* admission.start();
        yield* guessWrong(admission, 4);
        admission.stop("stopped");
        yield* admission.renew();
        yield* guessWrong(admission, 4);
        expect(admission.view(true, new Set()).pairing).not.toBeNull();
      }),
    );
  });

  test("the right code pairs once and closes the window", async () => {
    await withAdmission((admission) =>
      Effect.gen(function* () {
        yield* admission.start();
        const code = openCode(admission);
        const grant = yield* admission.port.authorize(request(code), null);
        expect(grant.authorization?.token.startsWith(`${grant.clientId}.`)).toBe(true);
        expect(admission.view(true, new Set())).toMatchObject({
          pairing: null,
          pairingEnd: "paired",
        });
        const reused = yield* Effect.flip(admission.port.authorize(request(code), null));
        expect(reused.failure.code).toBe("pairing_refused");
      }),
    );
  });
});
