const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);

export type UrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; code: "required" | "unsupported_protocol" | "missing_host" | "invalid"; message: string };

export function normalizeUrl(input: string): UrlValidationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, code: "required", message: "URL is required." };
  }

  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed);
  const candidate = hasProtocol ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (!ALLOWED_URL_PROTOCOLS.has(url.protocol)) {
      return { ok: false, code: "unsupported_protocol", message: "Only http and https links are allowed." };
    }

    if (!url.hostname) {
      return { ok: false, code: "missing_host", message: "URL must include a valid host." };
    }

    return { ok: true, url: url.toString() };
  } catch {
    return { ok: false, code: "invalid", message: "Enter a valid URL, for example https://example.com." };
  }
}

export function parseTags(input: string): string[] | undefined {
  const tags = input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  return tags.length > 0 ? Array.from(new Set(tags)) : undefined;
}
