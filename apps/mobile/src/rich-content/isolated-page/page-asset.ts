import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import { useEffect, useEffectEvent, useState } from "react";

/**
 * A built isolated page. `asset` is the Metro asset of `assets/pages/<name>.html`, such as
 * `require("../../../assets/pages/terminal.html")`. Metro needs that literal `require`.
 */
export type IsolatedPage = { readonly name: string; readonly asset: number };

export const defineIsolatedPage = (name: string, asset: number): IsolatedPage => ({ name, asset });

const loading = new Map<string, Promise<string>>();
const loaded = new Map<string, string>();

const readPage = async (page: IsolatedPage): Promise<string> => {
  const asset = await Asset.fromModule(page.asset).downloadAsync();
  if (asset.localUri === null) throw new Error("The page file has no local copy.");
  return new File(asset.localUri).text();
};

/**
 * Reads the HTML of a page once per app run and keeps it in memory. A failed read keeps no
 * cache entry, so the next view reads the file again.
 */
const loadIsolatedPage = (page: IsolatedPage): Promise<string> => {
  const html = loaded.get(page.name);
  if (html !== undefined) return Promise.resolve(html);
  const pending = loading.get(page.name);
  if (pending !== undefined) return pending;
  const read = readPage(page).then(
    (text) => {
      loaded.set(page.name, text);
      loading.delete(page.name);
      return text;
    },
    (cause) => {
      loading.delete(page.name);
      throw new Error(
        `The app cannot read its ${page.name} page: ${errorMessage(cause)}. Restart the app, and reinstall it if this continues.`,
        { cause },
      );
    },
  );
  loading.set(page.name, read);
  return read;
};

export type IsolatedPageHtml =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly html: string }
  | { readonly status: "failed"; readonly message: string };

/**
 * The page HTML for a view. A page that loaded before is ready on the first render. A failed read
 * calls `onFailure` once with the message.
 */
export const useIsolatedPageHtml = (
  page: IsolatedPage,
  onFailure: (message: string) => void,
): IsolatedPageHtml => {
  const [state, setState] = useState<{ name: string; html: IsolatedPageHtml } | null>(null);
  const reportFailure = useEffectEvent(onFailure);
  const cached = loaded.get(page.name);
  const current: IsolatedPageHtml =
    cached !== undefined
      ? { status: "ready", html: cached }
      : state?.name === page.name
        ? state.html
        : { status: "loading" };
  const waiting = current.status === "loading";
  useEffect(() => {
    if (!waiting) return;
    let active = true;
    loadIsolatedPage(page).then(
      (html) => {
        if (active) setState({ name: page.name, html: { status: "ready", html } });
      },
      (cause) => {
        if (!active) return;
        const message = errorMessage(cause);
        setState({ name: page.name, html: { status: "failed", message } });
        reportFailure(message);
      },
    );
    return () => {
      active = false;
    };
  }, [page, waiting]);
  return current;
};
