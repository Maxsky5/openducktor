type CommandFetch = (
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1],
) => Promise<Response>;

let nodeFetchPromise: Promise<CommandFetch> | undefined;

const loadNodeFetch = async (): Promise<CommandFetch> => {
  const { Agent, fetch } = await import(/* @vite-ignore */ "undici");
  const dispatcher = new Agent({
    headersTimeout: 0,
    bodyTimeout: 0,
  });

  return async (input, init) => {
    const options: Parameters<typeof fetch>[1] = {
      ...(init as Parameters<typeof fetch>[1]),
      dispatcher,
    };
    return (await fetch(input as Parameters<typeof fetch>[0], options)) as unknown as Response;
  };
};

export const fetchOpenCodeCommand: CommandFetch = async (input, init) => {
  if (typeof window !== "undefined") {
    return globalThis.fetch(input, init);
  }
  nodeFetchPromise ??= loadNodeFetch();
  return (await nodeFetchPromise)(input, init);
};
