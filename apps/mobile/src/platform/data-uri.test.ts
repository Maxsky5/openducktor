import { describe, expect, test } from "bun:test";
import { readDataUri } from "./data-uri";

describe("readDataUri", () => {
  test("reads base64 bytes with their media type", () => {
    expect(readDataUri("data:application/pdf;base64,JVBERi0=")).toEqual({
      mediaType: "application/pdf",
      base64: "JVBERi0=",
    });
  });

  test("keeps the base64 flag after other parameters", () => {
    expect(readDataUri("data:text/csv;charset=utf-8;base64,YSxi")).toEqual({
      mediaType: "text/csv",
      base64: "YSxi",
    });
  });

  test("decodes percent-encoded text and defaults to plain text", () => {
    expect(readDataUri("data:,Hello%2C%20World")).toEqual({
      mediaType: "text/plain",
      text: "Hello, World",
    });
  });

  test("rejects other URIs and broken percent encoding", () => {
    expect(readDataUri("https://example.com/file.pdf")).toBeNull();
    expect(readDataUri("data:text/plain,%E0%A4%A")).toBeNull();
  });
});
