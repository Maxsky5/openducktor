import type { HostCommandName } from "@openducktor/host";

export const ELECTRON_HOST_INVOKE_CHANNEL = "openducktor:host-invoke";
export const ELECTRON_HOST_EVENT_CHANNEL = "openducktor:host-event";
export const ELECTRON_OPEN_EXTERNAL_URL_CHANNEL = "openducktor:open-external-url";
export const ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL = "openducktor:local-attachment-preview-src";

export type ElectronHostInvokeRequest = {
  command: HostCommandName;
  args?: Record<string, unknown>;
};

export type ElectronHostEventEnvelope = {
  channel: string;
  payload: unknown;
};

export type OpenDucktorElectronApi = {
  invoke(command: HostCommandName, args?: Record<string, unknown>): Promise<unknown>;
  subscribe(channel: string, listener: (payload: unknown) => void): () => void;
  openExternalUrl(url: string): Promise<void>;
  resolveLocalAttachmentPreviewSrc(path: string): Promise<string>;
};
