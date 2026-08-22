import { hasRuntimeType } from "@openducktor/contracts";
export const formatTokenCompact = (value: number | null | undefined): string | null => {
  if (
    !hasRuntimeType(value, "number") ||
    Number.isNaN(value) ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return null;
  }

  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1).replace(/\.0$/, "")}M`;
  }

  if (value >= 1_000) {
    const thousands = value / 1_000;
    if (Math.round(thousands) >= 1_000) {
      return "1M";
    }
    return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, "")}K`;
  }

  return `${Math.round(value)}`;
};

export const formatTokenExact = (value: number | null | undefined): string | null => {
  if (
    !hasRuntimeType(value, "number") ||
    Number.isNaN(value) ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return null;
  }
  return Math.round(value).toLocaleString("en-US");
};
