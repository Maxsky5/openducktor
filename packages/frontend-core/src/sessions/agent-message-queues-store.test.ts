import { describe, expect, test } from "bun:test";
import { createAgentMessageQueueSnapshot } from "../test-support/agent-message-send-fixture";
import { createAgentMessageQueuesStore } from "./agent-message-queues-store";

const ref = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo",
  externalSessionId: "session-1",
};
const target = { ...ref, sessionScope: { kind: "repository" as const } };

describe("createAgentMessageQueuesStore", () => {
  test("keeps the newest revision of each queue", () => {
    const store = createAgentMessageQueuesStore();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.apply(
      createAgentMessageQueueSnapshot({ target, revision: 2, texts: ["first", "second"] }),
    );
    store.apply(createAgentMessageQueueSnapshot({ target, revision: 1, texts: ["first"] }));

    expect(store.getQueue(ref)?.entries).toHaveLength(2);
    expect(notifications).toBe(1);
  });

  test("hides an empty queue but keeps its revision against late updates", () => {
    const store = createAgentMessageQueuesStore();

    store.apply(createAgentMessageQueueSnapshot({ target, revision: 3 }));
    store.apply(createAgentMessageQueueSnapshot({ target, revision: 2, texts: ["first"] }));

    expect(store.getQueue(ref)).toBeNull();
  });

  test("shows a paused queue without messages", () => {
    const store = createAgentMessageQueuesStore();

    store.apply(createAgentMessageQueueSnapshot({ target, pause: { message: "Stopped." } }));

    expect(store.getQueue(ref)?.pause).toEqual({ message: "Stopped." });
  });

  test("replaces only the queues of the snapshot repository", () => {
    const store = createAgentMessageQueuesStore();
    const otherRef = { ...ref, repoPath: "/other", workingDirectory: "/other" };
    store.apply(createAgentMessageQueueSnapshot({ target, revision: 5, texts: ["stale"] }));
    store.apply(
      createAgentMessageQueueSnapshot({
        target: { ...otherRef, sessionScope: { kind: "repository" } },
        revision: 6,
        texts: ["other"],
      }),
    );

    store.replaceRepository("/repo", [
      createAgentMessageQueueSnapshot({ target, texts: ["fresh"] }),
    ]);

    expect(store.getQueue(ref)?.entries.map((entry) => entry.submissionId)).toEqual([
      "submission-fresh",
    ]);
    expect(store.getQueue(otherRef)).not.toBeNull();
    store.replaceRepository("/repo", []);
    expect(store.getQueue(ref)).toBeNull();
  });

  test("removes an accepted message but still applies the host update that removes it", () => {
    const store = createAgentMessageQueuesStore();
    store.apply(createAgentMessageQueueSnapshot({ target, texts: ["first", "second"] }));

    store.removeAccepted(ref, "submission-first");
    expect(store.getQueue(ref)?.entries.map((entry) => entry.submissionId)).toEqual([
      "submission-second",
    ]);

    store.apply(
      createAgentMessageQueueSnapshot({ target, revision: 2, texts: ["second", "third"] }),
    );
    expect(store.getQueue(ref)?.entries.map((entry) => entry.submissionId)).toEqual([
      "submission-second",
      "submission-third",
    ]);
  });
});
