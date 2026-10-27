import {
  AGENT_GENERATED_IMAGE_BATCH_LIMIT,
  LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT,
  LOCAL_ATTACHMENT_BYTE_LIMIT,
  type AgentGeneratedImageBatch,
  type AgentGeneratedImageBatchResult,
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
import type {
  CodexAppServerAdapterOptions,
  CodexAppServerClient,
  CodexThreadHistoryReadResponse,
} from "./types";

const MAX_RUNTIME_IMAGE_BATCHES = 2;
// Reserve 96 MiB per batch, including active reads, using two bytes per string character.
const IMAGE_BATCH_RETAINED_BYTE_LIMIT = 96 * 1024 * 1024;
const IMAGE_BATCH_LIFETIME_MS = 120_000;
type ImageIdentity = AgentGeneratedImageDescribeInput["images"][number];
type BatchItem = {
  revision: string;
  result: { preparation: CodexImageGenerationPreparation } | { error: Error };
};
type ImageSelection<Identity> = { identity: Identity; result: BatchItem["result"] };
type ImageBatch = {
  ref: AgentSessionLiveRef;
  items: Map<string, BatchItem>;
  cancellation: AbortController;
  deadline: number;
  activeReads: number;
  released: boolean;
  timer: ReturnType<typeof setTimeout>;
};
/**
 * The completed images with a saved file in the last history read of a thread, by item ID. A
 * `null` item is not one such image. These items do not change, and the host checks each file
 * digest against the requested revision, so a later preview of them needs no history read.
 */
type SavedImages = {
  workingDirectory: string;
  items: Map<string, CodexImageGenerationPreparation | null>;
};
type ImageRuntime = {
  reads: Map<string, Promise<CodexThreadHistoryReadResponse | undefined>>;
  savedImages: Map<string, SavedImages>;
  cancellation: AbortController;
  batches: Map<string, ImageBatch>;
  reservations: Set<ImageBatch>;
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
    private readonly directoriesMatch: CodexAppServerAdapterOptions["directoriesMatch"],
    private readonly prepareImages?: CodexImageGenerationPreparer,
  ) {}

  prepareRuntime(runtimeId: string): void {
    if (!this.runtimes.has(runtimeId))
      this.runtimes.set(runtimeId, {
        reads: new Map(),
        savedImages: new Map(),
        cancellation: new AbortController(),
        batches: new Map(),
        reservations: new Set(),
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
    for (const runtime of this.runtimes.values()) {
      runtime.savedImages.delete(ref.externalSessionId);
      for (const [batchId, batch] of runtime.batches)
        if (sameRef(batch.ref, ref)) releaseBatch(runtime, batchId);
    }
  }

  /** Keep only the selected sources until their queued previews consume them. */
  async beginBatch(
    input: AgentGeneratedImageBatchInput,
    signal?: AbortSignal,
  ): Promise<AgentGeneratedImageBatchResult> {
    const owner = await this.resolveOwner(input.ref, signal);
    if (
      input.images.length === 0 ||
      input.images.length > AGENT_GENERATED_IMAGE_BATCH_LIMIT ||
      new Set(input.images.map(imageKey)).size !== input.images.length
    )
      throw new Error("An image batch must contain one to eight distinct images.");
    if (owner.runtime.reservations.size >= MAX_RUNTIME_IMAGE_BATCHES)
      throw new Error(
        "The runtime already has two image preview batches. Close a preview before opening another batch.",
      );
    const batchId = crypto.randomUUID();
    const batch: ImageBatch = {
      ref: { ...input.ref },
      activeReads: 1,
      released: false,
      items: new Map(),
      cancellation: new AbortController(),
      deadline: Date.now() + IMAGE_BATCH_LIFETIME_MS,
      timer: setTimeout(() => releaseBatch(owner.runtime, batchId), IMAGE_BATCH_LIFETIME_MS),
    };
    owner.runtime.batches.set(batchId, batch);
    owner.runtime.reservations.add(batch);
    try {
      const selections = await this.selectImages(owner, input.ref, input.images);
      this.assertCurrent(owner);
      if (owner.runtime.batches.get(batchId) !== batch)
        throw new Error("The image preview batch expired. Reopen the preview.");
      let retainedBytes = 0;
      const admittedImages: AgentGeneratedImageBatchInput["images"] = [];
      for (const { identity, result } of selections) {
        const bytes = "preparation" in result ? result.preparation.item.result.length * 2 : 0;
        if (retainedBytes + bytes > IMAGE_BATCH_RETAINED_BYTE_LIMIT) continue;
        retainedBytes += bytes;
        admittedImages.push(identity);
        batch.items.set(imageKey(identity), { revision: identity.revision, result });
      }
      return { ref: batch.ref, batchId, admittedImages };
    } catch (error) {
      releaseBatch(owner.runtime, batchId);
      throw error;
    } finally {
      finishBatchRead(owner.runtime, batch);
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
    const preparations = (await this.selectImages(owner, input.ref, input.images)).map(
      ({ result }) => {
        if ("error" in result) throw result.error;
        return result.preparation;
      },
    );
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
    let activeBatch: ImageBatch | undefined;
    try {
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
        activeBatch = batch;
        batch.activeReads++;
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
    } finally {
      if (activeBatch) finishBatchRead(owner.runtime, activeBatch);
    }
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

  /**
   * Selects each image from the saved images of the last history read. When one is not there, it
   * reads the public history once for all of them.
   */
  private async selectImages<Identity extends ImageIdentity>(
    owner: ImageReadOwner,
    ref: AgentSessionLiveRef,
    identities: readonly Identity[],
  ): Promise<ImageSelection<Identity>[]> {
    const saved = owner.runtime.savedImages.get(ref.externalSessionId);
    let history: Promise<CodexThreadHistoryReadResponse> | undefined;
    const selections: ImageSelection<Identity>[] = [];
    for (const identity of identities) {
      const known = savedImage(saved, ref, identity);
      if (known) {
        selections.push({ identity, result: { preparation: known } });
        continue;
      }
      history ??= this.readHistory(owner, ref);
      const response = await history;
      try {
        selections.push({ identity, result: { preparation: selectImage(response, identity) } });
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        selections.push({ identity, result: { error } });
      }
    }
    return selections;
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
      !(await this.directoriesMatch(response.thread.cwd, ref.workingDirectory))
    )
      throw new Error(
        "Image public history does not match the requested session and working directory.",
      );
    this.assertCurrent(owner);
    owner.runtime.savedImages.set(threadId, {
      workingDirectory: ref.workingDirectory,
      items: savedImagesOf(response),
    });
    return response;
  }

  private async prepare(images: readonly CodexImageGenerationPreparation[], signal: AbortSignal) {
    const parts = this.prepareImages
      ? await this.prepareImages(images, signal, "preview")
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
  batch.released = true;
  runtime.batches.delete(batchId);
  if (batch.activeReads === 0) runtime.reservations.delete(batch);
};
const finishBatchRead = (runtime: ImageRuntime, batch: ImageBatch): void => {
  batch.activeReads--;
  if (batch.released && batch.activeReads === 0) runtime.reservations.delete(batch);
};
const savedImagesOf = (response: CodexThreadHistoryReadResponse): SavedImages["items"] => {
  const items: SavedImages["items"] = new Map();
  for (const turn of response.thread.turns)
    for (const item of turn.items) {
      if (item.type !== "imageGeneration") continue;
      const saved =
        !items.has(item.id) && item.status === "completed" && item.savedPath !== undefined;
      items.set(
        item.id,
        saved
          ? { item: { ...item, result: "" }, context: { turnId: turn.id, turnStatus: turn.status } }
          : null,
      );
    }
  return items;
};
const savedImage = (
  saved: SavedImages | undefined,
  ref: AgentSessionLiveRef,
  identity: ImageIdentity,
): CodexImageGenerationPreparation | undefined => {
  if (saved?.workingDirectory !== ref.workingDirectory) return undefined;
  const preparation = saved.items.get(identity.itemId);
  if (!preparation) return undefined;
  if (identity.turnId !== undefined && preparation.context.turnId !== identity.turnId)
    return undefined;
  return preparation;
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
