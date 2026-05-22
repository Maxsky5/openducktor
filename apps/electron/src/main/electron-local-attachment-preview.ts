import { pathToFileURL } from "node:url";

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
    throw new Error("Local attachment preview path must be a non-empty string.");
  }

  return filePath.trim();
};

export const createElectronLocalAttachmentPreviewUrl = (filePath: string): string => {
  const previewPath = readLocalAttachmentPreviewPath(filePath);
  return `${ELECTRON_LOCAL_ATTACHMENT_PREVIEW_PROTOCOL}://${ELECTRON_LOCAL_ATTACHMENT_PREVIEW_HOST}/${encodeURIComponent(previewPath)}`;
};

export const readElectronLocalAttachmentPreviewRequestPath = (requestUrl: string): string => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(requestUrl);
  } catch {
    throw new Error("Invalid local attachment preview URL.");
  }

  if (
    parsedUrl.protocol !== `${ELECTRON_LOCAL_ATTACHMENT_PREVIEW_PROTOCOL}:` ||
    parsedUrl.hostname !== ELECTRON_LOCAL_ATTACHMENT_PREVIEW_HOST
  ) {
    throw new Error("Invalid local attachment preview URL.");
  }

  const encodedPath = parsedUrl.pathname.startsWith("/")
    ? parsedUrl.pathname.slice(1)
    : parsedUrl.pathname;
  if (encodedPath.length === 0) {
    throw new Error("Local attachment preview path must be a non-empty string.");
  }

  try {
    return readLocalAttachmentPreviewPath(decodeURIComponent(encodedPath));
  } catch (error) {
    if (error instanceof URIError) {
      throw new Error("Invalid local attachment preview URL.");
    }
    throw error;
  }
};

export const registerElectronLocalAttachmentPreviewProtocol = ({
  net,
  resolveLocalAttachmentPath,
  session,
}: RegisterElectronLocalAttachmentPreviewProtocolInput): void => {
  session.protocol.handle(ELECTRON_LOCAL_ATTACHMENT_PREVIEW_PROTOCOL, async (request) => {
    const requestedPath = readElectronLocalAttachmentPreviewRequestPath(request.url);
    const resolvedPath = readLocalAttachmentPreviewPath(
      await resolveLocalAttachmentPath(requestedPath),
    );

    return net.fetch(pathToFileURL(resolvedPath).href);
  });
};
