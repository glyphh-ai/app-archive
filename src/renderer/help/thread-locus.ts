/**
 * thread-locus.ts — where a thread runs, read off its record.
 *
 * A COPY of `threadLocus` in src/shared/member-library.ts, kept in the renderer
 * on purpose: the renderer never imports src/shared (one such import moves tsc's
 * rootDir and the app runs stale code — the 2026-09-17 incident, guarded by
 * scripts/check-renderer-emit.mjs). Keep the two in step.
 */
export function threadLocus(c: { source?: unknown; workdir?: unknown; messages?: unknown[]; messageCount?: number }): "local" | "cloud" {
  const src = c.source as { kind?: unknown } | null | undefined;
  const kind = src && typeof src === "object" && typeof src.kind === "string" ? src.kind : "";
  if (kind === "local") return "local";
  if (kind.startsWith("cloud")) return "cloud";
  if (typeof c.workdir === "string" && c.workdir) return "local";
  const adoptedStub = typeof c.messageCount === "number" && c.messageCount > 0 && !(c.messages?.length);
  return adoptedStub ? "cloud" : "local";
}
