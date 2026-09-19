import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { toCatalogResponse } from "./agent-runtime-catalog-response";

const runtime: RuntimeInstanceSummary = {
  runtimeId: "runtime-1",
  kind: "claude",
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: { type: "host_service", identity: "runtime-1" },
  startedAt: "2026-09-17T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.claude,
};

const modelsCatalog = { models: [], defaultModelsByProvider: {} };

describe("toCatalogResponse", () => {
  test("passes available surfaces through and keeps the runtime descriptor", () => {
    expect(
      toCatalogResponse(
        {
          runtime: CLAUDE_RUNTIME_DESCRIPTOR,
          models: { status: "available", catalog: modelsCatalog },
        },
        runtime,
      ),
    ).toEqual({
      runtime: CLAUDE_RUNTIME_DESCRIPTOR,
      models: { status: "available", catalog: modelsCatalog },
    });
  });

  test("omits surfaces the adapter does not serve", () => {
    const response = toCatalogResponse({}, runtime);

    expect(response).toEqual({});
  });

  test("names the runtime and the surface for a failed surface read", () => {
    const response = toCatalogResponse(
      {
        skills: { status: "failed", cause: new Error("skill index unavailable") },
      },
      runtime,
    );

    expect(response.skills).toEqual({
      status: "failed",
      message: `${CLAUDE_RUNTIME_DESCRIPTOR.label} could not load skill catalog. skill index unavailable Retry this surface.`,
    });
  });

  test("names the invalid field for invalid catalog data", () => {
    const response = toCatalogResponse(
      {
        // SAFETY: Invalid catalog data tests the host-side validation path.
        models: { status: "available", catalog: { models: "broken" } } as never,
      },
      runtime,
    );

    expect(response.models?.status).toBe("failed");
    const message = response.models?.status === "failed" ? response.models.message : "";
    expect(message).toContain(
      `${CLAUDE_RUNTIME_DESCRIPTOR.label} returned invalid model catalog data. models:`,
    );
    expect(message).toContain("Update the runtime and retry this surface.");
    expect(message).not.toContain('"code"');
  });

  test("keeps the other surfaces when one surface fails", () => {
    const response = toCatalogResponse(
      {
        models: { status: "available", catalog: modelsCatalog },
        subagents: { status: "failed", cause: new Error("agent index unavailable") },
      },
      runtime,
    );

    expect(response.models).toEqual({ status: "available", catalog: modelsCatalog });
    expect(response.subagents?.status).toBe("failed");
  });
});
