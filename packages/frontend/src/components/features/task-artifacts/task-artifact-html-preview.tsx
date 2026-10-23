import { useEffect, useRef, useState } from "react";
import type { ArtifactPreviewEnvironment } from "@openducktor/contracts";
import { getShellBridge } from "@/lib/shell-bridge";
import { z } from "zod";

const previewMessageSchema = z.strictObject({
  generation: z.string(),
  type: z.enum(["ready", "displayed"]),
});

type PreviewState =
  | { status: "loading" }
  | { status: "environment"; environment: ArtifactPreviewEnvironment }
  | { status: "error"; message: string };

export function TaskArtifactHtmlPreview({ html, name }: { html: string; name: string }) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  useEffect(() => {
    let current = true;
    void getShellBridge()
      .getArtifactPreviewEnvironment()
      .then(
        (environment) => {
          if (current) setState({ status: "environment", environment });
        },
        (cause: unknown) => {
          if (current)
            setState({
              status: "error",
              message:
                cause instanceof Error
                  ? cause.message
                  : "Cannot check HTML preview isolation. Reopen the artifact to try again.",
            });
        },
      );
    return () => {
      current = false;
    };
  }, []);

  let preview;
  if (state.status === "loading") {
    preview = (
      <p role="status" className="min-h-0 overflow-auto p-4 text-sm text-muted-foreground">
        Checking preview isolation...
      </p>
    );
  } else if (state.status === "error") {
    preview = (
      <p role="alert" className="min-h-0 overflow-auto p-4 text-sm text-destructive">
        Cannot preview {name}: {state.message}
      </p>
    );
  } else if (!state.environment.scriptedHtml.supported) {
    preview = (
      <p className="min-h-0 overflow-auto p-4 text-sm text-muted-foreground">
        {state.environment.scriptedHtml.reason}
      </p>
    );
  } else {
    preview = (
      <IsolatedHtmlFrame html={html} name={name} bootstrapUrl={state.environment.bootstrapUrl} />
    );
  }
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{preview}</div>
  );
}

function IsolatedHtmlFrame({
  html,
  name,
  bootstrapUrl,
}: {
  html: string;
  name: string;
  bootstrapUrl: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const owner = container.current;
    if (!owner) return;
    const frame = document.createElement("iframe");
    frameRef.current = frame;
    setStatus("loading");
    const channel = new MessageChannel();
    const generation = crypto.randomUUID();
    let disposed = false;
    let initialized = false;
    let transferred = false;
    const release = () => {
      clearTimeout(timeout);
      frame.removeEventListener("load", initialize);
      frame.removeEventListener("error", fail);
      if (disposed) return;
      disposed = true;
      channel.port1.postMessage({ type: "dispose", generation });
      channel.port1.close();
      channel.port2.close();
      frame.remove();
      if (frameRef.current === frame) frameRef.current = null;
    };
    const fail = () => {
      setStatus("error");
      release();
    };
    const timeout = setTimeout(fail, 5_000);
    frame.title = "Artifact HTML preview";
    frame.sandbox.add("allow-scripts");
    frame.referrerPolicy = "no-referrer";
    frame.className = "block h-full w-full border-0 bg-white";
    const initialize = () => {
      if (disposed || initialized || !frame.contentWindow) return;
      initialized = true;
      frame.contentWindow.postMessage({ type: "odt-artifact-init", generation }, "*", [
        channel.port2,
      ]);
    };
    frame.addEventListener("load", initialize);
    frame.addEventListener("error", fail, { once: true });
    channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
      const message = previewMessageSchema.safeParse(data);
      if (disposed || !message.success || message.data.generation !== generation) return;
      if (message.data.type === "ready" && !transferred) {
        transferred = true;
        channel.port1.postMessage({ type: "render", generation, html });
      } else if (message.data.type === "displayed" && transferred) {
        clearTimeout(timeout);
        setStatus("ready");
      }
    };
    channel.port1.onmessageerror = fail;
    frame.src = bootstrapUrl;
    owner.append(frame);
    return release;
  }, [bootstrapUrl, html]);
  useEffect(() => {
    if (frameRef.current) frameRef.current.title = `${name} HTML preview`;
  }, [bootstrapUrl, html, name]);

  return (
    <>
      {status === "loading" ? (
        <p role="status" className="min-h-0 overflow-auto p-4 text-sm text-muted-foreground">
          Loading HTML preview...
        </p>
      ) : null}
      {status === "error" ? (
        <p role="alert" className="min-h-0 overflow-auto p-4 text-sm text-destructive">
          Cannot preview {name}: the isolated preview did not start. Reopen the artifact to try
          again.
        </p>
      ) : null}
      <div
        ref={container}
        className="min-h-0 min-w-0 flex-1 overflow-hidden"
        hidden={status === "error"}
      />
    </>
  );
}
