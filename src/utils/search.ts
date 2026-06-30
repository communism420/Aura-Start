import Fuse from "fuse.js";
import type { FuseResultMatch } from "fuse.js";
import type { AuraStartData, AuraStartGroup, AuraStartLink } from "../types";
import { flattenGroupTree, groupsInTreeOrder, groupTitlePath, buildGroupTree } from "./groupTree";

type SearchField = "tag" | "group" | "url" | "title";
export type SearchQuickFilter = "all" | "title" | "url" | "tag";

export type SearchHighlightRange = {
  start: number;
  end: number;
};

export type LinkSearchHighlights = {
  title?: SearchHighlightRange[];
  url?: SearchHighlightRange[];
  description?: SearchHighlightRange[];
  tags?: Record<number, SearchHighlightRange[]>;
};

export type SearchHighlightMap = {
  groups: Record<string, SearchHighlightRange[]>;
  links: Record<string, LinkSearchHighlights>;
};

type SearchToken = {
  field?: SearchField;
  value: string;
};

export type ParsedSearchQuery = {
  raw: string;
  tokens: SearchToken[];
};

export type SearchResult = {
  groupId: string;
  link: AuraStartLink;
  score?: number;
};

export type SearchAuraGroupsResult = {
  groups: AuraStartGroup[];
  highlights: SearchHighlightMap;
  highlightTerms: string[];
  results: SearchResult[];
};

const MODIFIER_PATTERN = /^(tag|group|url|title):(.+)$/i;
const DEFAULT_HIGHLIGHTS: SearchHighlightMap = { groups: {}, links: {} };

type LinkSearchRecord = {
  id: string;
  groupId: string;
  groupTitle: string;
  groupPath: string;
  title: string;
  url: string;
  description: string;
  tags: string[];
  link: AuraStartLink;
};

type SearchAccumulator = {
  record: LinkSearchRecord;
  score: number;
  matches: FuseResultMatch[];
  tokenHits: number;
};

type CachedSearchResult = {
  data: AuraStartData;
  filter: SearchQuickFilter;
  query: string;
  result: SearchAuraGroupsResult;
};

let cachedSearch: CachedSearchResult | undefined;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function includesValue(value: string | undefined, query: string): boolean {
  return Boolean(value && normalize(value).includes(query));
}

export function parseSearchQuery(query: string): ParsedSearchQuery {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((part): SearchToken | null => {
      const modifier = part.match(MODIFIER_PATTERN);
      if (modifier) {
        const value = normalize(modifier[2]);
        return value ? { field: modifier[1].toLowerCase() as SearchField, value } : null;
      }

      const value = normalize(part);
      return value ? { value } : null;
    })
    .filter((token): token is SearchToken => token !== null);

  return { raw: query, tokens };
}

export function searchHasQuery(parsed: ParsedSearchQuery): boolean {
  return parsed.tokens.length > 0;
}

export function isSearchQuickFilter(value: unknown): value is SearchQuickFilter {
  return value === "all" || value === "title" || value === "url" || value === "tag";
}

function linkMatchesToken(group: AuraStartGroup, link: AuraStartLink, token: SearchToken): boolean {
  switch (token.field) {
    case "group":
      return includesValue(group.title, token.value);
    case "tag":
      return Boolean(link.tags?.some((tag) => includesValue(tag, token.value)));
    case "title":
      return includesValue(link.title, token.value);
    case "url":
      return includesValue(link.url, token.value);
    default:
      return (
        includesValue(group.title, token.value) ||
        includesValue(link.title, token.value) ||
        includesValue(link.url, token.value) ||
        includesValue(link.description, token.value) ||
        Boolean(link.tags?.some((tag) => includesValue(tag, token.value)))
      );
  }
}

export function linkMatchesSearch(group: AuraStartGroup, link: AuraStartLink, parsed: ParsedSearchQuery): boolean {
  if (!searchHasQuery(parsed)) return true;
  return parsed.tokens.every((token) => linkMatchesToken(group, link, token));
}

export function filterGroupsForSearch(groups: AuraStartGroup[], parsed: ParsedSearchQuery): AuraStartGroup[] {
  if (!searchHasQuery(parsed)) {
    return groups;
  }

  return groups
    .map((group): AuraStartGroup | null => {
      const links = group.links.filter((link) => linkMatchesSearch(group, link, parsed));
      if (!links.length) return null;
      return { ...group, collapsed: false, links };
    })
    .filter((group): group is AuraStartGroup => group !== null);
}

export function flattenSearchResults(groups: AuraStartGroup[]): SearchResult[] {
  return groups.flatMap((group) =>
    group.links
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((link) => ({ groupId: group.id, link }))
  );
}

export function searchResultId(groupId: string, linkId: string): string {
  return `${groupId}::${linkId}`;
}

export function searchHighlightTerms(parsed: ParsedSearchQuery): string[] {
  return Array.from(new Set(parsed.tokens.map((token) => token.value).filter((value) => value.length >= 2)));
}

function keysForFilter(filter: SearchQuickFilter, field?: SearchField) {
  const narrowed = field === "tag" ? "tag" : field ?? filter;

  if (narrowed === "title") return ["title"];
  if (narrowed === "url") return ["url"];
  if (narrowed === "tag") return ["tags"];
  if (narrowed === "group") return ["groupTitle", "groupPath"];

  return [
    { name: "title", weight: 0.4 },
    { name: "groupTitle", weight: 0.18 },
    { name: "groupPath", weight: 0.14 },
    { name: "url", weight: 0.16 },
    { name: "tags", weight: 0.08 },
    { name: "description", weight: 0.04 }
  ];
}

function createFuse(records: LinkSearchRecord[], filter: SearchQuickFilter, field?: SearchField): Fuse<LinkSearchRecord> {
  return new Fuse(records, {
    ignoreLocation: true,
    includeMatches: true,
    includeScore: true,
    keys: keysForFilter(filter, field),
    minMatchCharLength: 1,
    shouldSort: true,
    threshold: 0.38
  });
}

function linkRecords(data: AuraStartData): LinkSearchRecord[] {
  return flattenGroupTree(buildGroupTree(data.groups)).flatMap((group) =>
    group.links
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((link) => ({
        id: link.id,
        groupId: group.id,
        groupTitle: group.title,
        groupPath: groupTitlePath(data.groups, group),
        title: link.title,
        url: link.url,
        description: link.description ?? "",
        tags: link.tags ?? [],
        link
      }))
  );
}

function mergeRanges(current: SearchHighlightRange[] | undefined, ranges: SearchHighlightRange[]): SearchHighlightRange[] {
  const merged = [...(current ?? []), ...ranges]
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const result: SearchHighlightRange[] = [];

  merged.forEach((range) => {
    const previous = result[result.length - 1];
    if (!previous || range.start > previous.end) {
      result.push({ ...range });
      return;
    }

    previous.end = Math.max(previous.end, range.end);
  });

  return result;
}

function matchRanges(match: FuseResultMatch): SearchHighlightRange[] {
  return match.indices.map(([start, end]) => ({ start, end: end + 1 }));
}

function addLinkHighlights(highlights: SearchHighlightMap, record: LinkSearchRecord, matches: FuseResultMatch[]): void {
  const linkHighlights = highlights.links[record.link.id] ?? {};

  matches.forEach((match) => {
    const ranges = matchRanges(match);
    if (!ranges.length) return;

    if (match.key === "title") {
      linkHighlights.title = mergeRanges(linkHighlights.title, ranges);
    }
    if (match.key === "url") {
      linkHighlights.url = mergeRanges(linkHighlights.url, ranges);
    }
    if (match.key === "description") {
      linkHighlights.description = mergeRanges(linkHighlights.description, ranges);
    }
    if (match.key === "tags") {
      const tagIndex = typeof match.refIndex === "number" ? match.refIndex : record.tags.findIndex((tag) => tag === match.value);
      if (tagIndex >= 0) {
        const tags = linkHighlights.tags ?? {};
        tags[tagIndex] = mergeRanges(tags[tagIndex], ranges);
        linkHighlights.tags = tags;
      }
    }
    if (match.key === "groupTitle") {
      highlights.groups[record.groupId] = mergeRanges(highlights.groups[record.groupId], ranges);
    }
  });

  highlights.links[record.link.id] = linkHighlights;
}

function searchRecords(records: LinkSearchRecord[], parsed: ParsedSearchQuery, filter: SearchQuickFilter): SearchAccumulator[] {
  const hits = new Map<string, SearchAccumulator>();

  parsed.tokens.forEach((token, tokenIndex) => {
    const fuse = createFuse(records, filter, token.field);
    const tokenResults = fuse.search(token.value);
    const tokenIds = new Set<string>();

    tokenResults.forEach((result) => {
      tokenIds.add(result.item.id);
      const current = hits.get(result.item.id) ?? {
        record: result.item,
        score: 0,
        matches: [],
        tokenHits: 0
      };
      current.score += result.score ?? 0;
      current.matches.push(...(result.matches ?? []));
      current.tokenHits += 1;
      hits.set(result.item.id, current);
    });

    if (tokenIndex === 0) return;

    Array.from(hits.keys()).forEach((id) => {
      if (!tokenIds.has(id)) {
        hits.delete(id);
      }
    });
  });

  return Array.from(hits.values())
    .filter((hit) => hit.tokenHits === parsed.tokens.length)
    .sort((a, b) => a.score - b.score || a.record.groupPath.localeCompare(b.record.groupPath) || a.record.title.localeCompare(b.record.title));
}

function includeAncestorGroups(groups: AuraStartGroup[], groupIds: Set<string>): Set<string> {
  const included = new Set(groupIds);
  const groupsById = new Map(groups.map((group) => [group.id, group]));

  groupIds.forEach((groupId) => {
    let parentId = groupsById.get(groupId)?.parentId ?? null;
    while (parentId) {
      included.add(parentId);
      parentId = groupsById.get(parentId)?.parentId ?? null;
    }
  });

  return included;
}

export function searchAuraGroups(
  data: AuraStartData,
  query: string,
  filter: SearchQuickFilter = "all"
): SearchAuraGroupsResult {
  const normalizedQuery = query.trim();
  if (cachedSearch && cachedSearch.data === data && cachedSearch.query === normalizedQuery && cachedSearch.filter === filter) {
    return cachedSearch.result;
  }

  const parsed = parseSearchQuery(normalizedQuery);
  const baseGroups = groupsInTreeOrder(data.groups);
  if (!searchHasQuery(parsed)) {
    const result = {
      groups: baseGroups,
      highlights: DEFAULT_HIGHLIGHTS,
      highlightTerms: [],
      results: flattenSearchResults(baseGroups)
    };
    cachedSearch = { data, filter, query: normalizedQuery, result };
    return result;
  }

  const hits = searchRecords(linkRecords(data), parsed, filter);
  const matchedLinkIds = new Set(hits.map((hit) => hit.record.link.id));
  const matchedGroupIds = new Set(hits.map((hit) => hit.record.groupId));
  const includedGroupIds = includeAncestorGroups(data.groups, matchedGroupIds);
  const highlights: SearchHighlightMap = { groups: {}, links: {} };
  hits.forEach((hit) => addLinkHighlights(highlights, hit.record, hit.matches));

  const groups = baseGroups
    .filter((group) => includedGroupIds.has(group.id))
    .map((group) => ({
      ...group,
      collapsed: false,
      links: group.links.filter((link) => matchedLinkIds.has(link.id))
    }));
  const results = hits.map((hit) => ({
    groupId: hit.record.groupId,
    link: hit.record.link,
    score: hit.score
  }));
  const result = {
    groups,
    highlights,
    highlightTerms: searchHighlightTerms(parsed),
    results
  };

  cachedSearch = { data, filter, query: normalizedQuery, result };
  return result;
}
