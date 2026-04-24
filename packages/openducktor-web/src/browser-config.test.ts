import { describe, expect, test } from "bun:test";
import { getBrowserAuthToken, getBrowserBackendUrl } from "./browser-config";

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
});
