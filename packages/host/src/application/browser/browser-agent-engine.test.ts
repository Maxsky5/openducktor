import { describe, expect, test } from "bun:test";
import type { BrowserEngineState } from "@openducktor/contracts";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { createBrowserEngineTestDouble } from "../../test-support/browser-engine-test-double";
import { readyBrowserEngineForAgent } from "./browser-agent-engine";

const DOWNLOADING: BrowserEngineState = {
  kind: "downloading",
  version: "1",
  receivedBytes: 0,
  totalBytes: 10 * 1024 * 1024,
};
const READY: BrowserEngineState = {
  kind: "ready",
  engine: "chrome_for_testing",
};

/**
 * A Chrome for Testing double. Like the real engine, a start changes no state at once: the test
 * reports each install step.
 */
const installingEngine = (initialState: BrowserEngineState) => {
  let starts = 0;
  const double = createBrowserEngineTestDouble({ initialState });
  const engine = {
    ...double.engine,
    installer: {
      start: () =>
        Effect.sync(() => {
          starts += 1;
        }),
      cancel: () => Effect.void,
    },
  };
  const report = (state: BrowserEngineState) => {
    double.setState(state);
    double.emit({ type: "state_changed", state });
  };
  return { engine, report, starts: () => starts };
};

/** Lets the call under test reach its wait. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("readyBrowserEngineForAgent", () => {
  test("starts the browser install on the first agent use and waits until it is ready", async () => {
    const { engine, report, starts } = installingEngine({
      kind: "not_installed",
      version: "1",
      downloadBytes: 10,
    });
    let finished = false;

    const ready = Effect.runPromise(readyBrowserEngineForAgent(engine, "test.agent")).then(() => {
      finished = true;
    });
    await settle();
    report(DOWNLOADING);
    report({ kind: "verifying", version: "1" });
    await settle();
    expect(finished).toBe(false);
    report(READY);

    await ready;
    expect(starts()).toBe(1);
  });

  test("tries the install again after a failure, and reports a new failure", async () => {
    const { engine, report, starts } = installingEngine({
      kind: "failed",
      reason: "The download stopped.",
      missingLibraries: [],
      canRetryDownload: true,
    });

    const result = Effect.runPromise(Effect.flip(readyBrowserEngineForAgent(engine, "test.agent")));
    await settle();
    report(DOWNLOADING);
    report({
      kind: "failed",
      reason: "The archive checksum does not match.",
      missingLibraries: [],
      canRetryDownload: true,
    });

    expect(await result).toMatchObject({
      code: "browser_not_ready",
      message: "The archive checksum does not match.",
    });
    expect(starts()).toBe(1);
  });

  test("returns the download progress when the install takes longer than the call can wait", async () => {
    const { engine, report } = installingEngine({
      kind: "not_installed",
      version: "1",
      downloadBytes: 10,
    });

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const call = yield* Effect.forkChild(
          Effect.flip(readyBrowserEngineForAgent(engine, "test.agent")),
        );
        yield* TestClock.adjust(0);
        report(DOWNLOADING);
        yield* TestClock.adjust(20_000);
        return yield* Fiber.join(call);
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(error).toMatchObject({ code: "browser_not_ready" });
    expect(error.message).toContain("downloading");
  });
});
