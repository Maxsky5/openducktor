import { describe, expect, test } from "bun:test";
import {
  hasMeaningfulAgentUserMessageParts,
  normalizeAgentUserMessageParts,
  serializeAgentUserMessagePartsToText,
} from "./agent-user-message-parts";

const createCommand = () => ({
  id: "compact",
  trigger: "compact",
  title: "compact",
  hints: [],
});

describe("agent-user-message-parts", () => {
  test("merges adjacent text parts and trims only boundaries", () => {
    const command = createCommand();

    expect(
      normalizeAgentUserMessageParts([
        { kind: "text", text: "  hello" },
        { kind: "text", text: " world  " },
        { kind: "slash_command", command },
        { kind: "text", text: "  after  " },
      ]),
    ).toEqual([
      { kind: "text", text: "hello world  " },
      { kind: "slash_command", command },
      { kind: "text", text: "  after" },
    ]);
  });

  test("filters empty boundary text after trimming", () => {
    const command = createCommand();

    expect(
      normalizeAgentUserMessageParts([
        { kind: "text", text: "   " },
        { kind: "slash_command", command },
        { kind: "text", text: "   " },
      ]),
    ).toEqual([{ kind: "slash_command", command }]);
  });

  test("detects meaningful parts only after normalization", () => {
    const command = createCommand();

    expect(
      hasMeaningfulAgentUserMessageParts([
        { kind: "text", text: "   " },
        { kind: "text", text: "\n" },
      ]),
    ).toBe(false);
    expect(
      hasMeaningfulAgentUserMessageParts([
        { kind: "text", text: "   " },
        { kind: "slash_command", command },
      ]),
    ).toBe(true);
  });

  test("serializes mixed text and slash command parts", () => {
    const command = createCommand();

    expect(
      serializeAgentUserMessagePartsToText([
        { kind: "text", text: "  hi" },
        { kind: "text", text: ", there  " },
        { kind: "slash_command", command },
        { kind: "text", text: " -- now" },
      ]),
    ).toBe("hi, there  /compact -- now");
  });
});
