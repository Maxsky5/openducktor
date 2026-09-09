import type {
  AgentGeneratedImageDescribeInput,
  AgentGeneratedImageReadInput,
  AgentSessionLiveRef,
  AgentImageGenerationPart,
} from "@openducktor/contracts";
import type { AgentGeneratedImageReadPort } from "@openducktor/core";
import { queryOptions } from "@tanstack/react-query";
import { runImagePreview } from "@/lib/generated-images/image-preview-queue";

export type GeneratedImageMetadataInput = Omit<
  AgentGeneratedImageReadInput,
  "revision" | "batchId"
>;
export const generatedImageMetadataSessionKey = (ref: AgentSessionLiveRef) =>
  [
    "agent-generated-image-metadata",
    ref.repoPath,
    ref.runtimeKind,
    ref.workingDirectory,
    ref.externalSessionId,
  ] as const;

export const generatedImageMetadataQueryOptions = (
  input: GeneratedImageMetadataInput,
  reader: Pick<AgentGeneratedImageReadPort, "describeGeneratedImages">,
) =>
  queryOptions({
    queryKey: [...generatedImageMetadataSessionKey(input.ref), input.turnId ?? null, input.itemId],
    queryFn: async ({ signal }) => {
      const part = await describeImage(input, reader.describeGeneratedImages, signal);
      if (!part.output)
        throw new Error(
          part.previewUnavailableReason ?? "Preview unavailable. Check the runtime output file.",
        );
      return part.output;
    },
    staleTime: Number.POSITIVE_INFINITY,

    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: true,
  });

type Describe = AgentGeneratedImageReadPort["describeGeneratedImages"];
type MetadataJob = {
  input: GeneratedImageMetadataInput;
  signal: AbortSignal;
  resolve: (part: AgentImageGenerationPart) => void;
  reject: (cause: unknown) => void;
};
const pendingDescriptions = new WeakMap<Describe, Map<string, MetadataJob[]>>();
const imageKey = (image: AgentGeneratedImageDescribeInput["images"][number]) =>
  JSON.stringify([image.turnId ?? null, image.itemId]);

const describeImage = (
  input: GeneratedImageMetadataInput,
  describe: Describe,
  signal: AbortSignal,
): Promise<AgentImageGenerationPart> => {
  signal.throwIfAborted();
  let sessions = pendingDescriptions.get(describe);
  if (!sessions) {
    sessions = new Map();
    pendingDescriptions.set(describe, sessions);
  }
  const key = JSON.stringify(generatedImageMetadataSessionKey(input.ref));
  let jobs = sessions.get(key);
  if (!jobs) {
    jobs = [];
    sessions.set(key, jobs);
    const owner = sessions;
    const batch = jobs;
    queueMicrotask(() => {
      owner.delete(key);
      for (let start = 0; start < batch.length; start += 64)
        void describeBatch(describe, batch.slice(start, start + 64));
    });
  }
  return new Promise((resolve, reject) => jobs.push({ input, signal, resolve, reject }));
};

const describeBatch = async (describe: Describe, jobs: MetadataJob[]): Promise<void> => {
  const cancellation = new AbortController();
  const abort = () => {
    if (jobs.every(({ signal }) => signal.aborted)) cancellation.abort();
  };
  for (const { signal } of jobs) signal.addEventListener("abort", abort);
  abort();
  try {
    const parts = await runImagePreview(cancellation.signal, async () => {
      const first = jobs[0]!;
      const identities = new Map<string, AgentGeneratedImageDescribeInput["images"][number]>();
      for (const { input, signal } of jobs) {
        if (signal.aborted) continue;
        const identity: AgentGeneratedImageDescribeInput["images"][number] = {
          itemId: input.itemId,
        };
        if (input.turnId !== undefined) identity.turnId = input.turnId;
        identities.set(imageKey(identity), identity);
      }
      const result = await describe({ ref: first.input.ref, images: [...identities.values()] });
      const parts = new Map(result.images.map((part) => [imageKey(part), part]));
      if (
        JSON.stringify(generatedImageMetadataSessionKey(result.ref)) !==
          JSON.stringify(generatedImageMetadataSessionKey(first.input.ref)) ||
        result.images.length !== identities.size ||
        parts.size !== identities.size ||
        [...identities.keys()].some((key) => !parts.has(key))
      )
        throw new Error("Image metadata belongs to another session or item. Reopen the session.");
      return parts;
    });
    for (const job of jobs) {
      if (job.signal.aborted) job.reject(job.signal.reason);
      else job.resolve(parts.get(imageKey(job.input))!);
    }
  } catch (cause) {
    for (const job of jobs) job.reject(job.signal.aborted ? job.signal.reason : cause);
  } finally {
    for (const { signal } of jobs) signal.removeEventListener("abort", abort);
  }
};
