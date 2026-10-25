import { expect, test } from "bun:test";
import { sessionForkDisabledReason } from "./session-fork-availability";

const ready = { state: "ready" as const, message: null };
const base = {
  runtimeReadiness: ready,
  interactionEnabled: true,
  readOnly: false,
  readOnlyReason: null,
  error: null,
};

test("a ready, open session can fork", () => {
  expect(sessionForkDisabledReason(base)).toBeNull();
});

test("names the first reason that blocks a fork", () => {
  expect(
    sessionForkDisabledReason({
      ...base,
      runtimeReadiness: { state: "checking", message: null },
      readOnly: true,
    }),
  ).toBe("Start the runtime before forking this reply.");
  expect(sessionForkDisabledReason({ ...base, readOnly: true })).toBe(
    "Reopen this chat before forking a reply.",
  );
  expect(sessionForkDisabledReason({ ...base, error: "The host is offline." })).toBe(
    "The host is offline.",
  );
  expect(sessionForkDisabledReason({ ...base, interactionEnabled: false })).toBe(
    "Load this chat before forking a reply.",
  );
});
