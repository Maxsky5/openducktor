import {
  codexImageGenerationPart,
  type CodexImageGenerationContext,
} from "../codex-image-generation";
import {
  emptyCodexMappingResult,
  type CodexMappingContext,
  type CodexMappingResult,
} from "../codex-canonical-events";
import { noCodexMapperState, type CodexEventMapper } from "../codex-event-mapper";
import type { AgentImageGenerationPart } from "@openducktor/contracts";

export const imageGenerationMapper: CodexEventMapper = {
  name: "image_generation",
  createState: noCodexMapperState,
  fromLive(input, ctx) {
    if (
      (input.kind !== "item_started" && input.kind !== "item_completed") ||
      input.item.type !== "imageGeneration"
    )
      return emptyCodexMappingResult();
    const context: CodexImageGenerationContext = { liveStart: input.kind === "item_started" };
    if (ctx.turnId !== undefined) context.turnId = ctx.turnId;
    return imageEvent(codexImageGenerationPart(input.item, context), ctx);
  },
  fromThreadItem(input, ctx) {
    if (input.item.type !== "imageGeneration") return emptyCodexMappingResult();
    const context: CodexImageGenerationContext = {};
    if (ctx.turnId !== undefined) context.turnId = ctx.turnId;
    if (input.turn !== undefined) context.turnStatus = input.turn.status;
    return imageEvent(codexImageGenerationPart(input.item, context), ctx);
  },
};

const imageEvent = (
  part: AgentImageGenerationPart,
  ctx: CodexMappingContext,
): CodexMappingResult => ({
  handled: true,
  events: [{ ...ctx, kind: "stream_part", mapper: "image_generation", part }],
});
