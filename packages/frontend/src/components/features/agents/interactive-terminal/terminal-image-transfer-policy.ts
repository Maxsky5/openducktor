import type { AppPlatform } from "@openducktor/contracts";

const NATIVE_IMAGE_PASTE_INPUT = new Uint8Array([22]);

type TerminalImagePasteEvent = Pick<
  ClipboardEvent,
  "clipboardData" | "preventDefault" | "stopPropagation"
>;

type TerminalImagePasteHandlerInput = {
  enqueueInput: (operation: () => Uint8Array | Promise<Uint8Array>) => Promise<void>;
};

type PasteDroppedTerminalImagesInput = {
  files: readonly File[];
  platform: AppPlatform;
  stageFile: (file: File) => Promise<string>;
  paste: (value: string) => void;
};

const isImageMimeType = (type: string): boolean => type.toLowerCase().startsWith("image/");

export const containsTransferredImage = (transfer: DataTransfer | null): boolean => {
  if (!transfer) return false;
  return (
    Array.from(transfer.items).some((item) => item.kind === "file" && isImageMimeType(item.type)) ||
    Array.from(transfer.files).some((file) => isImageMimeType(file.type))
  );
};

export const extractTransferredImageFiles = (transfer: DataTransfer | null): File[] =>
  transfer ? Array.from(transfer.files).filter((file) => isImageMimeType(file.type)) : [];

export const createTerminalImagePasteHandler = ({
  enqueueInput,
}: TerminalImagePasteHandlerInput) => {
  return (event: TerminalImagePasteEvent): void => {
    if (!containsTransferredImage(event.clipboardData)) return;
    event.preventDefault();
    event.stopPropagation();
    void enqueueInput(() => NATIVE_IMAGE_PASTE_INPUT.slice());
  };
};

const quotePosixPath = (path: string): string => `'${path.replaceAll("'", "'\\''")}'`;

const quoteWindowsPath = (path: string): string => `"${path.replaceAll('"', '""')}"`;

export const formatTerminalDroppedImagePaths = (
  paths: readonly string[],
  platform: AppPlatform,
): string => {
  const quotePath = platform === "win32" ? quoteWindowsPath : quotePosixPath;
  return paths.map(quotePath).join(" ");
};

export const pasteDroppedTerminalImages = async ({
  files,
  platform,
  stageFile,
  paste,
}: PasteDroppedTerminalImagesInput): Promise<void> => {
  if (files.length === 0) return;
  const paths = await Promise.all(files.map((file) => stageFile(file)));
  paste(formatTerminalDroppedImagePaths(paths, platform));
};
