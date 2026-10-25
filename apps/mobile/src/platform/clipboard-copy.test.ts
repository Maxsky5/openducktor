import { describe, expect, test } from "bun:test";
import type { ClientFeedback } from "@openducktor/frontend-core/platform/client-feedback";
import { copyWithNotice, systemConfirmsCopy } from "./clipboard-copy";

const recordedFeedback = () => {
  const shown: { kind: string; message: string; description: string | null }[] = [];
  const feedback: ClientFeedback = {
    show: (kind, message, options) => {
      shown.push({ kind, message, description: options?.description ?? null });
    },
    dismiss: () => {},
  };
  return { feedback, shown };
};

const notice = { copied: "Path copied.", detail: "/repo/src", failed: "The path was not copied." };

describe("systemConfirmsCopy", () => {
  test("is true from Android 13, API level 33, on", () => {
    expect(systemConfirmsCopy(33)).toBe(true);
    expect(systemConfirmsCopy(36)).toBe(true);
    expect(systemConfirmsCopy(32)).toBe(false);
    expect(systemConfirmsCopy(null)).toBe(false);
  });
});

describe("copyWithNotice", () => {
  test("shows the success with its detail when the system does not confirm the copy", async () => {
    const { feedback, shown } = recordedFeedback();
    const copied = await copyWithNotice(async () => {}, notice, {
      feedback,
      systemConfirms: false,
    });

    expect(copied).toBe(true);
    expect(shown).toEqual([{ kind: "success", message: "Path copied.", description: "/repo/src" }]);
  });

  test("shows nothing after a copy that the system confirms", async () => {
    const { feedback, shown } = recordedFeedback();
    const copied = await copyWithNotice(async () => {}, notice, {
      feedback,
      systemConfirms: true,
    });

    expect(copied).toBe(true);
    expect(shown).toEqual([]);
  });

  test("shows a failure with its reason also when the system confirms copies", async () => {
    const { feedback, shown } = recordedFeedback();
    const copied = await copyWithNotice(
      async () => {
        throw new Error("The clipboard is not available.");
      },
      notice,
      { feedback, systemConfirms: true },
    );

    expect(copied).toBe(false);
    expect(shown).toEqual([
      {
        kind: "error",
        message: "The path was not copied.",
        description: "The clipboard is not available.",
      },
    ]);
  });
});
