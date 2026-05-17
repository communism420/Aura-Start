import type { AuraStartGroup, AuraStartLink } from "../types";

type SearchField = "tag" | "group" | "url" | "title";

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
};

const MODIFIER_PATTERN = /^(tag|group|url|title):(.+)$/i;

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
