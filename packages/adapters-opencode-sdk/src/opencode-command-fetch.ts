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
    type UndiciRequestInit = ConstructorParameters<typeof UndiciRequest>[1];

    const sourceRequest =
      input instanceof globalThis.Request && init === undefined
        ? input
        : new globalThis.Request(input, init);
    let request: InstanceType<typeof UndiciRequest>;
    if (sourceRequest instanceof UndiciRequest) {
      request = sourceRequest;
    } else {
      const body = sourceRequest.body
        ? new Uint8Array(await sourceRequest.arrayBuffer())
        : undefined;
      const requestInit: UndiciRequestInit = {
        cache: sourceRequest.cache,
        credentials: sourceRequest.credentials,
        headers: Array.from(sourceRequest.headers.entries()),
        integrity: sourceRequest.integrity,
        keepalive: sourceRequest.keepalive,
        method: sourceRequest.method,
        mode: sourceRequest.mode,
        redirect: sourceRequest.redirect,
        referrer: sourceRequest.referrer,
        referrerPolicy: sourceRequest.referrerPolicy,
        signal: sourceRequest.signal,
      };
      if (body) {
        requestInit.body = body;
        requestInit.duplex = "half";
      }
      request = new UndiciRequest(sourceRequest.url, requestInit);
    }
    const response = await fetch(request, { dispatcher });
    if (!(response instanceof globalThis.Response)) {
      throw new TypeError(
        "Undici returned a response that does not implement the host Response API.",
      );
    }
    return response;
  };
};

const fetchOpenCodeCommandRequest: CommandFetchRequest = async (input, init) => {
  if (globalThis.window !== undefined) {
    return globalThis.fetch(input, init);
  }
  nodeFetchPromise ??= loadNodeFetch();
  return (await nodeFetchPromise)(input, init);
};

export const fetchOpenCodeCommand: CommandFetchRequest = fetchOpenCodeCommandRequest;
