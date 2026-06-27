import type {
  CodexCanonicalEvent,
  CodexMappingContext,
  CodexMappingResult,
} from "./codex-canonical-events";
import { emptyCodexMappingResult } from "./codex-canonical-events";
import type {
  CodexEventMapper,
  CodexLiveInput,
  CodexMapperState,
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

const createMapperStates = (mappers: RegisteredCodexEventMapper[]): Map<string, CodexMapperState> =>
  new Map(mappers.map((mapper) => [mapper.name, mapper.createState()]));

const runFirstHandled = <Input>(
  mappers: RegisteredCodexEventMapper[],
  states: Map<string, CodexMapperState>,
  input: Input,
  ctx: CodexMappingContext,
  invoke: (
    mapper: RegisteredCodexEventMapper,
    input: Input,
    ctx: CodexMappingContext,
    state: CodexMapperState,
  ) => ReturnType<CodexEventMapper["fromLive"]>,
): CodexMappingResult => {
  for (const mapper of mappers) {
    const result = invoke(mapper, input, ctx, states.get(mapper.name));
    if (result.handled) {
      return result;
    }
  }
  return emptyCodexMappingResult();
};

export const createCodexEventMapperPipeline = (
  mappers: RegisteredCodexEventMapper[] = createCodexEventMappers(new CodexSubagentLinkState()),
): CodexEventMapperPipeline => {
  const states = createMapperStates(mappers);
  return {
    runLive(input, ctx) {
      return this.runLiveResult(input, ctx).events;
    },
    runLiveResult(input, ctx) {
      return runFirstHandled(mappers, states, input, ctx, (mapper, liveInput, context, state) =>
        mapper.fromLive(liveInput, context, state),
      );
    },
    runThreadItem(input, ctx) {
      return this.runThreadItemResult(input, ctx).events;
    },
    runThreadItemResult(input, ctx) {
      return runFirstHandled(mappers, states, input, ctx, (mapper, threadInput, context, state) =>
        mapper.fromThreadItem(threadInput, context, state),
      );
    },
  };
};
