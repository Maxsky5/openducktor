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

for (const delayed of ["2026-09-06T09:00:00.000Z", timestamp]) {
  test(`session cutoff ${delayed} cannot end a turn started after the latest cutoff`, () => {
    let session = createAgentSessionFixture();
    session = recordImageGenerationSessionEnd(session, timestamp, "runtime_failure");
    session = recordImageGenerationTurnEnd(session, "failed", "runtime_failure");
    session = recordImageGenerationTurnEnd(session, "stopped", "interrupted");
    session = recordImageGenerationTurnStart(session, "new");
    session = {
      ...session,
      messages: upsertImageGenerationMessage(
        session,
        { ...part, turnId: "new" },
        "2026-09-06T10:01:00.000Z",
      ),
    };
    expect(recordImageGenerationSessionEnd(session, delayed, "turn_ended")).toBe(session);
    const history = applyLoadedSessionHistory(session, [
      {
        messageId: "late",
        role: "assistant",
        text: "",
        timestamp,
        parts: [{ ...part, turnId: "new" }],
      },
    ]);
    expect(
      history.messages.items.find((message) => message.meta?.kind === "image_generation")?.meta,
    ).toMatchObject({ status: "running" });
    expect(session.imageGenerationTurnEnds?.get("failed")).toBe("runtime_failure");
    expect(session.imageGenerationTurnEnds?.get("stopped")).toBe("interrupted");
    expect(session.imageGenerationTurnStarts?.has("new")).toBe(true);
  });
}

test("late failed-turn settlement corrects an idle image and stays correct through history replay", () => {
  let session = createAgentSessionFixture();
  session = { ...session, messages: upsertImageGenerationMessage(session, part, timestamp) };
  session = recordImageGenerationTurnEnd(session, "turn", "turn_ended");
  session = recordImageGenerationTurnEnd(session, "turn", "runtime_failure");
  expect(session.messages.items[0]?.meta).toMatchObject({
    status: "incomplete",
    incompleteReason: "runtime_failure",
  });
  session = recordImageGenerationTurnEnd(session, "turn", "turn_ended");
  session = applyLoadedSessionHistory(session, [
    { messageId: "image", role: "assistant", text: "", timestamp, parts: [part] },
  ]);
  expect(session.messages.items[0]?.meta).toMatchObject({
    status: "incomplete",
    incompleteReason: "runtime_failure",
  });
});

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

for (const loadHistory of [applyLoadedSessionHistory, mergeReadonlyRuntimeHistory]) {
  test(`${loadHistory.name} retains the failure cutoff for previously unseen images`, () => {
    let session = recordImageGenerationSessionEnd(
      createAgentSessionFixture(),
      timestamp,
      "runtime_failure",
    );
    session = recordImageGenerationSessionEnd(session, "2026-09-06T11:00:00.000Z", "turn_ended");
    const loaded = loadHistory(session, [
      {
        messageId: "old",
        role: "assistant",
        text: "",
        timestamp: "2026-09-06T09:00:00.000Z",
        parts: [{ ...part, turnId: "old", itemId: "old" }],
      },
      {
        messageId: "middle",
        role: "assistant",
        text: "",
        timestamp: "2026-09-06T10:30:00.000Z",
        parts: [{ ...part, turnId: "middle", itemId: "middle" }],
      },
      {
        messageId: "new",
        role: "assistant",
        text: "",
        timestamp: "2026-09-06T12:00:00.000Z",
        parts: [{ ...part, turnId: "new", itemId: "new" }],
      },
    ]);
    const images = loaded.messages.items.filter(
      (message) => message.meta?.kind === "image_generation",
    );
    expect(images.map((message) => message.meta)).toMatchObject([
      { status: "incomplete", incompleteReason: "runtime_failure" },
      { status: "incomplete", incompleteReason: "turn_ended" },
      { status: "running" },
    ]);
    const live = upsertImageGenerationMessage(session, { ...part, turnId: "late" }, timestamp);
    expect(live.items[0]?.meta).toMatchObject({
      status: "incomplete",
      incompleteReason: "runtime_failure",
    });
  });
}
