import type { AgentGeneratedImageReadInput } from "@openducktor/contracts";
import {
  LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT,
  LOCAL_ATTACHMENT_BYTE_LIMIT,
} from "@openducktor/contracts";
import type { AgentGeneratedImageSource } from "@openducktor/core";
import {
  codexImageGenerationPart,
  type CodexImageGenerationPreparer,
} from "./codex-image-generation";
import type { CodexRuntimeClientResolver } from "./codex-runtime-client-resolver";
import type { CodexThreadInventoryReader } from "./codex-thread-inventory";
import type { CodexThreadHistoryReadResponse } from "./types";

export class CodexGeneratedImageResolver {
  private readonly runtimes = new Map<
    string,
    Map<string, Promise<CodexThreadHistoryReadResponse | undefined>>
  >();

  constructor(
    private readonly clients: CodexRuntimeClientResolver,
    private readonly history: CodexThreadInventoryReader,
    private readonly prepareImages?: CodexImageGenerationPreparer,
  ) {}

  prepareRuntime(runtimeId: string): void {
    if (!this.runtimes.has(runtimeId)) this.runtimes.set(runtimeId, new Map());
  }

  releaseRuntime(runtimeId: string): void {
    this.runtimes.delete(runtimeId);
  }

  /** Share pending history reads, but reject results if the runtime changes during either await. */
  async resolve(input: AgentGeneratedImageReadInput): Promise<AgentGeneratedImageSource> {
    const snapshot = new Map(this.runtimes);
    const { client, runtimeId } = await this.clients.resolve(input.ref, "read generated image");
    const reads = snapshot.get(runtimeId);
    const unavailable = (reason: string): Error =>
      new Error(`Image '${input.itemId}' is unavailable: ${reason}`);
    if (!reads || this.runtimes.get(runtimeId) !== reads)
      throw unavailable("the runtime changed during the read. Reopen the session on its runtime.");
    const threadId = input.ref.externalSessionId;
    let pending = reads.get(threadId);
    if (!pending) {
      pending = this.history.readThreadWithTurns(client, threadId);
      reads.set(threadId, pending);
    }
    let response: CodexThreadHistoryReadResponse | undefined;
    try {
      response = await pending;
    } finally {
      if (reads.get(threadId) === pending) reads.delete(threadId);
    }
    if (this.runtimes.get(runtimeId) !== reads)
      throw unavailable("the runtime changed during the read. Reopen the session.");
    if (
      !response ||
      response.thread.id !== threadId ||
      response.thread.cwd !== input.ref.workingDirectory
    ) {
      throw unavailable(
        "public history does not match the requested session and working directory.",
      );
    }
    const matches = response.thread.turns.flatMap((turn) => {
      if (input.turnId !== undefined && turn.id !== input.turnId) return [];
      return turn.items.filter(
        (item) => item.type === "imageGeneration" && item.id === input.itemId,
      );
    });
    const item = matches[0];
    if (matches.length !== 1 || !item || item.type !== "imageGeneration") {
      throw unavailable(
        "public history does not contain one matching generation item. Check the session history.",
      );
    }
    if (
      item.savedPath === undefined &&
      (item.result.length > LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT ||
        (item.result.length / 4) * 3 -
          (item.result.endsWith("==") ? 2 : item.result.endsWith("=") ? 1 : 0) >
          LOCAL_ATTACHMENT_BYTE_LIMIT)
    )
      throw unavailable("the inline image exceeds the 32 MiB preview limit.");
    const sourceItem = item.savedPath === undefined ? item : { ...item, result: "" };
    const parts = this.prepareImages
      ? await this.prepareImages([{ item: sourceItem, context: {} }])
      : [codexImageGenerationPart(sourceItem)];
    const part = parts[0];
    if (this.runtimes.get(runtimeId) !== reads)
      throw unavailable("the runtime changed during the read. Reopen the session.");
    if (parts.length !== 1 || !part || part.itemId !== item.id || part.turnId !== undefined)
      throw unavailable("image preparation returned the wrong item. Reopen the session.");
    if (part.status !== "completed") throw unavailable("generation has no completed result.");
    if (!part.output)
      throw unavailable(
        "the runtime returned no saved file or inline image. Check the runtime response.",
      );
    if (part.output.revision !== input.revision)
      throw unavailable(
        "the generated output changed. Reload the session history before opening the preview.",
      );
    if (item.savedPath !== undefined) return { representation: "saved_file", path: item.savedPath };
    return { representation: "inline", base64: item.result };
  }
}
