import { describe, expect, mock, test } from "bun:test";
import {
  answerOnce,
  createBrowserEndSignal,
  createBrowserPermissionRequest,
} from "./browser-engine-lifecycle";

describe("createBrowserEndSignal", () => {
  test("ends once, and calls a listener that comes after the end at once", () => {
    const signal = createBrowserEndSignal<string>();
    const early = mock((_reason: string) => {});
    const removed = mock((_reason: string) => {});
    signal.onEnded(early);
    signal.onEnded(removed)();

    signal.end("closed");
    signal.end("again");
    const late = mock((_reason: string) => {});
    signal.onEnded(late);

    expect(signal.isEnded()).toBe(true);
    expect(signal.reason()).toBe("closed");
    expect(early.mock.calls).toEqual([["closed"]]);
    expect(removed).not.toHaveBeenCalled();
    expect(late.mock.calls).toEqual([["closed"]]);
  });
});

describe("answerOnce", () => {
  test("takes the first answer only", () => {
    const answer = mock((_value: boolean) => {});
    const respond = answerOnce(answer);
    respond(true);
    respond(false);
    expect(answer.mock.calls).toEqual([[true]]);
  });
});

describe("createBrowserPermissionRequest", () => {
  test("settles with the first of an answer and an end", () => {
    const answered = { onRespond: mock((_granted: boolean) => {}), onEnd: mock(() => {}) };
    const request = createBrowserPermissionRequest(answered);
    const ended = mock(() => {});
    request.onEnded(ended);
    request.respond(true);
    request.end();
    expect(answered.onRespond.mock.calls).toEqual([[true]]);
    expect(answered.onEnd).not.toHaveBeenCalled();
    expect(ended).not.toHaveBeenCalled();

    const dropped = { onRespond: mock((_granted: boolean) => {}), onEnd: mock(() => {}) };
    const endedRequest = createBrowserPermissionRequest(dropped);
    endedRequest.end();
    endedRequest.respond(true);
    const late = mock(() => {});
    endedRequest.onEnded(late);
    expect(dropped.onEnd).toHaveBeenCalledTimes(1);
    expect(dropped.onRespond).not.toHaveBeenCalled();
    expect(late).toHaveBeenCalledTimes(1);
  });
});
