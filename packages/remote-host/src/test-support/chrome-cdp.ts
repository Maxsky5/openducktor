import WebSocket from "ws";

/** One Chrome DevTools Protocol connection for the opt-in browser tests. */
export type CdpMessage = {
  id?: number;
  method?: string;
  params?: { context?: { id: number; auxData?: { isDefault?: boolean; frameId: string } } };
  result?: unknown;
  error?: { message: string };
};

export type Target = { targetId: string; type: string; url: string };
export type FrameTree = { frame: { id: string; url: string }; childFrames?: FrameTree[] };
export type Evaluation = {
  result: { value: unknown };
  exceptionDetails?: { exception?: { description?: string }; text: string };
};
export type CdpParameters = Record<string, string | number | boolean | undefined>;

export const connectChromeDevTools = async (endpoint: string) => {
  const socket = new WebSocket(endpoint);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let sequence = 0;
  const pending = new Map<number, (message: CdpMessage) => void>();
  const listeners = new Set<(message: CdpMessage) => void>();
  const contexts = new Map<string, number>();
  socket.on("message", (data) => {
    const message: CdpMessage = JSON.parse(String(data));
    if (message.id !== undefined) pending.get(message.id)?.(message);
    if (message.method === "Runtime.executionContextCreated") {
      const context = message.params?.context;
      if (context?.auxData?.isDefault) contexts.set(context.auxData.frameId, context.id);
    }
    for (const listener of listeners) listener(message);
  });
  return {
    contexts,
    close: () => socket.close(),
    send: <T = unknown>(
      method: string,
      params: CdpParameters = {},
      sessionId?: string,
    ): Promise<T> => {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Chrome did not answer ${method}.`));
        }, 5_000);
        pending.set(id, (message) => {
          clearTimeout(timer);
          pending.delete(id);
          if (message.error) reject(new Error(message.error.message));
          else {
            // SAFETY: Each test call names the response type of its CDP method.
            resolve(message.result as T);
          }
        });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    next: (method: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(listener);
          reject(new Error(`Chrome did not emit ${method}.`));
        }, 5_000);
        const listener = (message: CdpMessage) => {
          if (message.method !== method) return;
          clearTimeout(timer);
          listeners.delete(listener);
          resolve();
        };
        listeners.add(listener);
      }),
  };
};

/**
 * Polls `check` until it returns true. Fails with `description` after the timeout, so a broken
 * wait names the condition instead of a bare attempt count.
 */
export const waitForCondition = async (
  check: () => Promise<boolean> | boolean,
  description: string,
  timeoutMs = 2_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome did not reach: ${description}.`);
};
