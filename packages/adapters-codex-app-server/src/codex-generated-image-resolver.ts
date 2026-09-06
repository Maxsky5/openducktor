import type { AgentGeneratedImageReadInput } from "@openducktor/contracts";
import { LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT } from "@openducktor/contracts";
import type { AgentGeneratedImageSource } from "@openducktor/core";
import { codexImageGenerationPart } from "./codex-image-generation";
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
    if (codexImageGenerationPart(item).status !== "completed")
      throw unavailable("generation has no completed result.");
    if (item.savedPath !== undefined) return { representation: "saved_file", path: item.savedPath };
    if (item.result.length === 0)
      throw unavailable(
        "the runtime returned no saved file or inline image. Check the runtime response.",
      );
    if (item.result.length > LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT)
      throw unavailable("the inline image exceeds the 32 MiB preview limit.");
    return { representation: "inline", base64: item.result };
  }
}
