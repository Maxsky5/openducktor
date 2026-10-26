import { describe, expect, test } from "bun:test";
import { createTerminalInputSequencer } from "@openducktor/frontend-core/terminals/terminal-viewport-policy";
import {
  createDataTransferItemFixture,
  createDataTransferItemListFixture,
  createDataTransferFixture,
  createFileListFixture,
} from "@/test-utils/focused-fixture";
import {
  createTerminalImagePasteHandler,
  extractTransferredImageFiles,
  pasteDroppedTerminalImages,
} from "./terminal-image-transfer-policy";

describe("terminal image transfer policy", () => {
  test("forwards image clipboard paste as Ctrl+V instead of empty input", async () => {
    const inputWrites: number[][] = [];
    const failures: unknown[] = [];
    let inputIdle = Promise.resolve();
    const sequenceInput = createTerminalInputSequencer({
      isActive: () => true,
      writeInput: async (data) => {
        inputWrites.push([...data]);
      },
      reportFailure: (cause) => failures.push(cause),
    });
    const preventDefaultCalls: string[] = [];
    const stopPropagationCalls: string[] = [];
    const handlePaste = createTerminalImagePasteHandler({
      enqueueInput: (operation) => {
        inputIdle = sequenceInput(operation);
        return inputIdle;
      },
    });

    handlePaste({
      clipboardData: createDataTransferFixture({
        files: createFileListFixture([]),
        items: createDataTransferItemListFixture([
          createDataTransferItemFixture({ kind: "file", type: "image/png" }),
        ]),
      }),
      preventDefault: () => preventDefaultCalls.push("prevented"),
      stopPropagation: () => stopPropagationCalls.push("stopped"),
    });
    await inputIdle;

    expect(inputWrites).toEqual([[22]]);
    expect(preventDefaultCalls).toEqual(["prevented"]);
    expect(stopPropagationCalls).toEqual(["stopped"]);
    expect(failures).toEqual([]);
  });

  test("lets xterm handle text clipboard paste", () => {
    const calls: string[] = [];
    const handlePaste = createTerminalImagePasteHandler({
      enqueueInput: async () => undefined,
    });

    handlePaste({
      clipboardData: createDataTransferFixture({
        files: createFileListFixture([]),
        items: createDataTransferItemListFixture([
          createDataTransferItemFixture({ kind: "string", type: "text/plain" }),
        ]),
      }),
      preventDefault: () => calls.push("prevented"),
      stopPropagation: () => calls.push("stopped"),
    });

    expect(calls).toEqual([]);
  });

  test("stages bounded dropped images concurrently and preserves paste order", async () => {
    const first = new File([new Uint8Array([1])], "first image.png", { type: "image/png" });
    const second = new File([new Uint8Array([2])], "second.jpg", { type: "image/jpeg" });
    const text = new File(["notes"], "notes.txt", { type: "text/plain" });
    const transfer = createDataTransferFixture({
      files: createFileListFixture([first, text, second]),
      items: createDataTransferItemListFixture([]),
    });
    const stagedFiles: string[] = [];
    const preparedPaths: string[][] = [];
    const pasted: string[] = [];
    let activeStages = 0;
    let maximumActiveStages = 0;

    const imageFiles = extractTransferredImageFiles(transfer);
    await pasteDroppedTerminalImages({
      files: imageFiles,
      stageFile: async (file) => {
        activeStages += 1;
        maximumActiveStages = Math.max(maximumActiveStages, activeStages);
        await Promise.resolve();
        stagedFiles.push(file.name);
        activeStages -= 1;
        return `/tmp/${file.name}`;
      },
      prepareInput: async (paths) => {
        preparedPaths.push([...paths]);
        return `prepared:${paths.join("|")}`;
      },
      paste: (value) => pasted.push(value),
    });

    expect(stagedFiles).toEqual(["first image.png", "second.jpg"]);
    expect(maximumActiveStages).toBe(2);
    expect(preparedPaths).toEqual([["/tmp/first image.png", "/tmp/second.jpg"]]);
    expect(pasted).toEqual(["prepared:/tmp/first image.png|/tmp/second.jpg"]);
  });

  test("rejects oversized and excessive terminal image drops before staging", async () => {
    const stageFile = async () => {
      throw new Error("Oversized images must not be staged.");
    };
    const largeImage = new File([], "large.png", { type: "image/png" });
    Object.defineProperty(largeImage, "size", {
      configurable: true,
      value: 20 * 1024 * 1024 + 1,
    });
    await expect(
      pasteDroppedTerminalImages({
        files: [largeImage],
        stageFile,
        prepareInput: async () => "unused",
        paste: () => undefined,
      }),
    ).rejects.toThrow("20 MiB");

    const images = Array.from(
      { length: 9 },
      (_, index) => new File([new Uint8Array([index])], `${index}.png`, { type: "image/png" }),
    );
    await expect(
      pasteDroppedTerminalImages({
        files: images,
        stageFile,
        prepareInput: async () => "unused",
        paste: () => undefined,
      }),
    ).rejects.toThrow("8 images");
  });
});
