import { expect, mock, test } from "bun:test";
import { createRebaseConflictActionsModel } from "./rebase-conflict-actions";

test("createRebaseConflictActionsModel supports modal-specific handlers without mutating shared labels", () => {
  const abort = mock(() => {});
  const askBuilder = mock(() => {});

  const actions = createRebaseConflictActionsModel({
    isHandlingRebaseConflict: true,
    rebaseConflictAction: "ask_builder",
    onAbort: abort,
    onAskBuilder: askBuilder,
  });

  expect(actions.isDisabled).toBe(true);
  expect(actions.abort.label).toBe("Abort rebase");
  expect(actions.askBuilder.label).toBe("Sending to Builder...");

  actions.abort.onClick();
  actions.askBuilder.onClick();

  expect(abort).toHaveBeenCalledTimes(1);
  expect(askBuilder).toHaveBeenCalledTimes(1);
});
