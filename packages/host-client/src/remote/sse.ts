import { abortableBody, remoteError } from "./transport";

export type SseFrame = { event: string; data: string; id?: string };
/** Incremental UTF-8 and SSE line parsing works without DOM or EventSource. */
export async function* readSse(
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
  onReady?: () => void,
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
  for await (const bytes of abortableBody(body, signal)) {
    signal.throwIfAborted();
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
    while (true) {
      const index = buffer.search(/[\r\n]/);
      if (index < 0 || (buffer[index] === "\r" && index === buffer.length - 1)) break;
      const value = buffer.slice(0, index);
      const count = buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
      buffer = buffer.slice(index + count);
      const frame = line(value);
      if (frame) yield frame;
    }
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
