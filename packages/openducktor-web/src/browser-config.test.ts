import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  configureBrowserRuntimeConfig,
  getBrowserAuthToken,
  getBrowserBackendUrl,
} from "./browser-config";
import { portOfHttpOrigin } from "./http-origin";

const originValidationCaseSchema = z.object({
  name: z.string(),
  input: z.string(),
  expected: z.string().optional(),
  errorIncludes: z.string().optional(),
});
type OriginValidationCase = z.output<typeof originValidationCaseSchema>;

const loadOriginValidationCases = async (): Promise<OriginValidationCase[]> =>
  z
    .array(originValidationCaseSchema)
    .parse(
      await Bun.file(new URL("./browser-origin-validation-cases.json", import.meta.url)).json(),
    );

describe("browser web host config", () => {
  beforeEach(() => {
    configureBrowserRuntimeConfig({});
  });

  test("falls back to the protocol default port", () => {
    expect(portOfHttpOrigin(new URL("http://127.0.0.1:14327"))).toBe("14327");
    expect(portOfHttpOrigin(new URL("http://127.0.0.1"))).toBe("80");
    expect(portOfHttpOrigin(new URL("https://machine.ts.net"))).toBe("443");
  });

  test("requires the launcher-injected backend URL", () => {
    const readBackendUrl = () => getBrowserBackendUrl({ VITE_ODT_BROWSER_AUTH_TOKEN: "token" });
    expect(readBackendUrl).toThrow("OpenDucktor web is missing the local web host URL");
    expect(readBackendUrl).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));
  });

  test("requires the launcher-injected auth token", () => {
    const readAuthToken = () =>
      getBrowserAuthToken({ VITE_ODT_BROWSER_BACKEND_URL: "http://127.0.0.1:14327" });
    expect(readAuthToken).toThrow("OpenDucktor web is missing the local web host app token");
    expect(readAuthToken).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));
  });

  test("matches the shared loopback origin validation cases", async () => {
    const cases = await loadOriginValidationCases();

    for (const testCase of cases) {
      const validate = () => getBrowserBackendUrl({ VITE_ODT_BROWSER_BACKEND_URL: testCase.input });

      if (testCase.expected) {
        expect(validate(), testCase.name).toBe(testCase.expected);
      } else {
        expect(validate, testCase.name).toThrow(testCase.errorIncludes);
        expect(validate, testCase.name).toThrow(
          expect.objectContaining({ _tag: "WebValidationError" }),
        );
      }
    }
  });

  test("uses the browser loopback hostname for backend requests", () => {
    expect(
      getBrowserBackendUrl(
        { VITE_ODT_BROWSER_BACKEND_URL: "http://127.255.255.255:14327" },
        "http://127.0.0.2:1420",
      ),
    ).toBe("http://127.0.0.2:14327");

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

  test.each(["runner.localhost", "nested.runner.localhost."])(
    "aligns loopback backend and browser hostnames for %s",
    (hostname) => {
      expect(
        getBrowserBackendUrl(
          { VITE_ODT_BROWSER_BACKEND_URL: `http://${hostname}:14327/api` },
          "http://localhost:1420",
        ),
      ).toBe("http://localhost:14327/api");
      expect(
        getBrowserBackendUrl(
          { VITE_ODT_BROWSER_BACKEND_URL: "http://127.0.0.1:14327/api" },
          `http://${hostname}:1420`,
        ),
      ).toBe(`http://${hostname}:14327/api`);
    },
  );

  test("keeps the injected backend hostname for opaque browser origins", () => {
    expect(
      getBrowserBackendUrl({ VITE_ODT_BROWSER_BACKEND_URL: "http://127.0.0.1:14327" }, "null"),
    ).toBe("http://127.0.0.1:14327");
  });

  test("uses a remote backend URL injected by the launcher runtime config", () => {
    configureBrowserRuntimeConfig({
      backendUrl: "http://100.64.0.1:14327",
      appToken: "token",
    });
    expect(getBrowserBackendUrl()).toBe("http://100.64.0.1:14327");
    expect(getBrowserAuthToken()).toBe("token");
  });

  test("keeps the backend path when aligning a loopback browser origin", () => {
    configureBrowserRuntimeConfig({
      backendUrl: "http://127.0.0.1:14327/api",
      appToken: "token",
    });
    expect(getBrowserBackendUrl(undefined, "http://localhost:1420")).toBe(
      "http://localhost:14327/api",
    );
  });
});
