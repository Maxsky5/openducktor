import { expect, mock, test } from "bun:test";
import type {
  AgentGeneratedImageDescribeInput,
  AgentImageGenerationPart,
} from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { generatedImageMetadataQueryOptions as options } from "./agent-generated-image-metadata";

const ref = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo/worktree",
  externalSessionId: "thread",
};
const part = (
  identity: AgentGeneratedImageDescribeInput["images"][number],
): AgentImageGenerationPart => ({
  ...identity,
  kind: "image_generation",
  messageId: identity.itemId,
  partId: identity.itemId,
  status: "completed",
  output: { revision: identity.itemId },
});
const describe = (input: AgentGeneratedImageDescribeInput) => ({
  ref: input.ref,
  images: input.images.map(part),
});

test("eight metadata queries share one request and preserve item results", async () => {
  const client = new QueryClient();
  const reader = {
    describeGeneratedImages: mock(async (input: AgentGeneratedImageDescribeInput) =>
      describe(input),
    ),
  };
  try {
    const outputs = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        client.fetchQuery(options({ ref, itemId: String(index) }, reader)),
      ),
    );
    expect(reader.describeGeneratedImages).toHaveBeenCalledTimes(1);
    expect(reader.describeGeneratedImages.mock.calls[0]![0].images).toHaveLength(8);
    expect(outputs.map((output) => output.revision)).toEqual(
      Array.from({ length: 8 }, (_, index) => String(index)),
    );
  } finally {
    client.clear();
  }
});

test("metadata batches respect the contract limit and separate sessions and readers", async () => {
  const client = new QueryClient();
  const first = {
    describeGeneratedImages: mock(async (input: AgentGeneratedImageDescribeInput) =>
      describe(input),
    ),
  };
  const second = {
    describeGeneratedImages: mock(async (input: AgentGeneratedImageDescribeInput) =>
      describe(input),
    ),
  };
  try {
    await Promise.all([
      ...Array.from({ length: 65 }, (_, index) =>
        client.fetchQuery(options({ ref, itemId: String(index) }, first)),
      ),
      client.fetchQuery(
        options({ ref: { ...ref, externalSessionId: "other" }, itemId: "0" }, first),
      ),
      client.fetchQuery(options({ ref, itemId: "second-reader" }, second)),
    ]);
    expect(first.describeGeneratedImages.mock.calls.map(([input]) => input.images.length)).toEqual([
      64, 1, 1,
    ]);
    expect(second.describeGeneratedImages).toHaveBeenCalledTimes(1);
  } finally {
    client.clear();
  }
});

test("one unavailable image does not discard other metadata", async () => {
  const client = new QueryClient();
  const reader = {
    describeGeneratedImages: mock(async (input: AgentGeneratedImageDescribeInput) => ({
      ref,
      images: input.images.map((identity) =>
        identity.itemId === "missing"
          ? { ...part(identity), output: undefined, previewUnavailableReason: "File missing" }
          : part(identity),
      ),
    })),
  };
  try {
    const results = await Promise.allSettled(
      ["missing", "valid"].map((itemId) => client.fetchQuery(options({ ref, itemId }, reader))),
    );
    expect(results[0]).toMatchObject({ status: "rejected", reason: new Error("File missing") });
    expect(results[1]).toEqual({ status: "fulfilled", value: { revision: "valid" } });
    expect(reader.describeGeneratedImages).toHaveBeenCalledTimes(1);
  } finally {
    client.clear();
  }
});

for (const mismatch of ["session", "duplicate", "missing", "item"] as const) {
  test(`metadata rejects ${mismatch} responses without retry`, async () => {
    const client = new QueryClient();
    const reader = {
      describeGeneratedImages: mock(async (input: AgentGeneratedImageDescribeInput) => ({
        ref: mismatch === "session" ? { ...ref, externalSessionId: "wrong" } : ref,
        images:
          mismatch === "missing"
            ? []
            : input.images.map((identity) =>
                part(
                  mismatch === "duplicate"
                    ? input.images[0]!
                    : mismatch === "item"
                      ? { itemId: "wrong" }
                      : identity,
                ),
              ),
      })),
    };
    try {
      const results = await Promise.allSettled(
        ["a", "b"].map((itemId) => client.fetchQuery(options({ ref, itemId }, reader))),
      );
      expect(results.every((result) => result.status === "rejected")).toBe(true);
      expect(reader.describeGeneratedImages).toHaveBeenCalledTimes(1);
    } finally {
      client.clear();
    }
  });
}

test("cancelling one query removes its identity without cancelling its sibling", async () => {
  const client = new QueryClient();
  const reader = {
    describeGeneratedImages: mock(async (input: AgentGeneratedImageDescribeInput) =>
      describe(input),
    ),
  };
  try {
    const cancelled = options({ ref, itemId: "cancelled" }, reader);
    const results = Promise.allSettled([
      client.fetchQuery(cancelled),
      client.fetchQuery(options({ ref, itemId: "keep" }, reader)),
    ]);
    await client.cancelQueries({ queryKey: cancelled.queryKey });
    expect(await results).toMatchObject([
      { status: "rejected" },
      { status: "fulfilled", value: { revision: "keep" } },
    ]);
    expect(reader.describeGeneratedImages.mock.calls[0]![0].images).toEqual([{ itemId: "keep" }]);
  } finally {
    client.clear();
  }
});

test("cancelled metadata does not enter the cache after a host read completes", async () => {
  const client = new QueryClient();
  const started = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const reader = {
    describeGeneratedImages: mock(async (input: AgentGeneratedImageDescribeInput) => {
      started.resolve();
      await gate.promise;
      return describe(input);
    }),
  };
  const query = options({ ref, itemId: "cancelled" }, reader);
  try {
    const result = Promise.allSettled([client.fetchQuery(query)]);
    await started.promise;
    await client.cancelQueries({ queryKey: query.queryKey });
    gate.resolve();
    expect(await result).toMatchObject([{ status: "rejected" }]);
    expect(client.getQueryData(query.queryKey)).toBeUndefined();
    expect(await client.fetchQuery(query)).toEqual({ revision: "cancelled" });
    expect(reader.describeGeneratedImages).toHaveBeenCalledTimes(2);
  } finally {
    gate.resolve();
    client.clear();
  }
});
