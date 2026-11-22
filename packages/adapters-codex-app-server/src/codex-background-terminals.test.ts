import { describe, expect, test } from "bun:test";
import { CodexBackgroundTerminals } from "./codex-background-terminals";
import { codexCommandExecutionItemFixture } from "./test-fixtures/codex-protocol";

const startCommand = (terminals: CodexBackgroundTerminals, threadId: string) =>
  terminals.observeStarted(
    threadId,
    "turn-1",
    codexCommandExecutionItemFixture({
      id: "dev",
      command: `bun run dev:${threadId}`,
      processId: "dev-process",
      status: "inProgress",
      exitCode: null,
      aggregatedOutput: null,
    }),
  );

const tree = (threadId: string) =>
  new Set(threadId === "parent" ? ["parent", "child"] : [threadId]);

describe("CodexBackgroundTerminals", () => {
  test("fails the confirmation of a runtime at its release, and keeps the commands unconfirmed", async () => {
    const terminals = new CodexBackgroundTerminals(tree);
    startCommand(terminals, "parent");
    startCommand(terminals, "child");
    // A Stop waits for the parent command while the child release loses the child command.
    const [parentCommand] = terminals.tasksOf("parent");
    const stop = terminals.watchCommandEnds([parentCommand!]);
    expect(terminals.releaseThreads(["child"], "parent")).toBe(true);
    expect(terminals.lostIn("parent")?.message).toContain("'bun run dev:child'");

    terminals.close(new Error("The runtime was released."));

    const failure = await stop.confirmed().catch((cause: unknown) => cause);
    expect(String(failure)).toContain(
      "OpenDucktor stopped following the Codex session before Codex confirmed that these background commands ended: 'bun run dev:parent'.",
    );
    expect(terminals.ended(parentCommand!)).toBe(false);
  });

  test("fails each wait for a command of a thread whose event cannot be read", async () => {
    const terminals = new CodexBackgroundTerminals(tree);
    startCommand(terminals, "parent");
    startCommand(terminals, "child");
    const parentStop = terminals.watchCommandEnds(terminals.tasksOf("parent"));
    const childStop = terminals.watchCommandEnds(terminals.tasksOf("child"));

    terminals.loseThreadEvents("child", "invalid time");
    terminals.observeCompleted("parent", "dev");

    expect(String(await childStop.confirmed().catch((cause: unknown) => cause))).toContain(
      "OpenDucktor could not read a Codex event (invalid time), so it cannot confirm that these background commands ended: 'bun run dev:child'.",
    );
    await parentStop.confirmed();
    expect(terminals.tasksIn("parent").map(({ command }) => command)).toEqual([
      "bun run dev:child",
    ]);
  });
});
