/**
 * cron-words.ts — a five-field cron in words ("weekdays at 9:00am"), for the
 * schedule buttons on a skill or a super power. Anything it cannot read comes
 * back as the cron itself.
 */

export function cronToWords(cron: string): string {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return cron;
  const [m, h, dom, , dow] = p as [string, string, string, string, string];
  const em = /^\*\/(\d+)$/.exec(m);
  if (em && h === "*") return `every ${em[1]} minutes`;
  if (m === "0" && h === "*") return "every hour";
  if (!/^\d+$/.test(m) || !/^\d+$/.test(h)) return cron;
  const hh = parseInt(h, 10);
  const time = `${hh % 12 || 12}:${m.padStart(2, "0")}${hh < 12 ? "am" : "pm"}`;
  if (/^\d+$/.test(dom)) return `monthly on the ${dom}, at ${time}`;
  if (dow === "1-5") return `weekdays at ${time}`;
  if (dow === "0,6") return `weekends at ${time}`;
  if (dow === "*") return `every day at ${time}`;
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const listed = dow.split(",").map((d) => names[parseInt(d, 10)]).filter(Boolean);
  return listed.length ? `every ${listed.join(", ")} at ${time}` : cron;
}
