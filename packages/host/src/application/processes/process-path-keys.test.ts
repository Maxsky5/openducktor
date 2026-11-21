import { expect, test } from "bun:test";
import { keyContains, parentDirectory, pathKey } from "./process-path-keys";

test("keeps POSIX paths exact", () => {
  expect(pathKey("/work/task-1 ", "posix")).not.toBe(pathKey("/work/task-1", "posix"));
  expect(pathKey("/work/a\\b", "posix")).not.toBe(pathKey("/work/a/b", "posix"));
  expect(keyContains(pathKey("/work/task-1", "posix"), pathKey("/work/task-1 /src", "posix"))).toBe(
    false,
  );
  expect(keyContains("/work/task-1", "/work/task-1/src")).toBe(true);
  expect(keyContains("/", "/work")).toBe(true);
});

test("keeps letter case on Windows and ignores only separators and the drive letter case", () => {
  const parent = pathKey("C:\\Work\\Repo", "windows");
  expect(pathKey("c:/Work/Repo/", "windows")).toBe(parent);
  expect(pathKey("C:/Work/repo", "windows")).not.toBe(parent);
  expect(keyContains(parent, pathKey("C:\\Work\\Repo\\src", "windows"))).toBe(true);
  expect(keyContains(parent, pathKey("C:\\Work\\repo\\src", "windows"))).toBe(false);
  expect(pathKey("c:\\", "windows")).toBe("C:/");
});

test("walks up to the file system root", () => {
  expect(parentDirectory("/work/repo", "posix")).toBe("/work");
  expect(parentDirectory("/work", "posix")).toBe("/");
  expect(parentDirectory("/", "posix")).toBeNull();
  expect(parentDirectory("C:\\work\\repo", "windows")).toBe("C:\\work");
  expect(parentDirectory("C:\\work", "windows")).toBe("C:\\");
  expect(parentDirectory("C:\\", "windows")).toBeNull();
});
