import { describe, expect, spyOn, test } from "bun:test";
import { linkSignals } from "./linked-signal";

/** Counts the abort listeners that stay on a signal. */
const watchListeners = (signal: AbortSignal) => {
  const added = spyOn(signal, "addEventListener");
  const removed = spyOn(signal, "removeEventListener");
  return () => added.mock.calls.length - removed.mock.calls.length;
};

describe("linkSignals", () => {
  test("aborts with the reason of the source that aborts", () => {
    const first = new AbortController();
    const second = new AbortController();
    const linked = linkSignals([first.signal, second.signal]);

    second.abort(new Error("The view closed."));

    expect(linked.signal.aborted).toBe(true);
    expect(linked.signal.reason).toEqual(new Error("The view closed."));
    first.abort(new Error("Later."));
    expect(linked.signal.reason).toEqual(new Error("The view closed."));
  });

  test("starts aborted when a source has aborted", () => {
    const source = new AbortController();
    source.abort(new Error("Already gone."));

    expect(linkSignals([source.signal]).signal.reason).toEqual(new Error("Already gone."));
  });

  test("leaves no listener on a source after unlink or an abort", () => {
    const connection = new AbortController();
    const request = new AbortController();
    const listenersOnConnection = watchListeners(connection.signal);
    const listenersOnRequest = watchListeners(request.signal);

    linkSignals([connection.signal, request.signal]).unlink();
    const aborted = linkSignals([connection.signal, request.signal]);
    request.abort();

    expect(aborted.signal.aborted).toBe(true);
    expect(listenersOnConnection()).toBe(0);
    expect(listenersOnRequest()).toBe(0);
  });

  test("stops following its sources after unlink", () => {
    const source = new AbortController();
    const linked = linkSignals([source.signal]);

    linked.unlink();
    source.abort();

    expect(linked.signal.aborted).toBe(false);
  });
});
