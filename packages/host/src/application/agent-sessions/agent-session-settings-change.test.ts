import { describe, expect, test } from "bun:test";
import { initialSpeedState, SessionTurnAdmission } from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createAgentSessionRuntimeAdapterTestDouble } from "../../test-support/service-test-doubles";
import { changeSessionSettings } from "./agent-session-settings-change";

const ref = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo/worktree",
  externalSessionId: "thread-1",
};
const failure = (message: string) => new HostOperationError({ operation: "test", message });

function harness() {
  const admission = new SessionTurnAdmission();
  let native = false;
  let saved = false;
  let state = initialSpeedState("standard", "confirmed");
  const adapter = createAgentSessionRuntimeAdapterTestDouble(
    { runtimeId: "runtime-1", runtimeKind: "codex" },
    {
      setSessionSpeedState: (_ref, next) =>
        Effect.sync(() => {
          state = next;
          admission.setBlocked(next.synchronization !== "confirmed");
        }),
    },
  );
  return {
    admission,
    get state() {
      return state;
    },
    get native() {
      return native;
    },
    get saved() {
      return saved;
    },
    change: (
      save: Effect.Effect<Effect.Effect<void, HostOperationError>, HostOperationError>,
      restoreFails = false,
    ) =>
      changeSessionSettings({
        adapter,
        ref,
        previous: state,
        choice: "fast",
        apply: Effect.sync(() => {
          native = true;
          return { reportedChoice: "fast" };
        }),
        restore: restoreFails
          ? Effect.fail(failure("restore failed"))
          : Effect.sync(() => {
              native = false;
              return { reportedChoice: "standard" };
            }),
        save: save.pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              saved = true;
            }),
          ),
        ),
      }),
  };
}

describe("session settings confirmation", () => {
  test("holds new turns until native acceptance and durable commit", async () => {
    const h = harness();
    const release = await h.admission.hold();
    let commit!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((done) => {
      entered = done;
    });
    const change = Effect.runPromise(
      h.change(
        Effect.promise(() => {
          entered();
          return new Promise<void>((done) => {
            commit = done;
          });
        }).pipe(Effect.as(Effect.void)),
      ),
    );
    await waiting;
    expect(h.native).toBe(true);
    expect(h.saved).toBe(false);
    expect(h.state.choice).toBe("standard");
    expect(h.state.synchronization).toBe("pending");
    await expect(h.admission.run(async () => "sent")).rejects.toThrow("pending");
    commit();
    await change;
    release();
    expect(await h.admission.run(async () => ({ native: h.native, saved: h.saved }))).toEqual({
      native: true,
      saved: true,
    });
  });

  test("restores the previous choice after a failed save", async () => {
    const h = harness();
    await expect(Effect.runPromise(h.change(Effect.fail(failure("save failed"))))).rejects.toThrow(
      "save failed",
    );
    expect(h.native).toBe(false);
    expect(h.saved).toBe(false);
    expect(h.state.choice).toBe("standard");
    expect(h.state.synchronization).toBe("confirmed");
    expect(await h.admission.run(async () => "sent")).toBe("sent");
  });

  test("keeps admission closed when rollback cannot establish the setting", async () => {
    const h = harness();
    await expect(
      Effect.runPromise(h.change(Effect.fail(failure("save failed")), true)),
    ).rejects.toThrow("could not be confirmed");
    expect(h.state.choice).toBe("standard");
    expect(h.state.synchronization).toBe("uncertain");
    await expect(h.admission.run(async () => "sent")).rejects.toThrow();
    await Effect.runPromise(h.change(Effect.succeed(Effect.void)));
    expect(await h.admission.run(async () => h.native)).toBe(true);
  });

  test("keeps the committed choice when publication fails", async () => {
    const h = harness();
    await expect(
      Effect.runPromise(h.change(Effect.succeed(Effect.fail(failure("publish failed"))))),
    ).rejects.toThrow("publish failed");
    expect(h.native).toBe(true);
    expect(h.saved).toBe(true);
    expect(h.state.choice).toBe("fast");
    expect(h.state.synchronization).toBe("confirmed");
  });
});
