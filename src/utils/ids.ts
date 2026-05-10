export function createId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  const unique =
    typeof cryptoApi?.randomUUID === "function"
      ? cryptoApi.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return `${prefix}_${unique}`;
}
