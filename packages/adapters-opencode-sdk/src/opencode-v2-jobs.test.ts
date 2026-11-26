import { describe, expect, test } from "bun:test";
import type { SessionMessageAssistant, SessionMessageSynthetic } from "@opencode/client";
import { OpenCodeLiveMessageProjector } from "./opencode-live-message-projector";
import { projectMessages } from "./opencode-message-projection";
import { durable } from "./opencode-v2-live.test-support";
import { model, ref } from "./opencode-v2.test-support";

const call = (
  name: string,
  jobID: string,
  input: Record<string, string>,
): SessionMessageAssistant => ({
  id: `msg_${jobID}_call`,
  type: "assistant",
  agent: "build",
  model,
  time: { created: 1, completed: 3 },
  content: [
    {
      type: "tool",
      id: `call_${jobID}`,
      name,
      time: { created: 1, ran: 2, completed: 3 },
      state: {
        status: "completed",
        input,
        content: [{ type: "text", text: `Job ${jobID} started in the background.` }],
        metadata: { jobID },
      },
    },
  ],
});

/** The job result notice of OpenCode 2.4.1, wrapped by `BackgroundResult.render`. */
const notice = (
  source: string,
  kind: string,
  jobID: string,
  state: "completed" | "error" | "cancelled",
  body: string,
): SessionMessageSynthetic => ({
  id: `msg_${jobID}_done`,
  type: "synthetic",
  time: { created: 9 },
  description: "Job result",
  text: `<background-result kind="${kind}" id="${jobID}" state="${state}">\n${body}\n</background-result>`,
  metadata: { source, jobID, state },
});

describe("OpenCode background job results", () => {
  test.each([
    ["generate_image", "generate_image", "image", { prompt: "A duck" }],
    ["generate_video", "generate_video", "video", { prompt: "A duck" }],
    ["execute", "codemode", "codemode", { code: "await build()" }],
  ] as const)(
    "shows the result of a %s job on the card of its call",
    (tool, source, kind, input) => {
      const started = call(tool, "job_1", input);
      // The background task shows the running job, so the call shows as OpenCode reports it.
      const pending = projectMessages([started])[0]?.parts[0];
      expect(pending).toMatchObject({ kind: "tool", status: "completed" });
      expect(pending?.kind === "tool" ? pending.metadata?.backgroundTaskStatus : "none").toBe(
        undefined,
      );
      const history = projectMessages([
        started,
        notice(source, kind, "job_1", "completed", "Saved: /repo/duck.png"),
      ]);
      expect(history).toHaveLength(1);
      expect(history[0]?.parts[0]).toMatchObject({
        kind: "tool",
        status: "completed",
        output: "Saved: /repo/duck.png",
        endedAtMs: 9,
        metadata: { jobID: "job_1", backgroundTaskStatus: "completed" },
      });
    },
  );

  test.each([
    ["error", "failed"],
    ["cancelled", "stopped"],
  ] as const)("shows a %s job as a failed call", (state, outcome) => {
    const history = projectMessages([
      call("generate_image", "job_2", { prompt: "A duck" }),
      notice("generate_image", "image", "job_2", state, "No image"),
    ]);
    expect(history[0]?.parts[0]).toMatchObject({
      status: "error",
      error: "No image",
      metadata: { backgroundTaskStatus: outcome },
    });
  });

  test("updates the card of the call when the live result arrives", () => {
    const projector = new OpenCodeLiveMessageProjector();
    projector.seed([call("generate_video", "job_3", { prompt: "A duck" })]);
    const result = notice("generate_video", "video", "job_3", "completed", "Saved: /repo/duck.mp4");
    const events = projector.apply({
      id: "evt_job_3_done",
      type: "session.synthetic",
      created: 9,
      durable: { ...durable, seq: 2 },
      data: {
        sessionID: ref.externalSessionId,
        text: result.text,
        description: result.description,
        metadata: result.metadata,
      },
    });
    expect(events.filter((event) => event.type === "session_policy_notice")).toEqual([]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "call_job_3",
          status: "completed",
          output: "Saved: /repo/duck.mp4",
        }),
      }),
    );
  });

  test("reports a job result with an envelope of another job", () => {
    const wrong = notice("generate_image", "image", "job_4", "completed", "Saved");
    wrong.text = wrong.text.replace('id="job_4"', 'id="job_other"');
    expect(() => projectMessages([call("generate_image", "job_4", {}), wrong])).toThrow(
      "invalid background job result envelope",
    );
  });
});
