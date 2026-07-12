type ReadableFileHandle = {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
};

export const readBoundedFileBytes = async (
  file: ReadableFileHandle,
  maxBytes: number,
): Promise<Uint8Array> => {
  const bytes = new Uint8Array(maxBytes);
  let offset = 0;

  while (offset < maxBytes) {
    const { bytesRead } = await file.read(bytes, offset, maxBytes - offset, offset);
    if (bytesRead === 0) {
      break;
    }
    offset += bytesRead;
  }

  return bytes.subarray(0, offset);
};
