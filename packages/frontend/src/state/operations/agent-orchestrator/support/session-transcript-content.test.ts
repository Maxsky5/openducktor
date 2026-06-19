import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import {
  hasLoadedSessionHistory,
  hasRenderableSessionTranscript,
  needsInitialSessionHistoryLoad,
} from "./session-transcript-content";

describe("agent-orchestrator/support/session-transcript-content", () => {
  test("reports only loaded history as loaded session history", () => {
    expect(hasLoadedSessionHistory(createAgentSessionFixture({ historyLoadState: "loaded" }))).toBe(
      true,
    );
    expect(
      hasLoadedSessionHistory(createAgentSessionFixture({ historyLoadState: "not_requested" })),
    ).toBe(false);
  });

  test("treats loaded history or existing messages as renderable transcript content", () => {
    expect(
      hasRenderableSessionTranscript(
        createAgentSessionFixture({ historyLoadState: "loaded", messages: [] }),
      ),
    ).toBe(true);

    expect(
      hasRenderableSessionTranscript(
        createAgentSessionFixture({
          historyLoadState: "not_requested",
          messages: [
            {
              id: "live-user-message",
              role: "user",
              content: "Continue after QA rejection",
              timestamp: "2026-06-12T08:00:01.000Z",
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  test("requests initial history for every unrequested session", () => {
    expect(
      needsInitialSessionHistoryLoad(
        createAgentSessionFixture({ historyLoadState: "not_requested", messages: [] }),
      ),
    ).toBe(true);

    expect(
      needsInitialSessionHistoryLoad(
        createAgentSessionFixture({ historyLoadState: "loading", messages: [] }),
      ),
    ).toBe(false);

    expect(
      needsInitialSessionHistoryLoad(
        createAgentSessionFixture({
          historyLoadState: "not_requested",
          messages: [
            {
              id: "live-user-message",
              role: "user",
              content: "Already visible",
              timestamp: "2026-06-12T08:00:01.000Z",
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});
