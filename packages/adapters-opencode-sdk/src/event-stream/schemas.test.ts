import { describe, expect, test } from "bun:test";
import {
  permissionAskedEvent,
  questionAskedEvent,
  sessionStatusEvent,
} from "../event-stream.test-support";
import { parseSessionControlEvent, readSessionErrorMessage } from "./schemas";

describe("event-stream schemas", () => {
  test("parseSessionControlEvent maps an SDK-valid retry status", () => {
    expect(
      parseSessionControlEvent(
        sessionStatusEvent({ type: "retry", attempt: 4, message: "Backoff", next: 900 }),
      ),
    ).toEqual({
      type: "session_status",
      status: { type: "retry", attempt: 4, message: "Backoff", nextEpochMs: 900 },
    });
  });

  test("parseSessionControlEvent maps an SDK-valid legacy permission", () => {
    expect(
      parseSessionControlEvent(
        permissionAskedEvent({
          requestId: "perm-1",
          permission: "write",
          patterns: ["src/**"],
          metadata: { reason: "write file" },
          always: ["src/**"],
        }),
      ),
    ).toEqual({
      type: "permission_asked",
      request: {
        requestId: "perm-1",
        permission: "write",
        patterns: ["src/**"],
        save: ["src/**"],
        metadata: { reason: "write file" },
      },
    });
  });

  test("parseSessionControlEvent preserves every SDK-valid question and option", () => {
    expect(
      parseSessionControlEvent(
        questionAskedEvent({
          requestId: "q-1",
          questions: [
            {
              header: "Pick one",
              question: "Select",
              options: [
                { label: "A", description: "Option A" },
                { label: "B", description: "Option B" },
              ],
            },
          ],
        }),
      ),
    ).toEqual({
      type: "question_asked",
      request: {
        requestId: "q-1",
        questions: [
          {
            header: "Pick one",
            question: "Select",
            options: [
              { label: "A", description: "Option A" },
              { label: "B", description: "Option B" },
            ],
          },
        ],
      },
    });
  });

  test("readSessionErrorMessage falls back when nested message is absent", () => {
    expect(readSessionErrorMessage({ error: { data: {} } })).toBe("Unknown session error");
  });
});
