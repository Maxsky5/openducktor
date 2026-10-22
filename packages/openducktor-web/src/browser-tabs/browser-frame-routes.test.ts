import { describe, expect, test } from "bun:test";
import type { BrowserFrameSource } from "@openducktor/contracts";
import { Effect } from "effect";
import { WebHostRequestError } from "@openducktor/remote-host/effect/web-errors";
import { routeBrowserFrameHttpRequest } from "./browser-frame-routes";

const PREVIEW = "http://localhost:61000";

const route = (request: Request, site: BrowserFrameSource = { kind: "direct" }) => {
  const previews: Array<{ target: string; appOrigin: string }> = [];
  const checks: Array<{ target: string; appOrigin: string }> = [];
  const result = Effect.runPromise(
    Effect.result(
      routeBrowserFrameHttpRequest({
        appToken: "token",
        corsHeaders: {},
        request,
        previews: {
          originFor: async (input) => {
            previews.push(input);
            return PREVIEW;
          },
          close: async () => {},
        },
        checkSiteFraming: async (input) => {
          checks.push(input);
          return site;
        },
        validateAppTokenHeader: (candidate, expected) =>
          candidate.headers.get("x-token") === expected
            ? Effect.void
            : Effect.fail(new WebHostRequestError({ message: "Invalid token.", status: 401 })),
      }),
    ),
  );
  return { previews, checks, result };
};

const frameRequest = (target: string, origin = "http://localhost:5555", token = "token") =>
  new Request("http://localhost:4000/browser/frame-source", {
    method: "POST",
    headers: { "content-type": "application/json", "x-token": token, origin },
    body: JSON.stringify({ target }),
  });

const json = async (result: Awaited<ReturnType<typeof route>["result"]>) => {
  if (result._tag !== "Success" || result.success === null) throw new Error("No response.");
  return result.success.json();
};

describe("browser frame source route", () => {
  test("gives a page of the host its preview origin", async () => {
    const { previews, checks, result } = route(frameRequest("http://localhost:3000/app"));

    expect(await json(await result)).toEqual({ kind: "preview", origin: PREVIEW });
    expect(previews).toEqual([
      { target: "http://localhost:3000/app", appOrigin: "http://localhost:5555" },
    ]);
    expect(checks).toEqual([]);
  });

  test("asks a site outside the host whether the app can frame it", async () => {
    const refused = { kind: "refused", message: "github.com refuses frames." } as const;
    const { previews, checks, result } = route(frameRequest("https://github.com/"), refused);

    expect(await json(await result)).toEqual(refused);
    expect(checks).toEqual([{ target: "https://github.com/", appOrigin: "http://localhost:5555" }]);
    expect(previews).toEqual([]);
  });

  test("refuses an app that is not on this machine, a request without the app token, and other schemes", async () => {
    const remote = route(frameRequest("http://localhost:3000/", "http://192.168.1.5:5555"));
    const otherLoopbackName = route(
      frameRequest("http://localhost:3000/", "http://dev.localhost:5555"),
    );
    const anonymous = route(frameRequest("http://localhost:3000/", undefined, "wrong"));
    const file = route(frameRequest("file:///etc/passwd"));

    for (const [{ result }, status] of [
      [remote, 400],
      [otherLoopbackName, 400],
      [anonymous, 401],
      [file, 400],
    ] as const) {
      expect(await result).toMatchObject({ _tag: "Failure", failure: { status } });
    }
    expect(
      [remote, anonymous, file].flatMap(({ previews, checks }) => [...previews, ...checks]),
    ).toEqual([]);
  });
});
