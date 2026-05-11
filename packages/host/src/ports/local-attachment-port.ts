export type LocalAttachmentEntry = {
  path: string;
  fileName: string;
};

export type LocalAttachmentPort = {
  stageDirectory(): string;
  joinPath(...segments: string[]): string;
  relativePath(from: string, to: string): string;
  isAbsolutePath(path: string): boolean;
  canonicalizePath(path: string): Promise<string>;
  ensureDirectory(path: string): Promise<void>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  readDirectory(path: string): Promise<LocalAttachmentEntry[]>;
  modifiedTimeMs(path: string): Promise<number>;
  exists(path: string): Promise<boolean>;
};
