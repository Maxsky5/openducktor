import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseCommandInput } from "./command-inputs";

describe("parseCommandInput", () => {
  test("names each invalid field in readable text", () => {
    // A newer app can send a field that an older host does not know.
    const schema = z.strictObject({ runtime: z.string().nullable() });
    expect(() =>
      parseCommandInput(schema, { runtime: null, refresh: true }, "usage_report_read"),
    ).toThrow('usage_report_read input is invalid: ✖ Unrecognized key: "refresh"');
  });
});
