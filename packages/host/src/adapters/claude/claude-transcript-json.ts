import { Buffer } from "node:buffer";
import { createHash, type Hash } from "node:crypto";
import { none, type Many } from "stream-chain/defs.js";
import * as StreamJson from "stream-json/core/parser.js";
import type { ParserOptions, Token } from "stream-json/core/parser.js";
import type { ClaudeProtocolObject, ClaudeProtocolValue } from "./claude-agent-sdk-ingress-schemas";
import {
  claudeTranscriptStringLimit,
  ClaudeTranscriptDepthError,
  isClaudeTranscriptSummaryTextPath,
  retainClaudeTranscriptRecord,
  retainParsedClaudeTranscriptRecord,
  selectClaudeTranscriptPath,
  selectClaudeTranscriptMetadataPath,
  selectClaudeTranscriptSummaryPath,
  type ClaudeTranscriptPath,
} from "./claude-transcript-retention";

export class ClaudeTranscriptJsonError extends Error {
  constructor(
    readonly reason: "malformed" | "incomplete" | "record" | "changed",
    cause?: unknown,
  ) {
    let message: string;
    switch (reason) {
      case "changed":
        message = "The Claude transcript changed during the read. Load the session again.";
        break;
      case "incomplete":
        message =
          "The Claude transcript ends inside a JSON record. Wait for Claude to finish writing it.";
        break;
      default:
        message =
          "The Claude transcript contains an invalid JSON record. Check the source transcript on the host.";
    }
    super(message, { cause });
    this.name = "ClaudeTranscriptJsonError";
  }
}

const utf8Prefix = (text: string, bytes: number): string => {
  const buffer = Buffer.from(text);
  if (buffer.length <= bytes) return text;
  let end = bytes;
  while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end--;
  return buffer.toString("utf8", 0, end);
};

const createStringValue = (limit: number | undefined) => {
  let value = "";
  let originalBytes = 0;
  let retainedBytes = 0;
  let highSurrogate = "";
  const append = (chunk: string) => {
    if (limit === undefined) {
      value += chunk;
      return;
    }
    let text = highSurrogate + chunk;
    highSurrogate = "";
    const last = text.charCodeAt(text.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) {
      highSurrogate = text.at(-1)!;
      text = text.slice(0, -1);
    }
    originalBytes += Buffer.byteLength(text);
    if (retainedBytes < limit) {
      const prefix = utf8Prefix(text, limit - retainedBytes);
      value += prefix;
      retainedBytes += Buffer.byteLength(prefix);
    }
  };
  return {
    append,
    finish: () => {
      if (highSurrogate) {
        originalBytes += Buffer.byteLength(highSurrogate);
        if (limit === undefined || retainedBytes + 3 <= limit) value += highSurrogate;
      }
      if (limit === undefined || originalBytes <= limit) {
        // Detach short values from the much larger source chunks retained by substring views.
        return value.length < 8192 ? Buffer.from(value, "utf16le").toString("utf16le") : value;
      }
      const marker = `\n[Claude tool output truncated; original size: ${originalBytes} UTF-8 bytes]`;
      return utf8Prefix(value, Math.max(0, limit - Buffer.byteLength(marker))) + marker;
    },
  };
};

const createSummaryTextValue = () => {
  let hasText = false;
  return {
    append: (chunk: string) => {
      hasText ||= chunk.trim().length > 0;
    },
    finish: () => (hasText ? "x" : ""),
  };
};

type Frame = { path: ClaudeTranscriptPath } & (
  | { kind: "object"; id: number; key: string | null; value: ClaudeProtocolObject | undefined }
  | { kind: "array"; key: number; value: ClaudeProtocolValue[] | undefined }
);

type TypeHints = Map<number, ClaudeProtocolValue | undefined>;
const needsTypeHint = (path: ClaudeTranscriptPath): boolean =>
  path[0] === "toolUseResult" ||
  path[0] === "tool_use_result" ||
  (path[0] === "message" &&
    path[1] === "content" &&
    Number.isInteger(path[2]) &&
    !["input", "tool_input", "arguments"].includes(String(path[3])));

const createJsonLexicalCheck = () => {
  let state: "outside" | "string" | "escape" | "unicode" | "literal" | "literalEnd" = "outside";
  let expected = "";
  let position = 0;
  let depth = 0;
  // eslint-disable-next-line no-control-regex -- JSON strings forbid these unescaped control bytes.
  const stringSpecial = /["\\\u0000-\u001f]/gu;
  const outside = (character: string) => {
    if (character === '"') state = "string";
    else if (character === "t" || character === "f" || character === "n") {
      expected = character === "t" ? "true" : character === "f" ? "false" : "null";
      position = 1;
      state = "literal";
    } else if (character === "{" || character === "[") {
      if (++depth > 256) throw new ClaudeTranscriptJsonError("record");
    } else if (character === "}" || character === "]") depth--;
  };
  return (chunk: string) => {
    for (let index = 0; index < chunk.length; index++) {
      if (state === "string") {
        stringSpecial.lastIndex = index;
        const match = stringSpecial.exec(chunk);
        if (!match) return;
        index = match.index;
      }
      const character = chunk[index]!;
      switch (state) {
        case "outside":
          outside(character);
          break;
        case "string":
          if (character === '"') state = "outside";
          else if (character === "\\") state = "escape";
          else if (character.charCodeAt(0) < 0x20) throw new ClaudeTranscriptJsonError("malformed");
          break;
        case "escape":
          if (character === "u") {
            position = 0;
            state = "unicode";
          } else if ('"\\/bfnrt'.includes(character)) state = "string";
          else throw new ClaudeTranscriptJsonError("malformed");
          break;
        case "unicode":
          if (!/[\da-fA-F]/u.test(character)) throw new ClaudeTranscriptJsonError("malformed");
          if (++position === 4) state = "string";
          break;
        case "literal":
          if (character !== expected[position]) throw new ClaudeTranscriptJsonError("malformed");
          if (++position === expected.length) state = "literalEnd";
          break;
        case "literalEnd":
          if (!",}] \t\r\n".includes(character)) throw new ClaudeTranscriptJsonError("malformed");
          state = "outside";
          outside(character);
          break;
      }
    }
  };
};

const createStreamingClaudeTranscriptJsonReader = (
  options: { metadataOnly?: boolean; summaryOnly?: boolean } = {},
  hints: { collect?: TypeHints; known?: ReadonlyMap<number, ClaudeProtocolValue | undefined> } = {},
) => {
  // SAFETY: stream-json 3.6.0 exports this synchronous tokenizer; its declaration only lists the async wrapper.
  const { jsonParser } = StreamJson as typeof StreamJson & {
    jsonParser: (
      options: ParserOptions,
    ) => (input: string | typeof none) => Many<Token> | typeof none;
  };
  const tokenize = jsonParser({ packValues: false });
  const checkLexical = createJsonLexicalCheck();
  const selectPath = options.metadataOnly
    ? selectClaudeTranscriptMetadataPath
    : options.summaryOnly
      ? selectClaudeTranscriptSummaryPath
      : selectClaudeTranscriptPath;
  const stack: Frame[] = [];
  let root: ClaudeProtocolObject = {};
  let complete = false;
  let hasInput = false;
  let key: string | null = null;
  let scalar: ReturnType<typeof createStringValue> | undefined;
  let scalarSelected = false;
  let scalarTypeId: number | undefined;
  let finished = false;
  let objectId = 0;

  const nextValue = () => {
    const parent = stack.at(-1);
    const path = parent ? [...parent.path, parent.key!] : [];
    return {
      path,
      selected: hints.collect
        ? path.length === 0 || (path.at(-1) === "type" && needsTypeHint(path.slice(0, -1)))
        : (parent === undefined || parent.value !== undefined) && selectPath(path),
      parent: parent?.kind === "object" ? parent.value : undefined,
      parentId: parent?.kind === "object" ? parent.id : undefined,
    };
  };
  const captureType = (path: ClaudeTranscriptPath, value: ClaudeProtocolValue | undefined) => {
    const parent = stack.at(-1);
    if (
      hints.collect &&
      parent?.kind === "object" &&
      path.at(-1) === "type" &&
      needsTypeHint(parent.path)
    )
      hints.collect.set(parent.id, value);
  };
  const storeValue = (value: ClaudeProtocolValue | undefined, selected: boolean) => {
    const parent = stack.at(-1);
    if (!parent) {
      complete = true;
      return;
    }
    if (selected && value !== undefined && parent.value !== undefined) {
      if (parent.kind === "array") {
        parent.value.push(value);
      } else {
        Object.defineProperty(parent.value, parent.key!, {
          value,
          configurable: true,
          enumerable: true,
          writable: true,
        });
      }
    }
    if (parent.kind === "array") parent.key++;
  };
  const consumeToken = (token: Token) => {
    if (stack.length === 0 && !complete && token.name !== "startObject") {
      throw new ClaudeTranscriptJsonError("record");
    }
    switch (token.name) {
      case "startKey":
        key = "";
        break;
      case "endKey": {
        const parent = stack.at(-1)!;
        if (parent.kind === "object") parent.key = key;
        key = null;
        break;
      }
      case "startObject":
      case "startArray": {
        if (stack.length >= 256) throw new ClaudeTranscriptJsonError("record");
        const { path, selected } = nextValue();
        captureType(path, undefined);
        const retainContainer = selected && (!hints.collect || path.length === 0);
        if (token.name === "startArray") {
          stack.push({ path, kind: "array", key: 0, value: retainContainer ? [] : undefined });
        } else {
          const id = objectId++;
          if (hints.collect && needsTypeHint(path)) hints.collect.set(id, undefined);
          const value = retainContainer ? {} : undefined;
          if (stack.length === 0) root = value!;
          stack.push({ path, kind: "object", id, key: null, value });
        }
        break;
      }
      case "endObject":
      case "endArray": {
        const frame = stack.pop()!;
        storeValue(frame.value, frame.value !== undefined);
        break;
      }
      case "startString":
      case "startNumber": {
        const { path, selected, parent, parentId } = nextValue();
        scalarTypeId =
          hints.collect && path.at(-1) === "type" && needsTypeHint(path.slice(0, -1))
            ? parentId
            : undefined;
        const limitParent =
          parentId !== undefined && hints.known?.has(parentId)
            ? { type: hints.known.get(parentId) ?? null }
            : parent;
        scalarSelected = selected;
        scalar = undefined;
        if (!selected) break;
        if (
          options.summaryOnly &&
          token.name === "startString" &&
          isClaudeTranscriptSummaryTextPath(path)
        ) {
          scalar = createSummaryTextValue();
          break;
        }
        let limit: number | undefined;
        if (token.name === "startString") {
          limit = hints.collect ? 64 : claudeTranscriptStringLimit(path, limitParent);
        }
        scalar = createStringValue(limit);
        break;
      }
      case "stringChunk":
        if (key !== null) key += token.value;
        else scalar?.append(token.value);
        break;
      case "numberChunk":
        scalar?.append(token.value);
        break;
      case "endString":
      case "endNumber": {
        const value = scalar?.finish();
        if (scalarTypeId !== undefined) hints.collect?.set(scalarTypeId, value);
        storeValue(
          token.name === "endNumber" && scalarSelected ? Number(value) : value,
          scalarSelected,
        );
        scalar = undefined;
        scalarTypeId = undefined;
        break;
      }
      case "nullValue":
      case "trueValue":
      case "falseValue": {
        const { path, selected } = nextValue();
        captureType(path, token.value);
        storeValue(token.value, selected);
        break;
      }
    }
  };
  const consume = (chunk: string | typeof none) => {
    let tokens;
    try {
      tokens = tokenize(chunk);
    } catch (cause) {
      throw new ClaudeTranscriptJsonError(
        chunk === none && !complete ? "incomplete" : "malformed",
        cause,
      );
    }
    if (tokens !== none) for (const token of tokens.values) consumeToken(token);
  };
  return {
    write: (chunk: string): void => {
      if (finished) throw new Error("Cannot write to a finished Claude transcript JSON reader.");
      hasInput ||= /[^ \t\r\n]/u.test(chunk);
      checkLexical(chunk);
      // Bound the tokenizer's full-string fast path as well as its token batch.
      for (let offset = 0; offset < chunk.length; offset += 8192)
        consume(chunk.slice(offset, offset + 8192));
    },
    finish: (): ClaudeProtocolObject | null => {
      if (finished) throw new Error("The Claude transcript JSON reader is already finished.");
      finished = true;
      if (!hasInput) return null;
      consume(none);
      if (!complete || stack.length !== 0) throw new ClaudeTranscriptJsonError("incomplete");
      return options.metadataOnly || options.summaryOnly
        ? root
        : retainClaudeTranscriptRecord(root);
    },
  };
};

const CLAUDE_TRANSCRIPT_FAST_RECORD_BYTES = 2 * 1024 * 1024;

export type ClaudeTranscriptJsonReader = {
  write(chunk: string): void;
  finish():
    | { kind: "complete"; record: ClaudeProtocolObject | null }
    | { kind: "replay"; reader: ClaudeTranscriptJsonReader };
};

const createClaudeTranscriptJsonPass = (
  options: { metadataOnly?: boolean; summaryOnly?: boolean } = {},
  replay?: { types: TypeHints; digest: string },
): ClaudeTranscriptJsonReader => {
  let chunks: string[] = [];
  let bytes = 0;
  let types: TypeHints | undefined;
  let digest: Hash | undefined = replay ? createHash("sha256") : undefined;
  let streaming = replay
    ? createStreamingClaudeTranscriptJsonReader(options, { known: replay.types })
    : undefined;
  let finished = false;
  return {
    write: (chunk: string): void => {
      if (finished) throw new Error("Cannot write to a finished Claude transcript JSON reader.");
      if (chunk.length === 0) return;
      if (streaming) {
        digest!.update(chunk, "utf16le");
        streaming.write(chunk);
        return;
      }
      bytes += Buffer.byteLength(chunk);
      if (bytes <= CLAUDE_TRANSCRIPT_FAST_RECORD_BYTES) {
        chunks.push(chunk);
        return;
      }
      types = new Map();
      streaming = createStreamingClaudeTranscriptJsonReader(options, { collect: types });
      digest = createHash("sha256");
      for (const buffered of chunks) {
        digest.update(buffered, "utf16le");
        streaming.write(buffered);
      }
      chunks = [];
      digest.update(chunk, "utf16le");
      streaming.write(chunk);
    },
    finish: () => {
      if (finished) throw new Error("The Claude transcript JSON reader is already finished.");
      finished = true;
      if (streaming) {
        const checksum = digest!.digest("hex");
        if (replay && checksum !== replay.digest) throw new ClaudeTranscriptJsonError("changed");
        const record = streaming.finish();
        return types
          ? {
              kind: "replay",
              reader: createClaudeTranscriptJsonPass(options, { types, digest: checksum }),
            }
          : { kind: "complete", record };
      }
      const source = chunks.length === 1 ? chunks[0]! : chunks.join("");
      chunks = [];
      if (!/[^ \t\r\n]/u.test(source)) return { kind: "complete", record: null };
      let value: ClaudeProtocolValue;
      try {
        // SAFETY: JSON.parse returns only JSON values because this call has no reviver.
        value = JSON.parse(source) as ClaudeProtocolValue;
      } catch (cause) {
        // Use the tokenizer's error classification without accepting another parse result.
        const classifier = createStreamingClaudeTranscriptJsonReader(options);
        classifier.write(source);
        classifier.finish();
        throw new ClaudeTranscriptJsonError("malformed", cause);
      }
      // eslint-disable-next-line anti-slop/no-runtime-typeof -- The parsed JSON root must be an object record.
      if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new ClaudeTranscriptJsonError("record");
      try {
        return { kind: "complete", record: retainParsedClaudeTranscriptRecord(value, options) };
      } catch (cause) {
        if (cause instanceof ClaudeTranscriptDepthError)
          throw new ClaudeTranscriptJsonError("record", cause);
        throw cause;
      }
    },
  };
};

export const createClaudeTranscriptJsonReader = (
  options: { metadataOnly?: boolean; summaryOnly?: boolean } = {},
): ClaudeTranscriptJsonReader => createClaudeTranscriptJsonPass(options);
