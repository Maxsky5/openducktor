import { hasRuntimeType } from "@openducktor/contracts";
import type { Session } from "@opencode-ai/sdk/v2/client";
import { asUnknownRecord, readStringProp, readUnknownProp, type UnknownRecord } from "./guards";
import {
  opencodeMessageInfoPayloadSchema,
  opencodePartPayloadSchema,
  parseOpencodeGlobalEventPayload,
  type ParsedOpencodeGlobalEventPayload,
  type ParsedOpencodePart,
} from "./opencode-ingress";

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

export const createOpencodeMessageInfoFixture = (info: UnknownRecord) => {
  const parsed = opencodeMessageInfoPayloadSchema.safeParse(info);
  if (parsed.success) {
    return parsed.data;
  }

  if (info.role === "user") {
    const model = asUnknownRecord(info.model);
    const providerID =
      readStringProp(info, ["providerID"]) ?? readStringProp(model, ["providerID"]);
    const modelID = readStringProp(info, ["modelID"]) ?? readStringProp(model, ["modelID"]);
    const variant = readStringProp(info, ["variant"]) ?? readStringProp(model, ["variant"]);
    return opencodeMessageInfoPayloadSchema.parse({
      agent: "build",
      model: {
        modelID: modelID ?? "gpt-5",
        providerID: providerID ?? "openai",
        ...(variant ? { variant } : undefined),
      },
      sessionID: "session-opencode-1",
      time: { created: 1 },
      ...info,
    });
  }

  const tokens = asUnknownRecord(info.tokens);
  const cache = asUnknownRecord(tokens?.cache);
  const path = asUnknownRecord(info.path);
  const time = asUnknownRecord(info.time);
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
    ...info,
    time: { created: 1, ...time },
    tokens: {
      ...DEFAULT_TOKENS,
      ...tokens,
      cache: { ...DEFAULT_TOKENS.cache, ...cache },
    },
  });
};

const serializeToolResult = (value: unknown): string => {
  if (hasRuntimeType(value, "string")) {
    return value;
  }
  return value === undefined ? "" : JSON.stringify(value);
};

export const createOpencodePartFixture = (part: UnknownRecord): ParsedOpencodePart => {
  const parsed = opencodePartPayloadSchema.safeParse(part);
  if (parsed.success) {
    return parsed.data;
  }

  if (part.type === "reasoning") {
    return opencodePartPayloadSchema.parse({ time: { start: 1 }, ...part });
  }
  if (part.type === "patch") {
    return opencodePartPayloadSchema.parse({ hash: "test-patch", ...part });
  }
  if (part.type === "step-finish") {
    const tokens = asUnknownRecord(part.tokens);
    const cache = asUnknownRecord(tokens?.cache);
    return opencodePartPayloadSchema.parse({
      ...part,
      cost: part.cost ?? 0,
      reason: part.reason ?? "stop",
      tokens: {
        ...DEFAULT_TOKENS,
        ...tokens,
        cache: { ...DEFAULT_TOKENS.cache, ...cache },
      },
    });
  }
  if (part.type === "file") {
    const source = asUnknownRecord(part.source);
    if (source?.type === "file" && source.text === undefined) {
      const path = readStringProp(source, ["path"]) ?? "fixture";
      return opencodePartPayloadSchema.parse({
        ...part,
        source: { ...source, text: { end: path.length, start: 0, value: path } },
      });
    }
  }
  if (part.type !== "tool") {
    return opencodePartPayloadSchema.parse(part);
  }

  const state = asUnknownRecord(part.state);
  const status = readStringProp(state, ["status"]);
  const input = asUnknownRecord(state?.input) ?? {};
  switch (status) {
    case "pending":
      return opencodePartPayloadSchema.parse({
        ...part,
        state: { input, raw: readStringProp(state, ["raw"]) ?? "", status },
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
          output: serializeToolResult(readUnknownProp(state, "output")),
          status,
        },
      });
    case "error":
      return opencodePartPayloadSchema.parse({
        ...part,
        state: {
          time: { end: 2, start: 1 },
          ...state,
          error: serializeToolResult(readUnknownProp(state, "error")),
          input,
          status,
        },
      });
    default:
      return opencodePartPayloadSchema.parse(part);
  }
};

export const createOpencodeEventFixtures = (
  event: UnknownRecord,
  index: number,
): ParsedOpencodeGlobalEventPayload[] => {
  const id = readStringProp(event, ["id"]) ?? `test-event-${index}`;
  if (event.type === "sync") {
    return [parseOpencodeGlobalEventPayload({ ...event, id })];
  }

  const properties = asUnknownRecord(event.properties) ?? {};
  if (event.type === "message.updated") {
    const info = asUnknownRecord(properties.info) ?? {};
    const messageInfo = createOpencodeMessageInfoFixture(info);
    const sessionID = readStringProp(properties, ["sessionID"]) ?? messageInfo.sessionID;
    const messageEvent = parseOpencodeGlobalEventPayload({
      id,
      type: "message.updated",
      properties: { info: messageInfo, sessionID },
    });
    const suppliedParts = Array.isArray(properties.parts) ? properties.parts : [];
    const text = messageInfo.role === "user" ? readStringProp(info, ["text"]) : undefined;
    const hasSuppliedTextPart = suppliedParts.some(
      (part) => asUnknownRecord(part)?.type === "text",
    );
    const parts =
      text && !hasSuppliedTextPart
        ? [
            ...suppliedParts,
            {
              id: `${messageInfo.id}-text`,
              messageID: messageInfo.id,
              sessionID,
              text,
              type: "text",
            },
          ]
        : suppliedParts;
    return [
      messageEvent,
      ...parts.map((part, partIndex) => {
        const partRecord = asUnknownRecord(part) ?? {};
        const parsedPart = createOpencodePartFixture(partRecord);
        return parseOpencodeGlobalEventPayload({
          id: `${id}-part-${partIndex}`,
          type: "message.part.updated",
          properties: {
            part: parsedPart,
            sessionID: parsedPart.sessionID,
            time: messageInfo.time.created,
          },
        });
      }),
    ];
  }
  if (event.type === "message.part.updated") {
    const part = createOpencodePartFixture(asUnknownRecord(properties.part) ?? {});
    return [
      parseOpencodeGlobalEventPayload({
        id,
        type: "message.part.updated",
        properties: {
          part,
          sessionID: readStringProp(properties, ["sessionID"]) ?? part.sessionID,
          time: hasRuntimeType(properties.time, "number") ? properties.time : 1,
        },
      }),
    ];
  }

  return [
    parseOpencodeGlobalEventPayload({
      ...event,
      id,
      properties,
    }),
  ];
};
