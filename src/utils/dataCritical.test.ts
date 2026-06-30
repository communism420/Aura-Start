import { describe, expect, it } from "vitest";
import { DATA_VERSION, DEFAULT_SETTINGS, MAX_RESTORE_POINTS } from "../constants";
import { useAuraStore } from "../store/useAuraStore";
import type { AuraStartData, AuraStartGroup, AuraStartLink } from "../types";
import { findDuplicateLinks } from "./duplicates";
import { createAFineStartExportCode } from "./exportAFineStart";
import { createCsvBookmarks } from "./exportCsv";
import { createHtmlBookmarks } from "./exportHtmlBookmarks";
import { createJsonBackup } from "./exportJson";
import { createMarkdownBookmarks } from "./exportMarkdown";
import { parseAFineStartExportWithReport } from "./importAFineStart";
import { validateAuraData } from "./importJson";
import { linkMatchesSearch, parseSearchQuery, searchAuraGroups } from "./search";
import { prepareTabsForSaving } from "./tabsCapture";

const ISO = "2026-01-01T00:00:00.000Z";

function settings(): AuraStartData["settings"] {
  return {
    ...DEFAULT_SETTINGS,
    sync: { ...DEFAULT_SETTINGS.sync }
  };
}

function link(overrides: Partial<AuraStartLink> = {}): AuraStartLink {
  return {
    id: "link_1",
    title: "GitHub",
    url: "https://github.com/",
    description: "Code hosting",
    tags: ["work", "dev"],
    order: 0,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides
  };
}

function group(overrides: Partial<AuraStartGroup> = {}): AuraStartGroup {
  return {
    id: "group_1",
    title: "Work",
    parentId: null,
    collapsed: false,
    order: 0,
    links: [link()],
    ...overrides
  };
}

function data(overrides: Partial<AuraStartData> = {}): AuraStartData {
  return {
    version: DATA_VERSION,
    updatedAt: ISO,
    settings: settings(),
    groups: [group()],
    restorePoints: [],
    ...overrides
  };
}

describe("A Fine Start import/export", () => {
  it("parses a valid grouped export code and normalizes URLs", () => {
    const result = parseAFineStartExportWithReport(
      JSON.stringify([[{ name: "Work", bookmarks: [{ name: "GitHub", url: "github.com" }] }]])
    );

    expect(result.sourceGroups).toBe(1);
    expect(result.sourceLinks).toBe(1);
    expect(result.rejectedLinks).toBe(0);
    expect(result.data.groups[0].title).toBe("Work");
    expect(result.data.groups[0].links[0].url).toBe("https://github.com/");
  });

  it("supports object-wrapped A Fine Start columns", () => {
    const result = parseAFineStartExportWithReport(
      JSON.stringify({ columns: [[{ name: "Reading", bookmarks: [{ name: "MDN", url: "https://developer.mozilla.org" }] }]] })
    );

    expect(result.data.groups[0].title).toBe("Reading");
    expect(result.data.groups[0].links[0].title).toBe("MDN");
  });

  it("rejects invalid export codes without returning data", () => {
    expect(() => parseAFineStartExportWithReport("{not json")).toThrow(/valid JSON/i);
  });

  it("skips unsafe URLs and reports rejected links", () => {
    const result = parseAFineStartExportWithReport(
      JSON.stringify([
        [
          {
            name: "Tools",
            bookmarks: [
              { name: "Unsafe", url: "javascript:alert(1)" },
              { name: "Web", url: "https://web.dev" }
            ]
          }
        ]
      ])
    );

    expect(result.sourceLinks).toBe(2);
    expect(result.rejectedLinks).toBe(1);
    expect(result.warnings[0]).toContain("Unsafe");
    expect(result.data.groups[0].links).toHaveLength(1);
  });

  it("creates A Fine Start-compatible output without Aura Start-only fields", () => {
    const exported = JSON.parse(createAFineStartExportCode(data()));

    expect(exported[0][0]).toEqual({
      name: "Work",
      bookmarks: [{ name: "GitHub", url: "https://github.com/" }]
    });
    expect(JSON.stringify(exported)).not.toContain("description");
    expect(JSON.stringify(exported)).not.toContain("tags");
  });
});

describe("export formats", () => {
  it("creates a full JSON backup shape", () => {
    const parsed = JSON.parse(createJsonBackup(data()));

    expect(parsed.version).toBe(DATA_VERSION);
    expect(parsed.groups[0].links[0].title).toBe("GitHub");
    expect(parsed.restorePoints).toEqual([]);
  });

  it("creates browser bookmarks HTML with folders and escaped links", () => {
    const html = createHtmlBookmarks(data({ groups: [group({ title: "Work & Tools" })] }));

    expect(html).toContain("<H3>Work &amp; Tools</H3>");
    expect(html).toContain('<A HREF="https://github.com/"');
  });

  it("exports nested groups in tree order", () => {
    const nestedData = data({
      groups: [
        group({ id: "parent", title: "Parent", order: 0, links: [] }),
        group({ id: "child", title: "Child", parentId: "parent", order: 0 })
      ]
    });

    expect(createMarkdownBookmarks(nestedData)).toContain("### Child");
    expect(createCsvBookmarks(nestedData)).toContain("Parent / Child");
    expect(createHtmlBookmarks(nestedData)).toContain("    <DT><H3>Child</H3>");
  });

  it("creates readable Markdown with descriptions and tags", () => {
    const markdown = createMarkdownBookmarks(data());

    expect(markdown).toContain("## Work");
    expect(markdown).toContain("- [GitHub](https://github.com/)");
    expect(markdown).toContain("Code hosting");
    expect(markdown).toContain("Tags: `work`, `dev`");
  });

  it("escapes CSV fields safely", () => {
    const csv = createCsvBookmarks(
      data({
        groups: [
          group({
            title: "Work, Tools",
            links: [link({ title: 'Docs "Quoted"', description: "Line one\nLine two" })]
          })
        ]
      })
    );

    expect(csv).toContain('"Work, Tools"');
    expect(csv).toContain('"Docs ""Quoted"""');
    expect(csv).toContain('"Line one\nLine two"');
  });
});

describe("duplicate finder", () => {
  it("classifies exact duplicates, hostname casing, trailing slashes, and http/https variants", () => {
    const duplicateData = data({
      groups: [
        group({
          links: [
            link({ id: "l1", url: "https://github.com/a" }),
            link({ id: "l2", url: "https://github.com/a" }),
            link({ id: "l3", url: "https://GitHub.com/case" }),
            link({ id: "l4", url: "https://github.com/case" }),
            link({ id: "l5", url: "https://example.com/docs" }),
            link({ id: "l6", url: "https://example.com/docs/" }),
            link({ id: "l7", url: "http://example.org/page" }),
            link({ id: "l8", url: "https://example.org/page" })
          ]
        })
      ]
    });

    const reasons = findDuplicateLinks(duplicateData).map((item) => item.reason);

    expect(reasons).toContain("exact_url");
    expect(reasons).toContain("hostname_case");
    expect(reasons).toContain("trailing_slash");
    expect(reasons).toContain("http_https");
  });

  it("handles special schemes without throwing or aggressive URL normalization", () => {
    const duplicateData = data({
      groups: [group({ links: [link({ id: "l1", url: "mailto:test@example.com" }), link({ id: "l2", url: "mailto:test@example.com" })] })]
    });

    const duplicates = findDuplicateLinks(duplicateData);

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].reason).toBe("exact_url");
  });
});

describe("open tabs capture", () => {
  it("deduplicates current-window tabs and skips unsupported or already saved URLs", () => {
    const preview = prepareTabsForSaving(
      [
        { title: "GitHub", url: "https://github.com/" },
        { title: "GitHub duplicate", url: "https://github.com/" },
        { title: "Docs", url: "https://developer.mozilla.org/" },
        { title: "Aura", url: "chrome-extension://abc/newtab.html" },
        { title: "Saved", url: "https://example.com/" }
      ],
      ["https://example.com/"]
    );

    expect(preview.links.map((item) => item.title)).toEqual(["GitHub", "Docs"]);
    expect(preview.duplicateCount).toBe(1);
    expect(preview.existingCount).toBe(1);
    expect(preview.skippedCount).toBe(1);
  });
});

describe("search modifiers", () => {
  const searchGroup = group({ title: "Development", links: [link({ title: "MDN Docs", url: "https://developer.mozilla.org", tags: ["docs", "web"] })] });
  const searchLink = searchGroup.links[0];

  it("matches title, URL, description, tags, and group modifiers", () => {
    expect(linkMatchesSearch(searchGroup, searchLink, parseSearchQuery("mdn"))).toBe(true);
    expect(linkMatchesSearch(searchGroup, searchLink, parseSearchQuery("url:mozilla"))).toBe(true);
    expect(linkMatchesSearch(searchGroup, searchLink, parseSearchQuery("tag:docs"))).toBe(true);
    expect(linkMatchesSearch(searchGroup, searchLink, parseSearchQuery("group:development"))).toBe(true);
    expect(linkMatchesSearch(searchGroup, searchLink, parseSearchQuery("title:docs"))).toBe(true);
    expect(linkMatchesSearch(searchGroup, searchLink, parseSearchQuery("tag:work"))).toBe(false);
  });

  it("finds typo-tolerant fuzzy matches and returns highlights", () => {
    const result = searchAuraGroups(data(), "githb");

    expect(result.results[0].link.title).toBe("GitHub");
    expect(result.highlights.links[result.results[0].link.id].title?.length).toBeGreaterThan(0);
  });

  it("keeps parent groups when a nested child link matches", () => {
    const nestedData = data({
      groups: [
        group({ id: "parent", title: "Parent", order: 0, links: [] }),
        group({ id: "child", title: "Child", parentId: "parent", order: 0, links: [link({ id: "nested_link", title: "Nested Docs" })] })
      ]
    });

    const result = searchAuraGroups(nestedData, "nested");

    expect(result.groups.map((item) => item.id)).toEqual(["parent", "child"]);
    expect(result.groups[0].links).toEqual([]);
    expect(result.groups[1].links[0].title).toBe("Nested Docs");
  });
});

describe("validation and restore point safety", () => {
  it("rejects unsupported backup versions and unsafe URL schemes", () => {
    expect(() => validateAuraData({ ...data(), version: 99 })).toThrow(/not supported/i);
    expect(() =>
      validateAuraData(data({ groups: [group({ links: [link({ url: "javascript:alert(1)" })] })] }))
    ).toThrow(/Only http and https/i);
  });

  it("caps imported restore points", () => {
    const restorePoints = Array.from({ length: MAX_RESTORE_POINTS + 5 }, (_, index) => ({
      id: `restore_${index}`,
      name: `Restore ${index}`,
      createdAt: ISO,
      reason: "manual" as const,
      data: {
        version: DATA_VERSION,
        updatedAt: ISO,
        settings: settings(),
        groups: [group({ id: `group_restore_${index}` })]
      }
    }));

    const validated = validateAuraData(data({ restorePoints }));

    expect(validated.restorePoints).toHaveLength(MAX_RESTORE_POINTS);
    expect(validated.restorePoints[0].id).toBe("restore_0");
  });

  it("preserves restore point timeline context", () => {
    const snapshotSource = data();
    const { restorePoints: _restorePoints, ...snapshot } = snapshotSource;
    const validated = validateAuraData(data({
      restorePoints: [
        {
          id: "restore_move",
          name: "Before moving link",
          createdAt: ISO,
          reason: "before_link_move",
          context: {
            entity: "link",
            title: "GitHub",
            from: "Work",
            to: "Tools"
          },
          data: snapshot
        }
      ]
    }));

    expect(validated.restorePoints[0].reason).toBe("before_link_move");
    expect(validated.restorePoints[0].context).toMatchObject({
      entity: "link",
      title: "GitHub",
      from: "Work",
      to: "Tools"
    });
  });

  it("groups restore points into a day timeline", () => {
    const snapshotSource = data();
    const { restorePoints: _restorePoints, ...snapshot } = snapshotSource;
    useAuraStore.setState({
      data: data({
        restorePoints: [
          {
            id: "restore_new",
            name: "Newer",
            createdAt: "2026-01-02T02:00:00.000Z",
            reason: "before_group_reorder",
            data: snapshot
          },
          {
            id: "restore_old",
            name: "Older",
            createdAt: "2026-01-01T02:00:00.000Z",
            reason: "manual",
            data: snapshot
          }
        ]
      })
    });

    const timeline = useAuraStore.getState().getRestoreTimeline();

    expect(timeline.map((day) => day.day)).toEqual(["2026-01-02", "2026-01-01"]);
    expect(timeline[0].entries[0].point.id).toBe("restore_new");
    expect(timeline[0].entries[0].groupCount).toBe(1);
    expect(timeline[0].entries[0].linkCount).toBe(1);
    useAuraStore.setState({ data: null });
  });

  it("migrates old flat groups to top-level groups", () => {
    const legacyGroup = group();
    const { parentId: _parentId, ...legacyGroupWithoutParent } = legacyGroup;
    const validated = validateAuraData(data({ groups: [legacyGroupWithoutParent as AuraStartGroup] }));

    expect(validated.groups[0].parentId).toBeNull();
  });

  it("migrates and clamps optional background and widget settings", () => {
    const legacySettings = { ...settings() } as Record<string, unknown>;
    delete legacySettings.background;
    delete legacySettings.widgets;
    delete legacySettings.pomodoro;

    const migrated = validateAuraData(data({ settings: legacySettings as AuraStartData["settings"] }));
    expect(migrated.settings.background).toEqual(DEFAULT_SETTINGS.background);
    expect(migrated.settings.widgets).toEqual(DEFAULT_SETTINGS.widgets);
    expect(migrated.settings.pomodoro).toEqual(DEFAULT_SETTINGS.pomodoro);

    const validated = validateAuraData(data({
      settings: {
        ...settings(),
        background: { preset: "forest", blur: 200, dim: -10, position: "left" },
        widgets: { clock: true, notes: "yes", pomodoro: true },
        pomodoro: { focusMinutes: 120, breakMinutes: 0 }
      } as unknown as AuraStartData["settings"]
    }));

    expect(validated.settings.background).toEqual({
      preset: "forest",
      blur: 18,
      dim: 0,
      position: "left"
    });
    expect(validated.settings.widgets).toEqual({
      clock: true,
      notes: DEFAULT_SETTINGS.widgets.notes,
      pomodoro: true
    });
    expect(validated.settings.pomodoro).toEqual({
      focusMinutes: 90,
      breakMinutes: 1
    });
  });
});
