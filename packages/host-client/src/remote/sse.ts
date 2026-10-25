import { abortableBody, remoteError } from "./transport";

export type SseFrame = { event: string; data: string; id?: string };

export type ReadSseOptions = {
  /** Runs when the stream sends its ready comment. */
  onReady?: (() => void) | undefined;
  /** Runs for each chunk of bytes, heartbeats included. */
  onBytes?: (() => void) | undefined;
  /**
   * A stream that sends no bytes for this time fails: the host writes heartbeats, so a silent
   * stream went down on the way without closing. Null keeps a quiet stream.
   */
  silenceLimitMs?: number | null | undefined;
};

/** Incremental UTF-8 and SSE line parsing works without DOM or EventSource. */
export async function* readSse(
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
  { onReady, onBytes, silenceLimitMs = null }: ReadSseOptions = {},
): AsyncGenerator<SseFrame> {
  const silence = new AbortController();
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  const watch = () => {
    if (silenceLimitMs === null) return;
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(
      () =>
        silence.abort(
          remoteError(
            "transport_failure",
            "The host stream went silent.",
            "Reconnect to the selected host.",
          ),
        ),
      silenceLimitMs,
    );
  };
  watch();
  try {
    yield* readFrames(body, AbortSignal.any([signal, silence.signal]), onReady, () => {
      watch();
      onBytes?.();
    });
  } finally {
    clearTimeout(silenceTimer);
  }
  signal.throwIfAborted();
}

async function* readFrames(
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
  onReady: (() => void) | undefined,
  onBytes: () => void,
): AsyncGenerator<SseFrame> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  let id: string | undefined;
  const line = (value: string): SseFrame | null => {
    if (!value) {
      const frame: SseFrame | null = data.length ? { event, data: data.join("\n") } : null;
      if (frame && id !== undefined) frame.id = id;
      event = "message";
      data = [];
      id = undefined;
      return frame;
    }
    if (value.startsWith(":")) {
      if (value === ": openducktor-ready") onReady?.();
      return null;
    }
    const split = value.indexOf(":");
    const field = split < 0 ? value : value.slice(0, split);
    let valuePart = split < 0 ? "" : value.slice(split + 1);
    if (valuePart.startsWith(" ")) valuePart = valuePart.slice(1);
    if (field === "event") event = valuePart;
    else if (field === "data") data.push(valuePart);
    else if (field === "id" && !valuePart.includes("\0")) id = valuePart;
    return null;
  };
  // Lines are read from an offset, and the buffer is cut once per chunk. Hermes copies each
  // substring, so a cut for each line would copy a large chunk once for each of its lines.
  const lineEnd = /[\r\n]/g;
  for await (const bytes of abortableBody(body, signal)) {
    signal.throwIfAborted();
    onBytes();
    try {
      buffer += decoder.decode(bytes, { stream: true });
    } catch {
      throw remoteError(
        "invalid_protocol",
        "The host stream contains invalid UTF-8.",
        "Update the host or correct proxy stream routing, then retry.",
      );
    }
    if (buffer.length + data.reduce((total, part) => total + part.length, 0) > 4 * 1024 * 1024)
      throw remoteError(
        "consumer_overflow",
        "Remote event exceeds the size limit.",
        "Reconnect or update the host.",
      );
    let start = 0;
    while (true) {
      lineEnd.lastIndex = start;
      const index = lineEnd.exec(buffer)?.index ?? -1;
      // A final "\r" can be the first half of "\r\n", so it waits for the next chunk.
      if (index < 0 || (buffer[index] === "\r" && index === buffer.length - 1)) break;
      const value = buffer.slice(start, index);
      start = index + (buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1);
      const frame = line(value);
      if (frame) yield frame;
    }
    buffer = buffer.slice(start);
  }
  try {
    decoder.decode();
  } catch {
    throw remoteError(
      "invalid_protocol",
      "The host stream ended within a UTF-8 character.",
      "Correct the host or proxy stream, then retry.",
    );
  }
  signal.throwIfAborted();
}
