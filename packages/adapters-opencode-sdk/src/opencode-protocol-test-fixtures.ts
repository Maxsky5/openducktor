import { type JsonObject, type JsonValue, jsonValueSchema } from "@openducktor/contracts";
import type { GlobalEvent, Session } from "@opencode-ai/sdk/v2/client";
import { z } from "zod";
import {
  opencodeMessageInfoPayloadSchema,
  opencodePartPayloadSchema,
  type ParsedOpencodeMessage,
  type ParsedOpencodePart,
} from "./opencode-ingress";
import {
  parseOpencodeDirectEvent,
  parseOpencodeGlobalEventPayload,
  type OpencodeGlobalEventPayloadInput,
  type ParsedOpencodeEvent,
  type ParsedOpencodeGlobalEventPayload,
} from "./opencode-global-event-ingress";
import type { ConsumedOpencodeEventType } from "./opencode-event-policy";

const DEFAULT_TOKENS = {
  cache: { read: 0, write: 0 },
  input: 0,
  output: 0,
  reasoning: 0,
} as const;

type OpencodeSessionFixtureOverrides = Omit<Partial<Session>, "time"> & {
  time?: Partial<Session["time"]>;
};

export const createOpencodeSessionFixture = (
  overrides: OpencodeSessionFixtureOverrides = {},
): Session => ({
  id: "session-opencode-1",
  slug: "session-opencode-1",
  projectID: "project-1",
  directory: "/repo",
  title: "OpenDucktor test session",
  version: "1.18.18",
  ...overrides,
  time: {
    created: Date.parse("2026-02-22T12:00:00.000Z"),
    updated: Date.parse("2026-02-22T12:00:00.000Z"),
    ...overrides.time,
  },
});

type UserMessageInfo = Extract<ParsedOpencodeMessage["info"], { role: "user" }>;
type AssistantMessageInfo = Extract<ParsedOpencodeMessage["info"], { role: "assistant" }>;

export type OpencodeMessageInfoFixtureInput =
  | (Omit<Partial<UserMessageInfo>, "model" | "role" | "time"> & {
      id: string;
      role: "user";
      model?: Partial<UserMessageInfo["model"]>;
      modelID?: string;
      providerID?: string;
      time?: Partial<UserMessageInfo["time"]>;
      variant?: string;
    })
  | (Omit<Partial<AssistantMessageInfo>, "path" | "role" | "time" | "tokens"> & {
      id: string;
      role: "assistant";
      path?: Partial<AssistantMessageInfo["path"]>;
      time?: Partial<AssistantMessageInfo["time"]>;
      tokens?: Partial<AssistantMessageInfo["tokens"]> & {
        cache?: Partial<AssistantMessageInfo["tokens"]["cache"]>;
      };
    });

export const createOpencodeMessageInfoFixture = (info: OpencodeMessageInfoFixtureInput) => {
  if (info.role === "user") {
    const { model, modelID, providerID, time, variant, ...fields } = info;
    const selectedVariant = variant ?? model?.variant;
    const selectedModel: UserMessageInfo["model"] = {
      modelID: modelID ?? model?.modelID ?? "gpt-5",
      providerID: providerID ?? model?.providerID ?? "openai",
    };
    if (selectedVariant) {
      selectedModel.variant = selectedVariant;
    }
    return opencodeMessageInfoPayloadSchema.parse({
      agent: "build",
      model: selectedModel,
      sessionID: "session-opencode-1",
      ...fields,
      time: { created: 1, ...time },
    });
  }

  const { path, role: _role, time, tokens, ...fields } = info;
  return opencodeMessageInfoPayloadSchema.parse({
    agent: "build",
    cost: 0,
    mode: "build",
    modelID: "gpt-5",
    parentID: "user-parent",
    path: { cwd: "/repo", root: "/repo", ...path },
    providerID: "openai",
    role: "assistant",
    sessionID: "session-opencode-1",
    ...fields,
    time: { created: 1, ...time },
    tokens: {
      ...DEFAULT_TOKENS,
      ...tokens,
      cache: { ...DEFAULT_TOKENS.cache, ...tokens?.cache },
    },
  });
};

const serializeToolResult = (value: JsonValue): string => {
  const parsed = jsonValueSchema.parse(value);
  const text = z.string().safeParse(parsed);
  return text.success ? text.data : JSON.stringify(parsed);
};

type PartialVariant<Variant, Discriminator extends keyof Variant> = Variant extends Variant
  ? Pick<Variant, Discriminator> & Partial<Omit<Variant, Discriminator>>
  : never;
type ToolPart = Extract<ParsedOpencodePart, { type: "tool" }>;
type ToolStateFixture = ToolPart["state"] extends infer State
  ? State extends { status: string }
    ? Pick<State, "status"> & Partial<Omit<State, "status">>
    : never
  : never;

export type OpencodePartFixtureInput =
  | PartialVariant<Exclude<ParsedOpencodePart, ToolPart>, "type">
  | (Pick<ToolPart, "type"> &
      Partial<Omit<ToolPart, "state" | "type">> & { state: ToolStateFixture });

export const createOpencodePartFixture = (part: OpencodePartFixtureInput): ParsedOpencodePart => {
  if (part.type === "reasoning") {
    return opencodePartPayloadSchema.parse({ time: { start: 1 }, ...part });
  }
  if (part.type === "patch") {
    return opencodePartPayloadSchema.parse({ hash: "test-patch", ...part });
  }
  if (part.type === "step-finish") {
    return opencodePartPayloadSchema.parse({
      ...part,
      cost: part.cost ?? 0,
      reason: part.reason ?? "stop",
      tokens: {
        ...DEFAULT_TOKENS,
        ...part.tokens,
        cache: { ...DEFAULT_TOKENS.cache, ...part.tokens?.cache },
      },
    });
  }
  if (part.type === "file") {
    const source = part.source;
    if (source?.type === "file" && source.text === undefined) {
      const path = source.path ?? "fixture";
      return opencodePartPayloadSchema.parse({
        ...part,
        source: { ...source, text: { end: path.length, start: 0, value: path } },
      });
    }
  }
  if (part.type !== "tool") {
    return opencodePartPayloadSchema.parse(part);
  }

  const state = part.state;
  const status = state.status;
  const input = state.input ?? {};
  switch (status) {
    case "pending":
      return opencodePartPayloadSchema.parse({
        ...part,
        state: { input, raw: state.raw ?? "", status },
      });
    case "running":
      return opencodePartPayloadSchema.parse({
        ...part,
        state: { time: { start: 1 }, ...state, input, status },
      });
    case "completed":
      return opencodePartPayloadSchema.parse({
        ...part,
        state: {
          metadata: {},
          time: { end: 2, start: 1 },
          title: "",
          ...state,
          input,
          output: state.output === undefined ? "" : serializeToolResult(state.output),
          status,
        },
      });
    case "error":
      return opencodePartPayloadSchema.parse({
        ...part,
        state: {
          time: { end: 2, start: 1 },
          ...state,
          error: state.error === undefined ? "" : serializeToolResult(state.error),
          input,
          status,
        },
      });
    default:
      return opencodePartPayloadSchema.parse(part);
  }
};

export type DirectEventFixtureInput<Variant = ParsedOpencodeEvent> = Variant extends {
  id: string;
  properties: infer Properties;
  type: infer Type;
}
  ? Type extends "message.updated"
    ? {
        id?: string;
        type: Type;
        properties: Omit<Properties, "info" | "sessionID"> & {
          info: OpencodeMessageInfoFixtureInput;
          sessionID?: string;
        };
      }
    : Type extends "message.part.updated"
      ? {
          id?: string;
          type: Type;
          properties: Omit<Properties, "part" | "sessionID" | "time"> & {
            part: OpencodePartFixtureInput;
            sessionID?: string;
            time?: number;
          };
        }
      : { id?: string; properties: Properties; type: Type }
  : never;

type SyncEventFixtureInput = Omit<
  Extract<ParsedOpencodeGlobalEventPayload, { type: "sync" }>,
  "id"
> & { id?: string };

export type MalformedOpencodeControlEventFixture = {
  id: string;
  type:
    | "permission.v2.replied"
    | "question.asked"
    | "question.rejected"
    | "question.replied"
    | "question.v2.asked"
    | "question.v2.rejected"
    | "question.v2.replied"
    | "session.status";
  properties: JsonObject;
};

type OptionalFixtureId<Event> = Event extends { id: string }
  ? Omit<Event, "id"> & { id?: string }
  : Event;
type IgnoredEventFixtureInput = OptionalFixtureId<
  Exclude<GlobalEvent["payload"], { type: ConsumedOpencodeEventType | "sync" }>
>;
type HeartbeatEventFixtureInput = {
  id?: string;
  type: "server.heartbeat";
  properties: JsonObject;
};

export type OpencodeMessageEventGroupFixture = {
  fixture: "message-events";
  id?: string;
  info: OpencodeMessageInfoFixtureInput;
  parts?: OpencodePartFixtureInput[];
  sessionID?: string;
};

export const createOpencodeMessageEventGroupFixture = (
  input: Omit<OpencodeMessageEventGroupFixture, "fixture">,
): OpencodeMessageEventGroupFixture => ({ fixture: "message-events", ...input });

export type OpencodeEventFixtureInput =
  | DirectEventFixtureInput
  | IgnoredEventFixtureInput
  | HeartbeatEventFixtureInput
  | MalformedOpencodeControlEventFixture
  | OpencodeMessageEventGroupFixture
  | SyncEventFixtureInput;

type OpencodeEventFixtureOutput = OpencodeGlobalEventPayloadInput;

export function createOpencodeEventFixtures(
  event: DirectEventFixtureInput,
  index: number,
): ParsedOpencodeEvent[];
export function createOpencodeEventFixtures(
  event: OpencodeMessageEventGroupFixture,
  index: number,
): ParsedOpencodeEvent[];
export function createOpencodeEventFixtures(
  event: OpencodeEventFixtureInput,
  index: number,
): OpencodeEventFixtureOutput[];
export function createOpencodeEventFixtures(
  event: OpencodeEventFixtureInput,
  index: number,
): OpencodeEventFixtureOutput[] {
  if ("fixture" in event) {
    const messageInfo = createOpencodeMessageInfoFixture(event.info);
    const sessionID = event.sessionID ?? messageInfo.sessionID;
    const id = event.id ?? `test-event-${index}`;
    return [
      parseOpencodeGlobalEventPayload({
        id,
        type: "message.updated",
        properties: { info: messageInfo, sessionID },
      }),
      ...(event.parts ?? []).map((partInput, partIndex) => {
        const part = createOpencodePartFixture(partInput);
        return parseOpencodeGlobalEventPayload({
          id: `${id}-part-${partIndex}`,
          type: "message.part.updated",
          properties: { part, sessionID: part.sessionID, time: messageInfo.time.created },
        });
      }),
    ];
  }

  const id = event.id ?? `test-event-${index}`;
  if (event.type === "sync") {
    return [parseOpencodeGlobalEventPayload({ ...event, id })];
  }

  if (event.type === "message.updated") {
    const messageInfo = createOpencodeMessageInfoFixture(event.properties.info);
    return [
      parseOpencodeGlobalEventPayload({
        id,
        type: "message.updated",
        properties: {
          ...event.properties,
          info: messageInfo,
          sessionID: event.properties.sessionID ?? messageInfo.sessionID,
        },
      }),
    ];
  }
  if (event.type === "message.part.updated") {
    const part = createOpencodePartFixture(event.properties.part);
    return [
      parseOpencodeGlobalEventPayload({
        id,
        type: "message.part.updated",
        properties: {
          ...event.properties,
          part,
          sessionID: event.properties.sessionID ?? part.sessionID,
          time: event.properties.time ?? 1,
        },
      }),
    ];
  }

  return [{ ...event, id }];
}

export const createParsedOpencodeMessageEventGroupFixtures = (
  input: Omit<OpencodeMessageEventGroupFixture, "fixture">,
): ParsedOpencodeEvent[] =>
  createOpencodeEventFixtures(createOpencodeMessageEventGroupFixture(input), 0).map((fixture) =>
    parseOpencodeDirectEvent(fixture),
  );

export const createParsedOpencodeEventFixtures = (
  event: DirectEventFixtureInput,
  index = 0,
): ParsedOpencodeEvent[] =>
  createOpencodeEventFixtures(event, index).map((fixture) => parseOpencodeDirectEvent(fixture));

export const createParsedOpencodeEventFixture = (
  event: DirectEventFixtureInput,
  index = 0,
): ParsedOpencodeEvent => {
  const fixtures = createParsedOpencodeEventFixtures(event, index);
  const [fixture] = fixtures;
  if (fixtures.length !== 1 || !fixture) {
    throw new Error("Expected one OpenCode event fixture.");
  }
  return fixture;
};
