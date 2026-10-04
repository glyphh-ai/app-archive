/**
 * schedule-store.ts — THE SYNC'S SIDE of the loop_schedules table (his rule,
 * 2026-10-04: "anything that could be local before is now a db row with cloud
 * storage"). A schedule is a member-library record of kind `schedule`:
 *
 *   id    the loop_schedules row id
 *   data  { name, cron, kind, target, agentId, ownerAgentId, args, enabled }
 *         — never the runs, never whether a job is armed on this machine
 *   clock the row's `updated_ms` (every local write stamps it), else the
 *         SQL created_at of a row written before the stamp existed
 *
 * The desktop's clock (local-library.ts) keeps reading the table; the sync
 * keeps the table in step with the server, so a schedule made on the web is
 * armed here within a sync interval, and one deleted there stops firing.
 *
 * Writes from the pages go through local-library.ts / local-agents.ts (they
 * stamp and announce); this module is only what a pull or a remote delete
 * needs — never announced back to the sync, since it came from there.
 */

import type { MemberLibraryItem } from "@glyphh/sdk";
import { getLocalDb } from "./local-db.js";
import { armSchedule, type ScheduleRow } from "./local-library.js";
import { readAgentRow } from "./local-agents.js";
import { buildScheduleData, isScheduleData, rowClock, type ScheduleDataLike } from "../shared/member-library.js";

/** A row's record: what rides, and nothing of the machine. */
export function scheduleRecordOf(r: ScheduleRow): ScheduleDataLike {
  let args: unknown = {};
  try { args = JSON.parse(r.args || "{}"); } catch { args = {}; }
  return buildScheduleData({
    name: r.name, cron: r.cron, kind: r.kind, target: r.target || r.loop_slug,
    agentId: r.agent_id || null, ownerAgentId: r.owner_agent_id || null, args, enabled: r.enabled === 1,
  });
}

/** Every schedule as the sync's local row. */
export function listScheduleRecords(): Array<{ id: string; updatedAt: number; data: ScheduleDataLike }> {
  const rows = getLocalDb().prepare("SELECT * FROM loop_schedules ORDER BY created_at").all() as ScheduleRow[];
  return rows.map((r) => ({ id: r.id, updatedAt: rowClock(r.updated_ms, r.created_at), data: scheduleRecordOf(r) }));
}

/** The server's record lands in the table at the server's clock and is armed
 *  (or parked: disabled, or owned by an agent that is not live here). */
export function applyRemoteSchedule(item: MemberLibraryItem): void {
  if (!isScheduleData(item.data)) throw new Error(`schedule ${item.id}: not a schedule record`);
  const data = buildScheduleData(item.data);
  const db = getLocalDb();
  const cur = db.prepare("SELECT * FROM loop_schedules WHERE id = ?").get(item.id) as ScheduleRow | undefined;
  // agent_id is the agent a skill reads through; an agent-owned task names its
  // owner there (local-agents.addAgentTask) when the record carries none.
  const agentId = data.agentId ?? data.ownerAgentId ?? cur?.agent_id ?? "";
  db.prepare(
    `INSERT INTO loop_schedules (id, agent_id, name, loop_slug, cron, enabled, created_at, owner_agent_id, kind, target, args, updated_ms)
     VALUES (@id, @agent_id, @name, @loop_slug, @cron, @enabled, @created_at, @owner_agent_id, @kind, @target, @args, @updated_ms)
     ON CONFLICT(id) DO UPDATE SET agent_id = excluded.agent_id, name = excluded.name, loop_slug = excluded.loop_slug, cron = excluded.cron,
       enabled = excluded.enabled, owner_agent_id = excluded.owner_agent_id, kind = excluded.kind, target = excluded.target,
       args = excluded.args, updated_ms = excluded.updated_ms`,
  ).run({
    id: item.id, agent_id: agentId, name: data.name, loop_slug: data.target, cron: data.cron,
    enabled: data.enabled ? 1 : 0, created_at: cur?.created_at ?? new Date(item.updatedAt).toISOString(),
    owner_agent_id: data.ownerAgentId, kind: data.kind, target: data.target, args: JSON.stringify(data.args ?? {}),
    updated_ms: item.updatedAt,
  });
  const row = db.prepare("SELECT * FROM loop_schedules WHERE id = ?").get(item.id) as ScheduleRow;
  const ownerLive = row.owner_agent_id ? readAgentRow(row.owner_agent_id)?.live !== false : true;
  armSchedule(ownerLive ? row : { ...row, enabled: 0 });
}

/** The server tombstoned it: the job stops, the row goes; its runs stay as history. */
export function removeScheduleLocal(id: string): void {
  const db = getLocalDb();
  const row = db.prepare("SELECT * FROM loop_schedules WHERE id = ?").get(String(id)) as ScheduleRow | undefined;
  if (row) armSchedule({ ...row, enabled: 0 });
  db.prepare("DELETE FROM loop_schedules WHERE id = ?").run(String(id));
}
