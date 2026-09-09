import { describe, expect, test } from "bun:test";
import {
  parseCodexAppServerRequestResult,
  codexAppServerConsumedRuntimeNotificationSchema,
} from "@openducktor/contracts";
import { parseStreamMessage } from "./codex-app-server-transport-messages";

// Codex source 47ca4619be10c20c1cec6ee9944738c5b961fa1d:
// codex-rs/ext/items/src/image_generation.rs serializes Option<bool> as null.
describe("Codex image generation ingress", () => {
  for (const transparentBackground of [true, false, null, undefined]) {
    for (const status of ["in_progress", "completed", "failed", ""]) {
      test(`accepts ${status} with transparency ${transparentBackground}`, () => {
        const item = {
          type: "imageGeneration",
          id: "image-1",
          status,
          revisedPrompt: null,
          result: "",
          failure: null,
        };
        if (transparentBackground !== undefined) Object.assign(item, { transparentBackground });
        for (const method of ["item/started", "item/completed"]) {
          expect(() =>
            codexAppServerConsumedRuntimeNotificationSchema.parse(
              parseStreamMessage(
                "runtime",
                {
                  method,
                  params: {
                    threadId: "thread",
                    turnId: "turn",
                    startedAtMs: 0,
                    completedAtMs: 1,
                    item,
                  },
                },
                "notification",
              ),
            ),
          ).not.toThrow();
        }
        expect(() =>
          parseCodexAppServerRequestResult("thread/turns/list", {
            data: [
              {
                id: "turn",
                items: [item],
                itemsView: "full",
                status: "completed",
                startedAt: null,
                completedAt: null,
                durationMs: null,
                error: null,
              },
            ],
            nextCursor: null,
            backwardsCursor: null,
          }),
        ).not.toThrow();
      });
    }
  }
  for (const transparentBackground of ["true", 1, {}]) {
    test(`rejects invalid transparency ${JSON.stringify(transparentBackground)}`, () => {
      expect(() =>
        codexAppServerConsumedRuntimeNotificationSchema.parse(
          parseStreamMessage(
            "runtime",
            {
              method: "item/completed",
              params: {
                threadId: "thread",
                turnId: "turn",
                startedAtMs: 0,
                completedAtMs: 1,
                item: {
                  type: "imageGeneration",
                  id: "image",
                  status: "completed",
                  revisedPrompt: null,
                  result: "",
                  failure: null,
                  transparentBackground,
                },
              },
            },
            "notification",
          ),
        ),
      ).toThrow();
    });
  }
});
