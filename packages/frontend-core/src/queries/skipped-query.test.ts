import { describe, expect, test } from "bun:test";
import { skipToken } from "@tanstack/react-query";
import { skippedQueryOptions } from "./skipped-query";

describe("skippedQueryOptions", () => {
  test("keeps disabled query mechanics in one place", () => {
    const queryKey = ["runtime-catalog", "skipped"] as const;

    const options = skippedQueryOptions<string[]>({
      queryKey,
      staleTime: 123,
      refetchOnWindowFocus: false,
    });

    expect(Array.from(options.queryKey)).toEqual(Array.from(queryKey));
    expect(options.queryFn).toBe(skipToken);
    expect(options.staleTime).toBe(123);
    expect(options.refetchOnWindowFocus).toBe(false);
  });
});
