import {
  AGENT_GENERATED_IMAGE_BATCH_LIMIT,
  LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT,
  LOCAL_ATTACHMENT_BYTE_LIMIT,
  type AgentGeneratedImageBatch,
  type AgentGeneratedImageBatchInput,
  type AgentGeneratedImageDescribeInput,
  type AgentGeneratedImageDescribeResult,
  type AgentGeneratedImageReadInput,
  type AgentSessionLiveRef,
} from "@openducktor/contracts";
import type { AgentGeneratedImageSource } from "@openducktor/core";
import {
  codexImageGenerationPart,
  type CodexImageGenerationPreparation,
  type CodexImageGenerationPreparer,
} from "./codex-image-generation";
import type { CodexRuntimeClientResolver } from "./codex-runtime-client-resolver";
import type { CodexThreadInventoryReader } from "./codex-thread-inventory";
import type { CodexAppServerClient, CodexThreadHistoryReadResponse } from "./types";

const MAX_RUNTIME_IMAGE_BATCHES = 2;
const IMAGE_BATCH_LIFETIME_MS = 120_000;
type ImageIdentity = AgentGeneratedImageDescribeInput["images"][number];
type BatchItem = {
  revision: string;
  result: { preparation: CodexImageGenerationPreparation } | { error: Error };
};
type ImageBatch = {
  ref: AgentSessionLiveRef;
  items: Map<string, BatchItem>;
  cancellation: AbortController;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
};
type ImageRuntime = {
  reads: Map<string, Promise<CodexThreadHistoryReadResponse | undefined>>;
  cancellation: AbortController;
  batches: Map<string, ImageBatch>;
};
type ImageReadOwner = {
  runtimeId: string;
  runtime: ImageRuntime;
  client: CodexAppServerClient;
  signal: AbortSignal;
};

export class CodexGeneratedImageResolver {
  private readonly runtimes = new Map<string, ImageRuntime>();

  constructor(
    private readonly clients: CodexRuntimeClientResolver,
    private readonly history: CodexThreadInventoryReader,
    private readonly prepareImages?: CodexImageGenerationPreparer,
  ) {}

  prepareRuntime(runtimeId: string): void {
    if (!this.runtimes.has(runtimeId))
      this.runtimes.set(runtimeId, {
        reads: new Map(),
        cancellation: new AbortController(),
        batches: new Map(),
      });
  }

  releaseRuntime(runtimeId: string): void {
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) return;
    runtime.cancellation.abort(
      new Error("The image runtime changed. Reopen the session on its runtime."),
    );
    for (const batchId of runtime.batches.keys()) releaseBatch(runtime, batchId);
    this.runtimes.delete(runtimeId);
  }

  releaseSession(ref: AgentSessionLiveRef): void {
    for (const runtime of this.runtimes.values())
      for (const [batchId, batch] of runtime.batches)
        if (sameRef(batch.ref, ref)) releaseBatch(runtime, batchId);
  }

  /** Keep only the selected sources until their queued previews consume them. */
  async beginBatch(
    input: AgentGeneratedImageBatchInput,
    signal?: AbortSignal,
  ): Promise<AgentGeneratedImageBatch> {
    const owner = await this.resolveOwner(input.ref, signal);
    if (
      input.images.length === 0 ||
      input.images.length > AGENT_GENERATED_IMAGE_BATCH_LIMIT ||
      new Set(input.images.map(imageKey)).size !== input.images.length
    )
      throw new Error("An image batch must contain one to eight distinct images.");
    if (owner.runtime.batches.size >= MAX_RUNTIME_IMAGE_BATCHES)
      throw new Error(
        "The runtime already has two image preview batches. Close a preview before opening another batch.",
      );
    const batchId = crypto.randomUUID();
    const batch: ImageBatch = {
      ref: { ...input.ref },
      items: new Map(),
      cancellation: new AbortController(),
      deadline: Date.now() + IMAGE_BATCH_LIFETIME_MS,
      timer: setTimeout(() => releaseBatch(owner.runtime, batchId), IMAGE_BATCH_LIFETIME_MS),
    };
    owner.runtime.batches.set(batchId, batch);
    try {
      const response = await this.readHistory(owner, input.ref);
      this.assertCurrent(owner);
      if (owner.runtime.batches.get(batchId) !== batch)
        throw new Error("The image preview batch expired. Reopen the preview.");
      for (const identity of input.images) {
        let result: BatchItem["result"];
        try {
          result = { preparation: selectImage(response, identity) };
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          result = { error };
        }
        batch.items.set(imageKey(identity), { revision: identity.revision, result });
      }
      return { ref: batch.ref, batchId };
    } catch (error) {
      releaseBatch(owner.runtime, batchId);
      throw error;
    }
  }

  releaseImageBatch(input: AgentGeneratedImageBatch): void {
    for (const runtime of this.runtimes.values()) {
      const batch = runtime.batches.get(input.batchId);
      if (batch && sameRef(batch.ref, input.ref)) releaseBatch(runtime, input.batchId);
    }
  }

  async describe(
    input: AgentGeneratedImageDescribeInput,
    signal?: AbortSignal,
  ): Promise<AgentGeneratedImageDescribeResult> {
    const owner = await this.resolveOwner(input.ref, signal);
    const response = await this.readHistory(owner, input.ref);
    const preparations = input.images.map((identity) => selectImage(response, identity));
    const images = await this.prepare(preparations, owner.signal);
    this.assertCurrent(owner);
    return { ref: input.ref, images };
  }

  async resolve(
    input: AgentGeneratedImageReadInput,
    signal?: AbortSignal,
  ): Promise<AgentGeneratedImageSource> {
    const owner = await this.resolveOwner(input.ref, signal);
    let preparation: CodexImageGenerationPreparation;
    if (input.batchId !== undefined) {
      const batch = owner.runtime.batches.get(input.batchId);
      if (!batch || !sameRef(batch.ref, input.ref) || Date.now() >= batch.deadline) {
        if (batch && sameRef(batch.ref, input.ref)) releaseBatch(owner.runtime, input.batchId);
        throw unavailable(
          input.itemId,
          "the preview batch expired or belongs to another session. Reopen the preview.",
        );
      }
      const selected = batch.items.get(imageKey(input));
      if (!selected || selected.revision !== input.revision)
        throw unavailable(
          input.itemId,
          "the preview batch does not contain this output revision. Reopen the preview.",
        );
      batch.items.delete(imageKey(input));
      owner.signal = AbortSignal.any([owner.signal, batch.cancellation.signal]);
      if ("error" in selected.result) throw selected.result.error;
      preparation = selected.result.preparation;
    } else {
      preparation = selectImage(await this.readHistory(owner, input.ref), input);
    }
    this.assertCurrent(owner);
    const { item } = preparation;
    if (item.status !== "completed")
      throw unavailable(input.itemId, "generation has no completed result.");
    // The host verifies the requested digest against the bytes from its open file handle.
    if (item.savedPath !== undefined)
      return { representation: "saved_file", path: item.savedPath, revision: input.revision };
    const [part] = await this.prepare([{ item, context: {} }], owner.signal);
    this.assertCurrent(owner);
    if (!part?.output)
      throw unavailable(
        input.itemId,
        "the runtime returned no saved file or inline image. Check the runtime response.",
      );
    if (part.output.revision !== input.revision)
      throw unavailable(
        input.itemId,
        "the generated output changed. Reload the session history before opening the preview.",
      );
    return { representation: "inline", base64: item.result };
  }

  private async resolveOwner(
    ref: AgentSessionLiveRef,
    signal?: AbortSignal,
  ): Promise<ImageReadOwner> {
    signal?.throwIfAborted();
    const snapshot = new Map(this.runtimes);
    const { client, runtimeId } = await this.clients.resolve(ref, "read generated image");
    signal?.throwIfAborted();
    const runtime = snapshot.get(runtimeId);
    if (!runtime || this.runtimes.get(runtimeId) !== runtime)
      throw new Error(
        "The image runtime changed during the read. Reopen the session on its runtime.",
      );
    const owner = {
      client,
      runtimeId,
      runtime,
      signal: signal
        ? AbortSignal.any([signal, runtime.cancellation.signal])
        : runtime.cancellation.signal,
    };
    this.assertCurrent(owner);
    return owner;
  }

  private assertCurrent(owner: ImageReadOwner): void {
    owner.signal.throwIfAborted();
    if (this.runtimes.get(owner.runtimeId) !== owner.runtime)
      throw new Error("The image runtime changed during the read. Reopen the session.");
  }

  private async readHistory(
    owner: ImageReadOwner,
    ref: AgentSessionLiveRef,
  ): Promise<CodexThreadHistoryReadResponse> {
    const { reads } = owner.runtime;
    const threadId = ref.externalSessionId;
    let pending = reads.get(threadId);
    if (!pending) {
      pending = this.history.readThreadWithTurns(owner.client, threadId);
      reads.set(threadId, pending);
    }
    let response: CodexThreadHistoryReadResponse | undefined;
    try {
      response = await pending;
    } finally {
      if (reads.get(threadId) === pending) reads.delete(threadId);
    }
    this.assertCurrent(owner);
    if (
      !response ||
      response.thread.id !== threadId ||
      response.thread.cwd !== ref.workingDirectory
    )
      throw new Error(
        "Image public history does not match the requested session and working directory.",
      );
    return response;
  }

  private async prepare(images: readonly CodexImageGenerationPreparation[], signal: AbortSignal) {
    const parts = this.prepareImages
      ? await this.prepareImages(images, signal)
      : images.map(({ item, context }) => codexImageGenerationPart(item, context));
    signal.throwIfAborted();
    if (
      parts.length !== images.length ||
      images.some(({ item, context }, index) => {
        const part = parts[index];
        return !part || part.itemId !== item.id || part.turnId !== context.turnId;
      })
    )
      throw new Error("Image preparation returned the wrong item. Reopen the session.");
    return parts;
  }
}

const imageKey = ({ itemId, turnId }: ImageIdentity): string =>
  JSON.stringify([turnId ?? null, itemId]);
const sameRef = (left: AgentSessionLiveRef, right: AgentSessionLiveRef): boolean =>
  left.repoPath === right.repoPath &&
  left.runtimeKind === right.runtimeKind &&
  left.workingDirectory === right.workingDirectory &&
  left.externalSessionId === right.externalSessionId;
const unavailable = (itemId: string, reason: string): Error =>
  new Error(`Image '${itemId}' is unavailable: ${reason}`);
const releaseBatch = (runtime: ImageRuntime, batchId: string): void => {
  const batch = runtime.batches.get(batchId);
  if (!batch) return;
  clearTimeout(batch.timer);
  batch.cancellation.abort(new Error("The image preview batch was released. Reopen the preview."));
  batch.items.clear();
  runtime.batches.delete(batchId);
};
const selectImage = (
  response: CodexThreadHistoryReadResponse,
  identity: ImageIdentity,
): CodexImageGenerationPreparation => {
  const matches = response.thread.turns.flatMap((turn) => {
    if (identity.turnId !== undefined && turn.id !== identity.turnId) return [];
    return turn.items.flatMap((item) =>
      item.type === "imageGeneration" && item.id === identity.itemId
        ? [{ item, context: { turnId: turn.id, turnStatus: turn.status } }]
        : [],
    );
  });
  const selected = matches[0];
  if (matches.length !== 1 || !selected)
    throw unavailable(
      identity.itemId,
      "public history does not contain one matching generation item. Check the session history.",
    );
  const { item } = selected;
  if (item.savedPath !== undefined) return { ...selected, item: { ...item, result: "" } };
  if (
    item.result.length > LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT ||
    (item.result.length / 4) * 3 -
      (item.result.endsWith("==") ? 2 : item.result.endsWith("=") ? 1 : 0) >
      LOCAL_ATTACHMENT_BYTE_LIMIT
  )
    throw unavailable(identity.itemId, "the inline image exceeds the 32 MiB preview limit.");
  return selected;
};
