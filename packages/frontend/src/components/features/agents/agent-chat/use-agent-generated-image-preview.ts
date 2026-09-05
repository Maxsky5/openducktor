import type { AgentEnginePort } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  type AgentGeneratedImageQueryInput,
  agentGeneratedImageQueryOptions,
} from "@/state/queries/agent-generated-images";

const DECODE_ERROR =
  "Preview unavailable: the PNG could not be displayed. Check the runtime output file.";
type DecodedPreview =
  | { blob: Blob; src: string; error: null }
  | { blob: Blob; src: null; error: string };

export const useAgentGeneratedImagePreview = (
  input: AgentGeneratedImageQueryInput,
  read: AgentEnginePort["readGeneratedImage"],
) => {
  const query = useQuery(agentGeneratedImageQueryOptions(input, read));
  const [preview, setPreview] = useState<DecodedPreview | null>(null);
  const blob = query.data;
  useEffect(() => {
    if (!blob) return;
    const src = URL.createObjectURL(blob);
    const image = new Image();
    let active = true;
    image.onload = () => {
      if (!active) return;
      setPreview(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? { blob, src, error: null }
          : { blob, src: null, error: DECODE_ERROR },
      );
    };
    image.onerror = () => {
      if (active) setPreview({ blob, src: null, error: DECODE_ERROR });
    };
    image.src = src;
    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
      image.src = "";
      URL.revokeObjectURL(src);
    };
  }, [blob]);
  const current = preview?.blob === blob ? preview : null;
  const error = query.error?.message ?? current?.error ?? null;
  return { src: current?.src ?? null, error, isLoading: !error && !current?.src };
};
