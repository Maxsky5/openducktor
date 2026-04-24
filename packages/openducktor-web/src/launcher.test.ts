import { describe, expect, test } from "bun:test";
import { __launcherTestInternals } from "./launcher";

const createHostProcess = (exited: Promise<number>): Bun.Subprocess => {
  return { exited } as Bun.Subprocess;
};

describe("launcher internals", () => {
  test("waits for the fake host health endpoint before starting the web shell", async () => {
    const requests: string[] = [];
    let attempts = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      requests.push(String(url));
      attempts += 1;
      return new Response(null, { status: attempts === 1 ? 503 : 200 });
    }) as typeof fetch;

    await __launcherTestInternals.waitForBackend(
      "http://127.0.0.1:14327",
      1_000,
      createHostProcess(new Promise<number>(() => {})),
      { fetch: fetchImpl, sleep: async () => {} },
    );

    expect(requests).toEqual(["http://127.0.0.1:14327/health", "http://127.0.0.1:14327/health"]);
  });

  test("fails fast when the fake host exits before readiness", async () => {
    const exited = Promise.resolve(9);
    await exited;

    await expect(
      __launcherTestInternals.waitForBackend(
        "http://127.0.0.1:14327",
        1_000,
        createHostProcess(exited),
        {
          fetch: (async () => new Response(null, { status: 503 })) as unknown as typeof fetch,
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow("OpenDucktor web host exited before startup completed with code 9.");
  });

  test("sends the launcher control token when shutting down the fake host", async () => {
    const requests: Array<{ url: string; token: string | null; method: string | undefined }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(url),
        method: init?.method,
        token: headers.get("x-openducktor-control-token"),
      });
      return new Response(null, { status: 202 });
    }) as typeof fetch;

    await __launcherTestInternals.requestHostShutdown(
      "http://127.0.0.1:14327",
      "control-token",
      fetchImpl,
    );

    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:14327/shutdown",
        method: "POST",
        token: "control-token",
      },
    ]);
  });

  test("injects the browser host URL and app token into the web shell", () => {
    expect(__launcherTestInternals.buildViteDefine("http://127.0.0.1:14327", "app-token")).toEqual({
      "import.meta.env.VITE_ODT_APP_MODE": JSON.stringify("browser"),
      "import.meta.env.VITE_ODT_BROWSER_AUTH_TOKEN": JSON.stringify("app-token"),
      "import.meta.env.VITE_ODT_BROWSER_BACKEND_URL": JSON.stringify("http://127.0.0.1:14327"),
    });
  });
});
