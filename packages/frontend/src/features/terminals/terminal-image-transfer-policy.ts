const NATIVE_IMAGE_PASTE_INPUT = new Uint8Array([22]);
const MAX_DROPPED_IMAGE_COUNT = 8;
const MAX_DROPPED_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_DROPPED_IMAGE_TOTAL_BYTES = 40 * 1024 * 1024;

type TerminalImagePasteEvent = Pick<
  ClipboardEvent,
  "clipboardData" | "preventDefault" | "stopPropagation"
>;

type TerminalImagePasteHandlerInput = {
  enqueueInput: (operation: () => Uint8Array | Promise<Uint8Array>) => Promise<void>;
};

type PasteDroppedTerminalImagesInput = {
  files: readonly File[];
  stageFile: (file: File) => Promise<string>;
  prepareInput: (paths: readonly string[]) => Promise<string>;
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

export const pasteDroppedTerminalImages = async ({
  files,
  stageFile,
  prepareInput,
  paste,
}: PasteDroppedTerminalImagesInput): Promise<void> => {
  if (files.length === 0) return;
  if (files.length > MAX_DROPPED_IMAGE_COUNT) {
    throw new Error(`You can drop at most ${MAX_DROPPED_IMAGE_COUNT} images at once.`);
  }
  let totalBytes = 0;
  for (const file of files) {
    if (file.size > MAX_DROPPED_IMAGE_BYTES) {
      throw new Error(`Each dropped image must be 20 MiB or smaller: ${file.name}`);
    }
    totalBytes += file.size;
  }
  if (totalBytes > MAX_DROPPED_IMAGE_TOTAL_BYTES) {
    throw new Error("Dropped images must total 40 MiB or less.");
  }

  const paths = await Promise.all(files.map((file) => stageFile(file)));
  paste(await prepareInput(paths));
};
