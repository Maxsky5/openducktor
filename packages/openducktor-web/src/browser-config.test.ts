import { beforeEach, describe, expect, test } from "bun:test";
import {
  getBrowserAuthToken,
  getBrowserBackendUrl,
  resetBrowserRuntimeConfig,
} from "./browser-config";

type OriginValidationCase = {
  name: string;
  input: string;
  expected?: string;
  errorIncludes?: string;
};

const loadOriginValidationCases = async (): Promise<OriginValidationCase[]> =>
  (await Bun.file(
    new URL("./browser-origin-validation-cases.json", import.meta.url),
  ).json()) as OriginValidationCase[];

describe("browser web host config", () => {
  beforeEach(() => {
    resetBrowserRuntimeConfig();
  });

  test("requires the launcher-injected backend URL", () => {
    expect(() => getBrowserBackendUrl({ VITE_ODT_BROWSER_AUTH_TOKEN: "token" })).toThrow(
      "OpenDucktor web is missing the local web host URL",
    );
  });

  test("requires the launcher-injected auth token", () => {
    expect(() =>
      getBrowserAuthToken({ VITE_ODT_BROWSER_BACKEND_URL: "http://127.0.0.1:14327" }),
    ).toThrow("OpenDucktor web is missing the local web host app token");
  });

  test("matches the shared loopback origin validation cases", async () => {
    const cases = await loadOriginValidationCases();

    for (const testCase of cases) {
      const validate = () => getBrowserBackendUrl({ VITE_ODT_BROWSER_BACKEND_URL: testCase.input });

      if (testCase.expected) {
        expect(validate(), testCase.name).toBe(testCase.expected);
      } else {
        expect(validate, testCase.name).toThrow(testCase.errorIncludes);
      }
    }
  });

  test("uses the browser loopback hostname for backend requests", () => {
    expect(
      getBrowserBackendUrl(
        { VITE_ODT_BROWSER_BACKEND_URL: "http://127.0.0.1:14327" },
        "http://localhost:1420",
      ),
    ).toBe("http://localhost:14327");

    expect(
      getBrowserBackendUrl(
        { VITE_ODT_BROWSER_BACKEND_URL: "http://127.0.0.1:14327" },
        "http://[::1]:1420",
      ),
    ).toBe("http://[::1]:14327");
  });

  test("keeps the injected backend hostname when the page origin is not loopback", () => {
    expect(
      getBrowserBackendUrl(
        { VITE_ODT_BROWSER_BACKEND_URL: "http://127.0.0.1:14327" },
        "https://example.com",
      ),
    ).toBe("http://127.0.0.1:14327");
  });
});
