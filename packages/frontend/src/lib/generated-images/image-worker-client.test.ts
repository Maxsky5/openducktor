import { expect, mock, spyOn, test } from "bun:test";
import { LOCAL_ATTACHMENT_BYTE_LIMIT } from "@openducktor/contracts";
import { decodeGeneratedImage } from "./image-worker-client";

const payload = { mime: "image/png", byteLength: 3, base64: "AQID" };

test("the module worker decodes image bytes", async () => {
  const signal = new AbortController().signal;
  expect(new Uint8Array(await decodeGeneratedImage(payload, signal))).toEqual(
    new Uint8Array([1, 2, 3]),
  );
});

test("the module worker rejects malformed base64", async () => {
  const signal = new AbortController().signal;
  await expect(decodeGeneratedImage({ ...payload, base64: "!!!!" }, signal)).rejects.toThrow(
    "cannot be decoded",
  );
});

test("the module worker rejects mismatched byte counts", async () => {
  const signal = new AbortController().signal;
  await expect(decodeGeneratedImage({ ...payload, byteLength: 2 }, signal)).rejects.toThrow(
    "invalid content",
  );
});

test("payload limits and MIME fail before a worker receives the bytes", async () => {
  const worker = spyOn(globalThis, "Worker");
  try {
    for (const change of [
      { mime: "image/jpeg" },
      { byteLength: LOCAL_ATTACHMENT_BYTE_LIMIT + 1 },
      { byteLength: 0 },
    ])
      await expect(
        decodeGeneratedImage({ ...payload, ...change }, new AbortController().signal),
      ).rejects.toThrow("invalid content");
    expect(worker).not.toHaveBeenCalled();
  } finally {
    worker.mockRestore();
  }
});

type ImageWorkerTestDouble = {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onmessageerror: (() => void) | null;
  postMessage: ReturnType<typeof mock<() => void>>;
  terminate: ReturnType<typeof mock<() => void>>;
};

for (const failure of [
  "abort",
  "error",
  "messageerror",
  "malformed",
  "wrong-kind",
  "wrong-size",
  "post",
] as const) {
  test(`${failure} rejects the pending decode and terminates its worker`, async () => {
    const stub: ImageWorkerTestDouble = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage: mock(() => {
        if (failure === "post") throw new Error("post failed");
      }),
      terminate: mock(() => {}),
    };
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker")!;
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: class {
        constructor() {
          return stub;
        }
      },
    });
    const controller = new AbortController();
    try {
      const pending = decodeGeneratedImage(payload, controller.signal);
      if (failure === "abort") controller.abort(new Error("cancelled"));
      if (failure === "error") stub.onerror!();
      if (failure === "messageerror") stub.onmessageerror!();
      if (failure === "malformed") stub.onmessage!({ data: null });
      if (failure === "wrong-kind") stub.onmessage!({ data: { kind: "history", parts: [] } });
      if (failure === "wrong-size")
        stub.onmessage!({ data: { kind: "decode", bytes: new ArrayBuffer(1) } });
      await expect(pending).rejects.toThrow();
      expect(stub.terminate).toHaveBeenCalledTimes(1);
      controller.abort();
      expect(stub.terminate).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, "Worker", descriptor);
    }
  });
}
