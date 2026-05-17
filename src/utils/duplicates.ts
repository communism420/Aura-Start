import type { AuraStartData, AuraStartLink } from "../types";

export type DuplicateReason = "exact_url" | "hostname_case" | "trailing_slash" | "http_https";

export type DuplicateLinkRef = {
  groupId: string;
  groupTitle: string;
  link: AuraStartLink;
};

export type DuplicateGroup = {
  id: string;
  kind: "exact" | "possible";
  reason: DuplicateReason;
  items: DuplicateLinkRef[];
};

type IndexedLink = DuplicateLinkRef & {
  rawUrl: string;
  parsed?: URL;
};

type Bucket = {
  reason: DuplicateReason;
  items: IndexedLink[];
};

function trimTrailingSlash(pathname: string): string {
  if (pathname === "/") return "";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function parseUrl(rawUrl: string): URL | undefined {
  try {
    return new URL(rawUrl);
  } catch {
    return undefined;
  }
}

function originalHost(rawUrl: string): string | undefined {
  return rawUrl.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1];
}

function isWebUrl(url: URL | undefined): url is URL {
  return url?.protocol === "http:" || url?.protocol === "https:";
}

function exactKey(item: IndexedLink): string {
  if (!isWebUrl(item.parsed)) {
    return `raw:${item.rawUrl}`;
  }

  const url = item.parsed;
  return [
    url.protocol,
    url.hostname.toLowerCase(),
    url.port,
    trimTrailingSlash(url.pathname),
    url.search,
    url.hash
  ].join("|");
}

function possibleHttpHttpsKey(item: IndexedLink): string | undefined {
  if (!isWebUrl(item.parsed)) return undefined;
  const url = item.parsed;
  return [url.hostname.toLowerCase(), url.port, trimTrailingSlash(url.pathname), url.search, url.hash].join("|");
}

function exactReason(items: IndexedLink[]): DuplicateReason {
  const hostVariants = new Set(
    items
      .map((item) => originalHost(item.rawUrl))
      .filter((host): host is string => Boolean(host))
  );
  if (hostVariants.size > 1) {
    return "hostname_case";
  }

  const pathVariants = new Set(items.map((item) => (isWebUrl(item.parsed) ? item.parsed.pathname : item.rawUrl)));
  if (pathVariants.size > 1) {
    return "trailing_slash";
  }

  return "exact_url";
}

function addToBucket(map: Map<string, Bucket>, key: string, item: IndexedLink, reason: DuplicateReason): void {
  const bucket = map.get(key);
  if (bucket) {
    bucket.items.push(item);
    return;
  }

  map.set(key, { reason, items: [item] });
}

function toDuplicateGroups(kind: "exact" | "possible", buckets: Map<string, Bucket>): DuplicateGroup[] {
  return Array.from(buckets.entries())
    .filter(([, bucket]) => bucket.items.length > 1)
    .map(([key, bucket]) => ({
      id: `${kind}:${key}`,
      kind,
      reason: kind === "exact" ? exactReason(bucket.items) : bucket.reason,
      items: bucket.items.map(({ groupId, groupTitle, link }) => ({ groupId, groupTitle, link }))
    }));
}

export function findDuplicateLinks(data: AuraStartData): DuplicateGroup[] {
  const indexed = data.groups.flatMap((group) =>
    group.links.map((link): IndexedLink => {
      const rawUrl = link.url.trim();
      return {
        groupId: group.id,
        groupTitle: group.title,
        link,
        rawUrl,
        parsed: parseUrl(rawUrl)
      };
    })
  );

  const exactBuckets = new Map<string, Bucket>();
  const possibleBuckets = new Map<string, Bucket>();

  indexed.forEach((item) => {
    addToBucket(exactBuckets, exactKey(item), item, "exact_url");

    const possibleKey = possibleHttpHttpsKey(item);
    if (possibleKey) {
      addToBucket(possibleBuckets, possibleKey, item, "http_https");
    }
  });

  return [
    ...toDuplicateGroups("exact", exactBuckets),
    ...toDuplicateGroups("possible", possibleBuckets).filter((group) => {
      const protocols = new Set(group.items.map((item) => parseUrl(item.link.url)?.protocol).filter(Boolean));
      return protocols.has("http:") && protocols.has("https:");
    })
  ];
}
