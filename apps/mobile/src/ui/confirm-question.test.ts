import { describe, expect, test } from "bun:test";
import { createQuestionSlot } from "./confirm-question";

const slotWithLog = () => {
  const shown: (string | null)[] = [];
  const slot = createQuestionSlot<string>((question) => shown.push(question));
  return { slot, shown };
};

describe("confirmation question slot", () => {
  test("resolves the open question with the answer and hides it", async () => {
    const { slot, shown } = slotWithLog();
    const answer = slot.ask("Delete the task?");
    slot.answer(true);
    expect(await answer).toBe(true);
    expect(shown).toEqual(["Delete the task?", null]);
  });

  test("answers an open question with false when a new question opens", async () => {
    const { slot, shown } = slotWithLog();
    const first = slot.ask("Discard the edits?");
    const second = slot.ask("Close the terminal?");
    expect(await first).toBe(false);
    slot.answer(true);
    expect(await second).toBe(true);
    expect(shown).toEqual(["Discard the edits?", "Close the terminal?", null]);
  });

  test("answers an open question with false when its screen closes", async () => {
    const { slot } = slotWithLog();
    const answer = slot.ask("Close the terminal?");
    slot.dispose();
    expect(await answer).toBe(false);
  });
});
