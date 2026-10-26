import { describe, expect, test } from "bun:test";
import type {
  AgentGeneratedImageBatch,
  AgentGeneratedImageBatchInput,
  AgentGeneratedImageReadInput,
  AgentSessionLiveRef,
} from "@openducktor/contracts";
import {
  assertGeneratedImageReadMatches,
  createGeneratedImageBatcher,
  type GeneratedImageBatchReader,
} from "./agent-generated-image-batches";

const ref: AgentSessionLiveRef = {
  repoPath: "/repo",
  runtimeKind: "codex",
  workingDirectory: "/repo",
  externalSessionId: "session-1",
};

const readInput = (itemId: string): AgentGeneratedImageReadInput => ({
  ref,
  itemId,
  revision: "r1",
});

const createReader = () => {
  const begun: AgentGeneratedImageBatchInput[] = [];
  const released: AgentGeneratedImageBatch[] = [];
  const reader: GeneratedImageBatchReader = {
    beginGeneratedImageBatch: async (input) => {
      begun.push(input);
      return { ref: input.ref, batchId: `batch-${begun.length}`, admittedImages: input.images };
    },
    releaseGeneratedImageBatch: async (batch) => {
      released.push(batch);
    },
    readGeneratedImage: async () => {
      throw new Error("The test reads through work.");
    },
  };
  return { reader, begun, released };
};

describe("createGeneratedImageBatcher", () => {
  test("reads the images of one session in one host batch and releases it", async () => {
    const batch = createGeneratedImageBatcher<string>();
    const { reader, begun, released } = createReader();
    const signal = new AbortController().signal;
    const results = await Promise.all(
      ["item-1", "item-2"].map((itemId) =>
        batch(
          reader,
          readInput(itemId),
          signal,
          async (request) => `${request.itemId}:${request.batchId}`,
        ),
      ),
    );
    expect(results).toEqual(["item-1:batch-1", "item-2:batch-1"]);
    expect(begun).toHaveLength(1);
    expect(released).toEqual([{ ref, batchId: "batch-1" }]);
  });

  test("stops a read that the caller aborted before the batch starts", () => {
    const batch = createGeneratedImageBatcher<string>();
    const { reader, begun } = createReader();
    const controller = new AbortController();
    controller.abort(new Error("Closed"));
    expect(() =>
      batch(reader, readInput("item-1"), controller.signal, async () => "never"),
    ).toThrow("Closed");
    expect(begun).toHaveLength(0);
  });
});

describe("assertGeneratedImageReadMatches", () => {
  test("rejects a response for another item", () => {
    const request = readInput("item-1");
    expect(() =>
      assertGeneratedImageReadMatches(
        { ...readInput("item-2"), mime: "image/png", byteLength: 1, base64: "AA==" },
        request,
      ),
    ).toThrow("belongs to another session, item, or output revision");
  });
});
