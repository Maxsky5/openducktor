import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useConfirmationOutcome } from "./use-confirmation-outcome";

type Request = { id: number; action: string };

const renderOutcome = () => {
  const events: string[] = [];
  const hook = renderHook(() =>
    useConfirmationOutcome<Request>({
      onStarted: (request) => events.push(`started ${request.id}`),
      onSucceeded: (request) => events.push(`succeeded ${request.id}`),
      onFailed: (request) => events.push(`failed ${request.id}`),
    }),
  );
  return { events, outcome: () => hook.result.current, unmount: hook.unmount };
};

const DELETE: Request = { id: 1, action: "delete" };

describe("useConfirmationOutcome", () => {
  test("reports a success once, after the confirmation closed", () => {
    const { events, outcome } = renderOutcome();
    outcome().started(DELETE);
    outcome().succeeded(DELETE);
    expect(events).toEqual(["started 1"]);

    outcome().closed(DELETE.id);
    outcome().closed(DELETE.id);
    expect(events).toEqual(["started 1", "succeeded 1"]);
  });

  test("reports a failure when the confirmation closes without a success", () => {
    const { events, outcome } = renderOutcome();
    outcome().started(DELETE);
    outcome().closed(DELETE.id);
    expect(events).toEqual(["started 1", "failed 1"]);
  });

  test("reports nothing for a cancel or for the close of another request", () => {
    const { events, outcome } = renderOutcome();
    outcome().closed(DELETE.id);
    outcome().started(DELETE);
    outcome().succeeded(DELETE);
    outcome().closed(2);
    expect(events).toEqual(["started 1"]);
  });

  test("reports a success at once when the confirmation unmounted first", () => {
    const { events, outcome, unmount } = renderOutcome();
    const { started, succeeded } = outcome();
    started(DELETE);
    unmount();
    succeeded(DELETE);
    expect(events).toEqual(["started 1", "succeeded 1"]);
  });
});
