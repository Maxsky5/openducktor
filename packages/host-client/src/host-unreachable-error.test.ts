import { describe, expect, test } from "bun:test";
import {
  HOST_UNREACHABLE_MESSAGE,
  HostUnreachableError,
  isHostUnreachableError,
} from "./host-unreachable-error";

describe("HostUnreachableError", () => {
  test("keeps the cause of a request that did not reach the host", () => {
    const cause = new TypeError("Failed to fetch");
    const error = new HostUnreachableError(cause);
    expect(error.message).toBe(HOST_UNREACHABLE_MESSAGE);
    expect(error.cause).toBe(cause);
    expect(isHostUnreachableError(error)).toBe(true);
    expect(isHostUnreachableError(cause)).toBe(false);
  });
});
