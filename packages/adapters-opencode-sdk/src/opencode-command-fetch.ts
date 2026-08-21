import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";

type CommandFetch = NonNullable<
  NonNullable<Parameters<OpencodeClient["session"]["command"]>[1]>["fetch"]
>;

type CommandFetchRequest = (
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1],
) => Promise<Response>;

let nodeFetchPromise: Promise<CommandFetchRequest> | undefined;

const loadNodeFetch = async (): Promise<CommandFetchRequest> => {
  const { Agent, Request: UndiciRequest, fetch } = await import(/* @vite-ignore */ "undici");
  const dispatcher = new Agent({
    headersTimeout: 0,
    bodyTimeout: 0,
  });

  return async (input, init) => {
    type UndiciRequestInput = ConstructorParameters<typeof UndiciRequest>[0];
    type UndiciRequestInit = ConstructorParameters<typeof UndiciRequest>[1];

    let request: InstanceType<typeof UndiciRequest>;
    if (input instanceof globalThis.Request && !(input instanceof UndiciRequest)) {
      request = new UndiciRequest(input.url, input as unknown as UndiciRequestInit);
      if (init) {
        request = new UndiciRequest(request, init as UndiciRequestInit);
      }
    } else {
      request = new UndiciRequest(input as UndiciRequestInput, init as UndiciRequestInit);
    }
    return (await fetch(request, { dispatcher })) as unknown as Response;
  };
};

const fetchOpenCodeCommandRequest: CommandFetchRequest = async (input, init) => {
  if (typeof window !== "undefined") {
    return globalThis.fetch(input, init);
  }
  nodeFetchPromise ??= loadNodeFetch();
  return (await nodeFetchPromise)(input, init);
};

export const fetchOpenCodeCommand = Object.assign(fetchOpenCodeCommandRequest, {
  preconnect: () => {
    throw new Error("OpenCode command fetch does not support preconnect requests.");
  },
}) satisfies CommandFetch;
