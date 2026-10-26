import {
  AGENT_GENERATED_IMAGE_BATCH_LIMIT,
  type AgentGeneratedImageBatchInput,
  type AgentGeneratedImageReadInput,
  type AgentGeneratedImageReadResult,
} from "@openducktor/contracts";
import type { AgentGeneratedImageReadPort } from "@openducktor/core";

/** The host reads that a generated image preview uses. */
export type GeneratedImageBatchReader = Pick<
  AgentGeneratedImageReadPort,
  "beginGeneratedImageBatch" | "releaseGeneratedImageBatch" | "readGeneratedImage"
>;

/** The session, item, and output revision that a generated image read names. */
export const generatedImageReadIdentity = ({
  ref,
  itemId,
  turnId,
  revision,
}: Pick<AgentGeneratedImageReadInput, "ref" | "itemId" | "turnId" | "revision">) =>
  [
    ref.repoPath,
    ref.runtimeKind,
    ref.workingDirectory,
    ref.externalSessionId,
    turnId ?? null,
    itemId,
    revision,
  ] as const;

/** Rejects a host response that belongs to another session, item, or output revision. */
export const assertGeneratedImageReadMatches = (
  result: AgentGeneratedImageReadResult,
  request: AgentGeneratedImageReadInput,
): void => {
  if (
    JSON.stringify(generatedImageReadIdentity(result)) !==
    JSON.stringify(generatedImageReadIdentity(request))
  ) {
    throw new Error(
      "The image response belongs to another session, item, or output revision. Reopen this session.",
    );
  }
};

type Job<Value> = {
  input: AgentGeneratedImageReadInput;
  signal: AbortSignal;
  work: (input: AgentGeneratedImageReadInput) => Promise<Value>;
  resolve: (value: Value) => void;
  reject: (cause: unknown) => void;
};
type Queue<Value> = { jobs: Job<Value>[]; running: boolean };

/**
 * Returns a function that reads generated images in host batches. Reads of one session share a
 * batch of at most `AGENT_GENERATED_IMAGE_BATCH_LIMIT` images, and the host releases each batch
 * after its reads end. `Value` is the result of `work`, such as a decoded image.
 */
export const createGeneratedImageBatcher = <Value>() => {
  const queues = new WeakMap<
    AgentGeneratedImageReadPort["beginGeneratedImageBatch"],
    Map<string, Queue<Value>>
  >();
  return (
    reader: GeneratedImageBatchReader,
    input: AgentGeneratedImageReadInput,
    signal: AbortSignal,
    work: Job<Value>["work"],
  ): Promise<Value> => {
    signal.throwIfAborted();
    let sessions = queues.get(reader.beginGeneratedImageBatch);
    if (!sessions) {
      sessions = new Map();
      queues.set(reader.beginGeneratedImageBatch, sessions);
    }
    const key = JSON.stringify([
      input.ref.repoPath,
      input.ref.runtimeKind,
      input.ref.workingDirectory,
      input.ref.externalSessionId,
    ]);
    let queue = sessions.get(key);
    if (!queue) {
      queue = { jobs: [], running: false };
      sessions.set(key, queue);
    }
    const current = queue;
    const result = new Promise<Value>((resolve, reject) => {
      current.jobs.push({ input, signal, work, resolve, reject });
    });
    if (!current.running) {
      current.running = true;
      const owner = sessions;
      queueMicrotask(() => {
        void drain(reader, current).finally(() => {
          if (!current.running && owner.get(key) === current) owner.delete(key);
        });
      });
    }
    return result;
  };
};

const drain = async <Value>(
  reader: GeneratedImageBatchReader,
  queue: Queue<Value>,
): Promise<void> => {
  while (queue.jobs.length > 0) {
    const jobs: Job<Value>[] = [];
    const identities = new Set<string>();
    while (queue.jobs.length > 0 && jobs.length < AGENT_GENERATED_IMAGE_BATCH_LIMIT) {
      const next = queue.jobs[0]!;
      const identity = JSON.stringify([next.input.turnId ?? null, next.input.itemId]);
      if (identities.has(identity)) break;
      queue.jobs.shift();
      if (next.signal.aborted) next.reject(next.signal.reason);
      else {
        identities.add(identity);
        jobs.push(next);
      }
    }
    const first = jobs[0];
    if (!first) continue;
    try {
      const batch = await reader.beginGeneratedImageBatch({
        ref: first.input.ref,
        images: jobs.map(({ input }) => {
          const identity: AgentGeneratedImageBatchInput["images"][number] = {
            itemId: input.itemId,
            revision: input.revision,
          };
          if (input.turnId !== undefined) identity.turnId = input.turnId;
          return identity;
        }),
      });
      let results: PromiseSettledResult<Value>[];
      let admitted: Job<Value>[] = [];
      try {
        if (
          batch.ref.repoPath !== first.input.ref.repoPath ||
          batch.ref.runtimeKind !== first.input.ref.runtimeKind ||
          batch.ref.workingDirectory !== first.input.ref.workingDirectory ||
          batch.ref.externalSessionId !== first.input.ref.externalSessionId
        )
          throw new Error("The preview batch belongs to another session. Reopen the session.");
        const keys = new Set(
          batch.admittedImages.map((image) =>
            JSON.stringify([image.turnId ?? null, image.itemId, image.revision]),
          ),
        );
        admitted = jobs.filter(({ input }) =>
          keys.has(JSON.stringify([input.turnId ?? null, input.itemId, input.revision])),
        );
        if (
          admitted.length === 0 ||
          admitted.length !== batch.admittedImages.length ||
          keys.size !== batch.admittedImages.length
        )
          throw new Error(
            "The preview batch returned invalid image admission. Reopen the session.",
          );
        results = await Promise.allSettled(
          admitted.map(async (job) => {
            job.signal.throwIfAborted();
            return job.work({ ...job.input, batchId: batch.batchId });
          }),
        );
      } finally {
        await reader.releaseGeneratedImageBatch({ ref: batch.ref, batchId: batch.batchId });
      }
      const admittedJobs = new Set(admitted);
      queue.jobs.unshift(...jobs.filter((job) => !admittedJobs.has(job)));
      results.forEach((result, index) => {
        const job = admitted[index];
        if (!job) return;
        if (job.signal.aborted) job.reject(job.signal.reason);
        else if (result.status === "fulfilled") job.resolve(result.value);
        else job.reject(result.reason);
      });
    } catch (cause) {
      for (const job of jobs) job.reject(cause);
    }
  }
  queue.running = false;
};
