import { buildSession } from "../events/session-events-test-harness";
import { applyLoadedSessionHistory } from "./session-history-chat-messages";
import { expect, test } from "bun:test";
import type { AgentImageGenerationPart } from "@openducktor/contracts";
import { mergeReadonlyRuntimeHistory } from "@/components/features/agents/agent-chat/readonly-transcript/readonly-transcript-session";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import {
  createImageGenerationMessage,
  upsertImageGenerationMessage,
} from "./image-generation-messages";
import { createSessionMessagesState } from "./messages";
import {
  recordImageGenerationSessionEnd,
  recordImageGenerationEnd,
  recordImageGenerationTurnStart,
  recordImageGenerationTurnEnd,
} from "./image-generation-settlement";

const timestamp = "2026-09-06T10:00:00.000Z";
const part: AgentImageGenerationPart = {
  kind: "image_generation",
  itemId: "image",
  messageId: "image",
  partId: "image",
  turnId: "turn",
  status: "running",
};

for (const reason of ["turn_ended", "runtime_failure"] as const) {
  test(`session-wide ${reason} settles late readonly history and preserves native outcomes`, () => {
    const initial = createAgentSessionFixture();
    const ended = recordImageGenerationSessionEnd(initial, timestamp, reason);
    const settled = mergeReadonlyRuntimeHistory(ended, [
      { messageId: "image", role: "assistant", text: "", timestamp, parts: [part] },
    ]);
    expect(settled.messages.items[0]?.meta).toMatchObject({
      status: "incomplete",
      incompleteReason: reason,
    });
    expect(settled.status).toBe(initial.status);
    const completed = mergeReadonlyRuntimeHistory(settled, [
      {
        messageId: "image",
        role: "assistant",
        text: "",
        timestamp,
        parts: [{ ...part, status: "completed" }],
      },
    ]);
    expect(completed.messages.items[0]?.meta).toMatchObject({ status: "completed" });
    const failed = mergeReadonlyRuntimeHistory(ended, [
      {
        messageId: "image",
        role: "assistant",
        text: "",
        timestamp,
        parts: [{ ...part, status: "failed" }],
      },
    ]);
    expect(failed.messages.items[0]?.meta).toMatchObject({ status: "failed" });
  });
}

test("session end leaves later image output running", () => {
  const initial = createAgentSessionFixture();
  const later = "2026-09-06T10:00:01.000Z";
  initial.messages = createSessionMessagesState(initial.externalSessionId, [
    createImageGenerationMessage(part, later),
  ]);
  const ended = recordImageGenerationSessionEnd(initial, timestamp, "runtime_failure");
  expect(ended.messages.items[0]?.meta).toMatchObject({ status: "running" });
});

test("arbitrary turn IDs cannot inherit a terminal marker from Object.prototype", () => {
  const initial = recordImageGenerationTurnEnd(createAgentSessionFixture(), "other", "interrupted");
  const messages = upsertImageGenerationMessage(
    initial,
    { ...part, turnId: "constructor" },
    timestamp,
  );
  expect(messages.items[0]?.meta).toMatchObject({ status: "running" });
  const settled = recordImageGenerationTurnEnd(
    { ...initial, messages },
    "constructor",
    "interrupted",
  );
  expect(settled.messages.items[0]?.meta).toMatchObject({ status: "interrupted" });
});

test("frontend keeps its latest cutoff while the shared policy preserves interruption", () => {
  const latest = "2026-09-06T10:00:00.000Z";
  let session = buildSession({ runtimeKind: "codex" });
  session = recordImageGenerationSessionEnd(session, latest, "runtime_failure");
  session = recordImageGenerationTurnEnd(session, "interrupted", "interrupted");
  const previous = session;
  session = recordImageGenerationSessionEnd(session, "2026-09-06T09:00:00.000Z", "turn_ended");
  expect(session.imageGenerationEnd).toBe(previous.imageGenerationEnd);
  expect(recordImageGenerationTurnStart(session, "interrupted")).toBe(session);
  session = applyLoadedSessionHistory(session, [
    {
      messageId: "image",
      role: "assistant",
      text: "",
      timestamp: "2026-09-06T09:30:00.000Z",
      parts: [
        {
          kind: "image_generation",
          itemId: "image",
          messageId: "image",
          partId: "image",
          status: "running",
        },
      ],
    },
  ]);
  expect(
    session.messages.items.find((message) => message.meta?.kind === "image_generation")?.meta,
  ).toMatchObject({ status: "incomplete", incompleteReason: "runtime_failure" });
  expect(session.imageGenerationTurnEnds?.get("interrupted")).toBe("interrupted");
});

test("a confirmed image turn excludes generic session settlement and leaves the input state intact", () => {
  const original = buildSession({ runtimeKind: "codex" });
  const running = recordImageGenerationTurnStart(original, "next");
  expect(recordImageGenerationEnd(running, "2026-09-06T10:00:00.000Z", "runtime_failure")).toBe(
    running,
  );
  const ended = recordImageGenerationTurnEnd(running, "next", "interrupted");
  expect(original.imageGenerationTurnStarts).toBeUndefined();
  expect(running.imageGenerationTurnStarts?.has("next")).toBe(true);
  expect(ended.imageGenerationTurnStarts?.has("next")).toBe(false);
  expect(recordImageGenerationTurnEnd(ended, "next", "turn_ended")).toBe(ended);
});
