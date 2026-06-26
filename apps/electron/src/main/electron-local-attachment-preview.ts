import { pathToFileURL } from "node:url";
import { Cause, Chunk, Effect, Exit, Option } from "effect";
import {
  ElectronOperationError,
  ElectronValidationError,
  errorMessage,
} from "../effect/electron-errors";

export const ELECTRON_LOCAL_ATTACHMENT_PREVIEW_PROTOCOL = "openducktor-local-attachment";

const ELECTRON_LOCAL_ATTACHMENT_PREVIEW_HOST = "preview";

type ElectronPreviewProtocol = {
  handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void;
};

type ElectronPreviewSession = {
  protocol: ElectronPreviewProtocol;
};

type ElectronPreviewNet = {
  fetch(url: string): Promise<Response>;
};

type RegisterElectronLocalAttachmentPreviewProtocolInput = {
  net: ElectronPreviewNet;
  resolveLocalAttachmentPath: (filePath: string) => Promise<string>;
  session: ElectronPreviewSession;
};

export const readLocalAttachmentPreviewPath = (filePath: unknown): string => {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw new ElectronValidationError({
      operation: "electron.preview.read-path",
      message: "Local attachment preview path must be a non-empty string.",
      field: "path",
      details: { valueType: typeof filePath },
    });
  }

  return filePath.trim();
};

export const readLocalAttachmentPreviewPathEffect = (
  filePath: unknown,
): Effect.Effect<string, ElectronValidationError> =>
  Effect.try({
    try: () => readLocalAttachmentPreviewPath(filePath),
    catch: (cause) =>
      cause instanceof ElectronValidationError
        ? cause
        : new ElectronValidationError({
            operation: "electron.preview.read-path",
            message: errorMessage(cause),
            field: "path",
            cause,
          }),
  });

export const createElectronLocalAttachmentPreviewUrl = (filePath: string): string => {
  const previewPath = readLocalAttachmentPreviewPath(filePath);
  return `${ELECTRON_LOCAL_ATTACHMENT_PREVIEW_PROTOCOL}://${ELECTRON_LOCAL_ATTACHMENT_PREVIEW_HOST}/${encodeURIComponent(previewPath)}`;
};

export const readElectronLocalAttachmentPreviewRequestPath = (requestUrl: string): string => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(requestUrl);
  } catch {
    throw new ElectronValidationError({
      operation: "electron.preview.parse-url",
      message: "Invalid local attachment preview URL.",
      field: "url",
      details: { requestUrl },
    });
  }

  if (
    parsedUrl.protocol !== `${ELECTRON_LOCAL_ATTACHMENT_PREVIEW_PROTOCOL}:` ||
    parsedUrl.hostname !== ELECTRON_LOCAL_ATTACHMENT_PREVIEW_HOST
  ) {
    throw new ElectronValidationError({
      operation: "electron.preview.validate-url",
      message: "Invalid local attachment preview URL.",
      field: "url",
      details: { requestUrl },
    });
  }

  const encodedPath = parsedUrl.pathname.startsWith("/")
    ? parsedUrl.pathname.slice(1)
    : parsedUrl.pathname;
  if (encodedPath.length === 0) {
    throw new ElectronValidationError({
      operation: "electron.preview.validate-url-path",
      message: "Local attachment preview path must be a non-empty string.",
      field: "path",
      details: { requestUrl },
    });
  }

  try {
    return readLocalAttachmentPreviewPath(decodeURIComponent(encodedPath));
  } catch (error) {
    if (error instanceof URIError) {
      throw new ElectronValidationError({
        operation: "electron.preview.decode-url-path",
        message: "Invalid local attachment preview URL.",
        field: "url",
        cause: error,
        details: { requestUrl },
      });
    }
    throw error;
  }
};

export const readElectronLocalAttachmentPreviewRequestPathEffect = (
  requestUrl: string,
): Effect.Effect<string, ElectronValidationError> =>
  Effect.try({
    try: () => readElectronLocalAttachmentPreviewRequestPath(requestUrl),
    catch: (cause) =>
      cause instanceof ElectronValidationError
        ? cause
        : new ElectronValidationError({
            operation: "electron.preview.parse-url",
            message: errorMessage(cause),
            field: "url",
            cause,
            details: { requestUrl },
          }),
  });

const createLocalAttachmentPreviewErrorResponse = (error: unknown, status: 400 | 500): Response =>
  new Response(errorMessage(error) || "Local attachment preview failed.", {
    status,
  });

const resolveLocalAttachmentPathEffect = (
  resolveLocalAttachmentPath: (filePath: string) => Promise<string>,
  requestedPath: string,
): Effect.Effect<string, ElectronOperationError | ElectronValidationError> =>
  Effect.tryPromise({
    try: () => resolveLocalAttachmentPath(requestedPath),
    catch: (cause) =>
      cause instanceof ElectronValidationError || cause instanceof ElectronOperationError
        ? cause
        : new ElectronOperationError({
            operation: "electron.preview.resolve-path",
            message: errorMessage(cause),
            path: requestedPath,
            cause,
          }),
  }).pipe(
    Effect.flatMap((resolvedPath) =>
      readLocalAttachmentPreviewPathEffect(resolvedPath).pipe(
        Effect.mapError(
          (cause) =>
            new ElectronValidationError({
              operation: "electron.preview.validate-resolved-path",
              message: cause.message,
              field: "path",
              cause,
              details: { requestedPath },
            }),
        ),
      ),
    ),
  );

const fetchLocalAttachmentPreviewEffect = (
  net: ElectronPreviewNet,
  resolvedPath: string,
): Effect.Effect<Response, ElectronOperationError> =>
  Effect.tryPromise({
    try: () => net.fetch(pathToFileURL(resolvedPath).href),
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.preview.fetch-file",
        message: errorMessage(cause),
        path: resolvedPath,
        cause,
      }),
  });

export const registerElectronLocalAttachmentPreviewProtocol = ({
  net,
  resolveLocalAttachmentPath,
  session,
}: RegisterElectronLocalAttachmentPreviewProtocolInput): void => {
  session.protocol.handle(ELECTRON_LOCAL_ATTACHMENT_PREVIEW_PROTOCOL, async (request) => {
    const effect = Effect.gen(function* () {
      const requestedPath = yield* readElectronLocalAttachmentPreviewRequestPathEffect(request.url);
      const resolvedPath = yield* resolveLocalAttachmentPathEffect(
        resolveLocalAttachmentPath,
        requestedPath,
      );
      return yield* fetchLocalAttachmentPreviewEffect(net, resolvedPath);
    });

    const exit = await Effect.runPromiseExit(effect);
    if (Exit.isSuccess(exit)) {
      return exit.value;
    }

    const firstFailure = Chunk.head(Cause.failures(exit.cause));
    if (Option.isSome(firstFailure) && firstFailure.value instanceof ElectronValidationError) {
      return createLocalAttachmentPreviewErrorResponse(firstFailure.value, 400);
    }
    if (Option.isSome(firstFailure)) {
      return createLocalAttachmentPreviewErrorResponse(firstFailure.value, 500);
    }
    return createLocalAttachmentPreviewErrorResponse(
      new ElectronOperationError({
        operation: "electron.preview.handle-request",
        message: "Local attachment preview failed.",
        details: { defect: true },
      }),
      500,
    );
  });
};
