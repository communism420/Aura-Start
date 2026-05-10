const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);

export type UrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

export function normalizeUrl(input: string): UrlValidationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, message: "URL is required." };
  }

  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed);
  const candidate = hasProtocol ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (!ALLOWED_URL_PROTOCOLS.has(url.protocol)) {
      return { ok: false, message: "Only http and https links are allowed." };
    }

    if (!url.hostname) {
      return { ok: false, message: "URL must include a valid host." };
    }

    return { ok: true, url: url.toString() };
  } catch {
    return { ok: false, message: "Enter a valid URL, for example https://example.com." };
  }
}

export function validateTitle(input: string, label: string): string {
  const title = input.trim();
  if (!title) {
    throw new Error(`${label} title is required.`);
  }

  return title;
}

export function parseTags(input: string): string[] | undefined {
  const tags = input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  return tags.length > 0 ? Array.from(new Set(tags)) : undefined;
}
