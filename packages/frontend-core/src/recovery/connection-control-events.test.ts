import { describe, expect, test } from "bun:test";
import { CONNECTION_STREAM_WARNING_EVENT_KIND } from "./connection-control-events";
import { connectionStreamWarningEvent } from "./connection-control-events";

describe("browser-live-control-events", () => {
  test("preserves empty-string messages", () => {
    expect(connectionStreamWarningEvent("")).toEqual({
      __openducktorConnectionControl: true,
      kind: CONNECTION_STREAM_WARNING_EVENT_KIND,
      message: "",
    });
  });
});
