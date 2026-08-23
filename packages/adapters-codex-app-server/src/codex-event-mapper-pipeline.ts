import type {
  CodexCanonicalEvent,
  CodexMappingContext,
  CodexMappingResult,
} from "./codex-canonical-events";
import { emptyCodexMappingResult } from "./codex-canonical-events";
import type {
  CodexLiveInput,
  CodexThreadItemInput,
  RegisteredCodexEventMapper,
} from "./codex-event-mapper";
import { CodexSubagentLinkState } from "./codex-subagent-link-state";
import { createCodexEventMappers } from "./event-mappers";

export type CodexEventMapperPipeline = {
  runLive(input: CodexLiveInput, ctx: CodexMappingContext): CodexCanonicalEvent[];
  runLiveResult(input: CodexLiveInput, ctx: CodexMappingContext): CodexMappingResult;
  runThreadItem(input: CodexThreadItemInput, ctx: CodexMappingContext): CodexCanonicalEvent[];
  runThreadItemResult(input: CodexThreadItemInput, ctx: CodexMappingContext): CodexMappingResult;
};

const runFirstHandled = <Input>(
  mappers: RegisteredCodexEventMapper[],
  input: Input,
  ctx: CodexMappingContext,
  invoke: (
    mapper: RegisteredCodexEventMapper,
    input: Input,
    ctx: CodexMappingContext,
  ) => CodexMappingResult,
): CodexMappingResult => {
  for (const mapper of mappers) {
    const result = invoke(mapper, input, ctx);
    if (result.handled) {
      return result;
    }
  }
  return emptyCodexMappingResult();
};

export const createCodexEventMapperPipeline = (
  mappers: RegisteredCodexEventMapper[] = createCodexEventMappers(new CodexSubagentLinkState()),
): CodexEventMapperPipeline => {
  return {
    runLive(input, ctx) {
      return this.runLiveResult(input, ctx).events;
    },
    runLiveResult(input, ctx) {
      return runFirstHandled(mappers, input, ctx, (mapper, liveInput, context) =>
        mapper.fromLive(liveInput, context),
      );
    },
    runThreadItem(input, ctx) {
      return this.runThreadItemResult(input, ctx).events;
    },
    runThreadItemResult(input, ctx) {
      return runFirstHandled(mappers, input, ctx, (mapper, threadInput, context) =>
        mapper.fromThreadItem(threadInput, context),
      );
    },
  };
};
