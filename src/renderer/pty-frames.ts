/**
 * pty-frames.ts — the JSON frame codec of the WORKER PTY socket
 * (`WS /api/harness/pty/:ptyId?token=…`, help/harness-api.ts), shared by the
 * web Terminal panel (remote-terminal.ts) and its unit test
 * (web/test/pty-frames.test.js). Pure: no DOM, no socket.
 *
 * Frames, both directions, one JSON object per message:
 *   { type: "data",   data: string }          keystrokes → worker; output → page
 *   { type: "resize", cols: number, rows: number }   page → worker
 *   { type: "close" }                          page → worker (dispose); worker →
 *                                             page (the shell exited; `code?`)
 * Anything else is dropped by decode (null) so a newer server cannot break an
 * older page, and a corrupt message never throws into the stream.
 */

export type PtyFrame =
  | { type: "data"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "close"; code?: number };

export function encodePtyFrame(frame: PtyFrame): string {
  return JSON.stringify(frame);
}

export function dataFrame(data: string): string { return encodePtyFrame({ type: "data", data }); }
export function resizeFrame(cols: number, rows: number): string { return encodePtyFrame({ type: "resize", cols, rows }); }
export function closeFrame(): string { return encodePtyFrame({ type: "close" }); }

/** Decode one socket message; null for anything that is not a known frame. */
export function decodePtyFrame(raw: unknown): PtyFrame | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try { v = JSON.parse(raw); } catch { return null; }
  }
  if (!v || typeof v !== "object") return null;
  const f = v as { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown; code?: unknown };
  switch (f.type) {
    case "data":
      return typeof f.data === "string" ? { type: "data", data: f.data } : null;
    case "resize": {
      const cols = Number(f.cols), rows = Number(f.rows);
      return Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0 ? { type: "resize", cols, rows } : null;
    }
    case "close":
      return typeof f.code === "number" ? { type: "close", code: f.code } : { type: "close" };
    default:
      return null;
  }
}

/** The body of `POST /api/harness/pty` — what the worker needs to open a shell:
 *  its size, an optional working folder inside the workspace, and an optional
 *  program to start instead of the login shell (the CLI agent window). */
export interface PtyOpenBody { cols: number; rows: number; cwd?: string; command?: string }
export function ptyOpenBody(opts: { cols: number; rows: number; cwd?: string; command?: string }): PtyOpenBody {
  return {
    cols: Math.max(1, Math.floor(opts.cols)),
    rows: Math.max(1, Math.floor(opts.rows)),
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.command ? { command: opts.command } : {}),
  };
}
