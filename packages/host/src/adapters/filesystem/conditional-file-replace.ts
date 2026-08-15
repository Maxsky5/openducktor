import {
  FilesystemFileOperationError,
  type FilesystemFileSnapshot,
} from "../../ports/filesystem-port";

type ConditionalFileReplaceInput = {
  inputPath: string;
  expectedRevision: string;
  bytes: Uint8Array;
  maxCurrentBytes: number;
  verifyEntry(): Promise<void>;
  snapshot(): Promise<FilesystemFileSnapshot>;
  truncate(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  sync(): Promise<void>;
};

const validateExpectedSnapshot = (
  current: FilesystemFileSnapshot,
  input: Pick<ConditionalFileReplaceInput, "inputPath" | "expectedRevision" | "maxCurrentBytes">,
): void => {
  if (!current.isFile) {
    throw new FilesystemFileOperationError({
      code: "unavailable_file",
      operation: "replace",
      path: input.inputPath,
      message: "The selected path is not a file.",
    });
  }
  if (current.bytes.byteLength > input.maxCurrentBytes) {
    throw new FilesystemFileOperationError({
      code: "too_large",
      operation: "replace",
      path: input.inputPath,
      message: `The current file is larger than ${input.maxCurrentBytes} bytes.`,
    });
  }
  if (current.revision !== input.expectedRevision) {
    throw new FilesystemFileOperationError({
      code: "stale_revision",
      operation: "replace",
      path: input.inputPath,
      message: "The file changed after it was loaded.",
    });
  }
};

export const conditionallyReplaceOpenFile = async (
  input: ConditionalFileReplaceInput,
): Promise<FilesystemFileSnapshot> => {
  const verifyExpectedState = async (): Promise<void> => {
    await input.verifyEntry();
    validateExpectedSnapshot(await input.snapshot(), input);
  };

  await verifyExpectedState();
  await verifyExpectedState();
  // This is the final best-effort validation; the filesystem cannot bind it atomically to truncate.
  await input.truncate();
  await input.write(input.bytes);
  await input.sync();
  return input.snapshot();
};
