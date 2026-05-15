export type FilesystemDirectoryEntry = {
  name: string;
  path: string;
};

export type FilesystemStats = {
  isDirectory: boolean;
};

export type FilesystemPort = {
  homeDirectory(): string | null;
  canonicalize(path: string): Promise<string>;
  readDirectory(path: string): Promise<FilesystemDirectoryEntry[]>;
  stat(path: string): Promise<FilesystemStats>;
  exists(path: string): Promise<boolean>;
  join(...paths: string[]): string;
  parent(path: string): string | null;
};
