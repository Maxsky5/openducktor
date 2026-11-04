import { describe, expect, test } from "bun:test";
import { ISSUE_TYPE_VALUES, issueTypeSchema } from "./issue-type-schemas";

describe("issue type schema", () => {
  test("accepts each fixed issue type and rejects any other value", () => {
    for (const issueType of ISSUE_TYPE_VALUES)
      expect(issueTypeSchema.parse(issueType)).toBe(issueType);
    for (const issueType of ["article", "Task", ""])
      expect(issueTypeSchema.safeParse(issueType).success).toBe(false);
  });
});
