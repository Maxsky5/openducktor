import { describe, expect, test } from "bun:test";
import {
  CodexLiveCommandOutputs,
  LIVE_COMMAND_OUTPUT_CUT_NOTICE,
  LIVE_COMMAND_OUTPUT_INTERVAL_MS,
  LIVE_COMMAND_OUTPUT_TAIL_LENGTH,
  type LiveCommandOutputTimers,
} from "./codex-live-command-output";

/** Timers that run only when the test moves the clock. */
const createTimers = () => {
  let now = 1_000;
  let nextId = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  const timers: LiveCommandOutputTimers = {
    now: () => now,
    schedule: (run, delayMs) => {
      const id = nextId++;
      pending.set(id, { at: now + delayMs, run });
      return () => pending.delete(id);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of Array.from(pending)) {
      if (timer.at > now) continue;
      pending.delete(id);
      timer.run();
    }
  };
  return { timers, advance, pendingCount: () => pending.size };
};

const SESSION = { runtimeId: "runtime-1", threadId: "thread-1" };
const OTHER_SESSION = { ...SESSION, threadId: "thread-2" };

/** A queue that runs each update at once, as an empty runtime event queue does. */
const runNow = (_runtimeId: string, update: () => void): void => update();

describe("CodexLiveCommandOutputs", () => {
  test("shows the first chunk at once and later chunks at most once each interval", () => {
    const { timers, advance } = createTimers();
    const outputs = new CodexLiveCommandOutputs(runNow, timers);
    const shown: string[] = [];
    outputs.start(SESSION, "command-1", (output) => shown.push(output));

    outputs.append(SESSION, "command-1", "one\n");
    outputs.append(SESSION, "command-1", "two\n");
    outputs.append(SESSION, "command-1", "three\n");
    expect(shown).toEqual(["one\n"]);

    advance(LIVE_COMMAND_OUTPUT_INTERVAL_MS);
    expect(shown).toEqual(["one\n", "one\ntwo\nthree\n"]);
  });

  test("shows no update after the command ends", () => {
    const { timers, advance, pendingCount } = createTimers();
    const outputs = new CodexLiveCommandOutputs(runNow, timers);
    const shown: string[] = [];
    outputs.start(SESSION, "command-1", (output) => shown.push(output));
    outputs.append(SESSION, "command-1", "one\n");
    outputs.append(SESSION, "command-1", "two\n");

    outputs.finish(SESSION, "command-1");
    advance(LIVE_COMMAND_OUTPUT_INTERVAL_MS);
    outputs.append(SESSION, "command-1", "late\n");

    expect(shown).toEqual(["one\n"]);
    expect(pendingCount()).toBe(0);
  });

  test("sends a delayed update through the runtime queue, and drops it for a command that ended", () => {
    const { timers, advance } = createTimers();
    const queued: { runtimeId: string; update: () => void }[] = [];
    const outputs = new CodexLiveCommandOutputs(
      (runtimeId, update) => queued.push({ runtimeId, update }),
      timers,
    );
    const shown: string[] = [];
    outputs.start(SESSION, "command-1", (output) => shown.push(output));
    outputs.append(SESSION, "command-1", "one\n");
    outputs.append(SESSION, "command-1", "two\n");

    advance(LIVE_COMMAND_OUTPUT_INTERVAL_MS);
    // A chunk that comes while the update waits in the queue joins that update.
    outputs.append(SESSION, "command-1", "three\n");
    expect(queued.map(({ runtimeId }) => runtimeId)).toEqual(["runtime-1"]);
    expect(shown).toEqual(["one\n"]);
    queued.shift()?.update();
    expect(shown).toEqual(["one\n", "one\ntwo\nthree\n"]);

    advance(1);
    outputs.append(SESSION, "command-1", "four\n");
    advance(LIVE_COMMAND_OUTPUT_INTERVAL_MS);
    outputs.finish(SESSION, "command-1");
    queued.shift()?.update();
    expect(shown).toEqual(["one\n", "one\ntwo\nthree\n"]);
  });

  test("shows only the end of a long output", () => {
    const { timers } = createTimers();
    const outputs = new CodexLiveCommandOutputs(runNow, timers);
    const shown: string[] = [];
    outputs.start(SESSION, "command-1", (output) => shown.push(output));

    outputs.append(
      SESSION,
      "command-1",
      `start${"x".repeat(LIVE_COMMAND_OUTPUT_TAIL_LENGTH * 3)}end`,
    );

    const [output] = shown;
    expect(output?.startsWith(LIVE_COMMAND_OUTPUT_CUT_NOTICE)).toBe(true);
    expect(output?.endsWith("end")).toBe(true);
    expect(output).not.toContain("start");
    expect(output?.length).toBe(
      LIVE_COMMAND_OUTPUT_CUT_NOTICE.length + LIVE_COMMAND_OUTPUT_TAIL_LENGTH,
    );
  });

  test("forgets the commands of a released session", () => {
    const { timers, advance } = createTimers();
    const outputs = new CodexLiveCommandOutputs(runNow, timers);
    const shown: string[] = [];
    outputs.start(SESSION, "command-1", (output) => shown.push(`1:${output}`));
    outputs.start(OTHER_SESSION, "command-2", (output) => shown.push(`2:${output}`));

    outputs.finishAll("runtime-1", "thread-1");
    outputs.append(SESSION, "command-1", "a");
    outputs.append(OTHER_SESSION, "command-2", "b");
    advance(LIVE_COMMAND_OUTPUT_INTERVAL_MS);

    expect(shown).toEqual(["2:b"]);
  });
});
