import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { z } from "zod";
import { HostValidationError } from "../../../effect/host-errors";
import { createGitlabIssueReader } from "./issues";
import type { gitlabIssueSchema } from "./models";
import {
  apiRequests,
  createFakeGitlab,
  type FakeGitlabResponse,
  gitlabTestRepoConfig as repoConfig,
  INSTANCE_URL,
  PROJECT_ID,
  PROJECT_IDENTITY,
  PROJECT_PATH,
  PROJECT_WEB_URL,
} from "./test-support";

const ISSUES = `/projects/${PROJECT_ID}/issues`;
const SECRET = "0123456789abcdef0123456789abcdef";
const UPLOAD_URL = `${PROJECT_WEB_URL}/uploads/${SECRET}/screen.png`;
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

const issue = (iid: number, overrides: Partial<z.input<typeof gitlabIssueSchema>> = {}) => ({
  iid,
  title: `Issue ${iid}`,
  description: `See ![screen](/uploads/${SECRET}/screen.png) and [log](/uploads/${SECRET}/log.txt).`,
  state: "opened",
  author: { username: "ann" },
  labels: ["bug", "ui"],
  web_url: `${PROJECT_WEB_URL}/-/issues/${iid}`,
  updated_at: "2026-01-02T00:00:00.000Z",
  issue_type: "issue",
  ...overrides,
});

const readerFor = (routes: Record<string, FakeGitlabResponse>) => {
  const fake = createFakeGitlab(routes);
  return { ...fake, reader: createGitlabIssueReader({ client: fake.client }) };
};

describe("GitLab issue reader", () => {
  test("uses the project identity as scope", async () => {
    const { reader } = readerFor({});

    expect(await Effect.runPromise(reader.scope(repoConfig))).toBe(PROJECT_IDENTITY);
  });

  test("lists open issues and incidents by title and rewrites upload links", async () => {
    const { reader, requests } = readerFor({
      [`GET ${ISSUES}`]: {
        json: [
          issue(3),
          issue(4, { issue_type: "test_case" }),
          issue(5, { issue_type: "incident" }),
        ],
        headers: { "x-next-page": "3" },
      },
    });

    const result = await Effect.runPromise(reader.list({ repoConfig, search: " crash ", page: 2 }));

    expect(result.nextPage).toBe(3);
    expect(result.items.map((item) => item.sourceId)).toEqual(["3", "5"]);
    expect(result.items[0]).toEqual({
      providerId: "gitlab",
      scope: PROJECT_IDENTITY,
      sourceId: "3",
      number: "3",
      url: `${PROJECT_WEB_URL}/-/issues/3`,
      title: "Issue 3",
      description: `See ![screen](${UPLOAD_URL}) and [log](${PROJECT_WEB_URL}/uploads/${SECRET}/log.txt).`,
      creator: "ann",
      updatedAt: "2026-01-02T00:00:00.000Z",
      tags: ["bug", "ui"],
      revision: "2026-01-02T00:00:00.000Z",
    });
    const query = requests.find((request) => request.path === ISSUES)?.query;
    expect(Object.fromEntries(query ?? [])).toEqual({
      state: "opened",
      order_by: "updated_at",
      search: "crash",
      in: "title",
      page: "2",
      per_page: "20",
    });
  });

  test("looks up an issue number instead of searching its text", async () => {
    const { reader, requests } = readerFor({ [`GET ${ISSUES}`]: { json: [issue(12)] } });

    const result = await Effect.runPromise(reader.list({ repoConfig, search: "#12", page: 1 }));

    expect(result.items.map((item) => item.number)).toEqual(["12"]);
    expect(result.nextPage).toBeUndefined();
    const query = requests.find((request) => request.path === ISSUES)?.query;
    expect(query?.getAll("iids[]")).toEqual(["12"]);
    expect(query?.has("search")).toBe(false);
  });

  test("reads one issue and rejects a closed one", async () => {
    const { reader } = readerFor({
      [`GET ${ISSUES}/7`]: { json: issue(7) },
      [`GET ${ISSUES}/8`]: { json: issue(8, { state: "closed" }) },
    });

    const read = await Effect.runPromise(reader.get({ repoConfig, sourceId: "7" }));
    const failure = await Effect.runPromise(
      reader.get({ repoConfig, sourceId: "8" }).pipe(Effect.flip),
    );

    expect(read).toMatchObject({ sourceId: "7", title: "Issue 7", tags: ["bug", "ui"] });
    expect(failure).toBeInstanceOf(HostValidationError);
    expect(failure.message).toContain("#8 is not an open issue");
  });

  test("rejects an invalid issue number before it reads GitLab", async () => {
    const { reader, requests } = readerFor({});

    const failure = await Effect.runPromise(
      reader.get({ repoConfig, sourceId: "../7" }).pipe(Effect.flip),
    );

    expect(failure).toMatchObject({ field: "sourceId" });
    expect(apiRequests(requests)).toEqual([]);
  });

  test("resolves the project once for each prepared read", async () => {
    const { reader, requests } = readerFor({
      [`GET ${ISSUES}/1`]: { json: issue(1) },
      [`GET ${ISSUES}/2`]: { json: issue(2) },
    });

    const get = await Effect.runPromise(reader.prepareGet(repoConfig));
    await Effect.runPromise(get("1"));
    await Effect.runPromise(get("2"));

    expect(requests.map((request) => request.path)).toEqual([
      `/projects/${encodeURIComponent(PROJECT_PATH)}`,
      `${ISSUES}/1`,
      `${ISSUES}/2`,
    ]);
  });

  test("reads an upload image of the issue description", async () => {
    const { reader, requests } = readerFor({
      [`GET ${ISSUES}/7`]: { json: issue(7) },
      [`GET /projects/${PROJECT_ID}/uploads/${SECRET}/screen.png`]: { bytes: PNG },
    });

    const image = await Effect.runPromise(
      reader.readImage!({ repoConfig, sourceId: "7", url: UPLOAD_URL }),
    );

    expect(image).toEqual({
      mediaType: "image/png",
      bytesBase64: Buffer.from(PNG).toString("base64"),
    });
    expect(apiRequests(requests)).toEqual([
      `GET ${ISSUES}/7`,
      `GET /projects/${PROJECT_ID}/uploads/${SECRET}/screen.png`,
    ]);
  });

  test("reads a project ID upload URL of a saved task description", async () => {
    const url = `${INSTANCE_URL}/-/project/${PROJECT_ID}/uploads/${SECRET}/screen.png`;
    const { reader, requests } = readerFor({
      [`GET /projects/${PROJECT_ID}/uploads/${SECRET}/screen.png`]: { bytes: PNG },
    });

    const image = await Effect.runPromise(
      reader.readImage!({
        repoConfig,
        sourceId: "7",
        url,
        savedDescription: `![screen](${url})`,
      }),
    );

    expect(image.mediaType).toBe("image/png");
    expect(apiRequests(requests)).toEqual([
      `GET /projects/${PROJECT_ID}/uploads/${SECRET}/screen.png`,
    ]);
  });

  test.each([
    {
      name: "another host",
      url: `https://evil.example.com/${PROJECT_PATH}/uploads/${SECRET}/a.png`,
    },
    { name: "another project", url: `${INSTANCE_URL}/other/app/uploads/${SECRET}/a.png` },
    { name: "a page that is not an upload", url: `${PROJECT_WEB_URL}/-/issues/7` },
    { name: "a query", url: `${UPLOAD_URL}?width=10` },
  ])("rejects $name without a request", async ({ url }) => {
    const { reader, requests } = readerFor({});

    const failure = await Effect.runPromise(
      reader.readImage!({ repoConfig, sourceId: "7", url, savedDescription: `![a](${url})` }).pipe(
        Effect.flip,
      ),
    );

    expect(failure).toMatchObject({ field: "url" });
    expect(failure.message).toContain(`not an upload of the GitLab project ${PROJECT_PATH}`);
    expect(apiRequests(requests)).toEqual([]);
  });

  test("rejects an upload that is not in the description", async () => {
    const { reader, requests } = readerFor({});

    const failure = await Effect.runPromise(
      reader.readImage!({
        repoConfig,
        sourceId: "7",
        url: UPLOAD_URL,
        savedDescription: "No image",
      }).pipe(Effect.flip),
    );

    expect(failure.message).toContain("not in the saved task description");
    expect(apiRequests(requests)).toEqual([]);
  });

  test("rejects an upload that is not an image", async () => {
    const url = `${PROJECT_WEB_URL}/uploads/${SECRET}/log.txt`;
    const { reader } = readerFor({
      [`GET /projects/${PROJECT_ID}/uploads/${SECRET}/log.txt`]: {
        bytes: new TextEncoder().encode("plain text"),
      },
    });

    const failure = await Effect.runPromise(
      reader.readImage!({ repoConfig, sourceId: "7", url, savedDescription: `[log](${url})` }).pipe(
        Effect.flip,
      ),
    );

    expect(failure.message).toContain("unsupported image format");
  });
});
