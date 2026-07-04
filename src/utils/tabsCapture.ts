import {
  containsExtensionPermission,
  queryCurrentWindowTabs,
  requestExtensionPermission,
  type ExtensionTab
} from "./browserApi";
import { normalizeUrl } from "./validators";

const TABS_PERMISSION = "tabs";

export type CapturedTabLink = {
  title: string;
  url: string;
  favIconUrl?: string;
};

export type TabsCapturePreview = {
  links: CapturedTabLink[];
  duplicateCount: number;
  existingCount: number;
  skippedCount: number;
  totalCount: number;
};

type TabLike = ExtensionTab & {
  favIconUrl?: string;
  title?: string;
  url?: string;
};

function extensionApiUnavailable(): Error {
  return new Error("Open tab capture is available only in the installed browser extension.");
}

function normalizeExistingUrls(urls: string[] = []): Set<string> {
  const normalized = urls
    .map((url) => normalizeUrl(url))
    .filter((result): result is Extract<ReturnType<typeof normalizeUrl>, { ok: true }> => result.ok)
    .map((result) => result.url);

  return new Set(normalized);
}

function titleFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function prepareTabsForSaving(tabs: TabLike[], existingUrls: string[] = []): TabsCapturePreview {
  const seen = normalizeExistingUrls(existingUrls);
  const links: CapturedTabLink[] = [];
  let duplicateCount = 0;
  let existingCount = 0;
  let skippedCount = 0;

  tabs.forEach((tab) => {
    const normalized = normalizeUrl(tab.url ?? "");
    if (!normalized.ok) {
      skippedCount += 1;
      return;
    }

    if (seen.has(normalized.url)) {
      const isExisting = existingUrls.length > 0 && !links.some((link) => link.url === normalized.url);
      if (isExisting) {
        existingCount += 1;
      } else {
        duplicateCount += 1;
      }
      return;
    }

    seen.add(normalized.url);
    const title = tab.title?.trim() || titleFromUrl(normalized.url);
    links.push({
      title,
      url: normalized.url,
      favIconUrl: tab.favIconUrl
    });
  });

  return {
    links,
    duplicateCount,
    existingCount,
    skippedCount,
    totalCount: tabs.length
  };
}

export async function hasTabsPermission(): Promise<boolean> {
  return await containsExtensionPermission(TABS_PERMISSION);
}

export async function requestTabsPermission(): Promise<boolean> {
  try {
    return await requestExtensionPermission(TABS_PERMISSION);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw extensionApiUnavailable();
  }
}

export async function getCurrentWindowTabsPreview(existingUrls: string[] = []): Promise<TabsCapturePreview> {
  const granted = await requestTabsPermission();
  if (!granted) {
    throw new Error("Tabs permission was not granted.");
  }

  return prepareTabsForSaving(await queryCurrentWindowTabs(), existingUrls);
}
