/**
 * The super power map's layout (his order, 2026-10-09: "a react flow esc view
 * of a super power… the super power icon in the center"): pure positions for
 * the centre, every node, the group labels and the edges.
 */
import { describe, it, expect } from "vitest";
import { edgePath, layoutPowerMap, MAP_SIDES, NODE_W, type PowerMapModel } from "../../src/renderer/help/power-map";

const n = (name: string, extra: Partial<PowerMapModel["groups"][number]["nodes"][number]> = {}) => ({ stored: name, name, sub: "", icon: "", ...extra });
const model = (over: Partial<Record<"connections" | "folders" | "skills" | "models", ReturnType<typeof n>[]>> = {}): PowerMapModel => ({
  center: { name: "Video Marketer", face: "<svg/>" },
  groups: [
    { kind: "connections", label: "Connections", nodes: over.connections ?? [] },
    { kind: "folders", label: "Folders", nodes: over.folders ?? [] },
    { kind: "skills", label: "Powers", nodes: over.skills ?? [] },
    { kind: "models", label: "Models", nodes: over.models ?? [] },
  ],
});

describe("the super power map's layout", () => {
  it("connections and folders sit left of the centre; powers and models right", () => {
    expect(MAP_SIDES).toEqual({ connections: "left", folders: "left", superPowers: "left", skills: "right", models: "right" });
    const L = layoutPowerMap(model({ connections: [n("youtube")], folders: [n("videos")], skills: [n("clips")], models: [n("gemini")] }));
    for (const node of L.nodes) {
      if (node.kind === "connections" || node.kind === "folders" || node.kind === "superPowers") expect(node.x + node.w).toBeLessThan(L.center.x - L.center.r);
      else expect(node.x).toBeGreaterThan(L.center.x + L.center.r);
    }
    expect(L.labels.map((l) => l.label)).toEqual(["Connections", "Folders", "Powers", "Models"]);
  });

  it("every node is joined to the centre, and nothing overlaps in its column", () => {
    const L = layoutPowerMap(model({ skills: [n("a"), n("b"), n("c")], models: [n("m1"), n("m2")] }));
    expect(L.edges.filter((e) => e.from === "center")).toHaveLength(5);
    const right = L.nodes.filter((x) => x.kind !== "flow").sort((a, b) => a.y - b.y);
    for (let i = 1; i < right.length; i++) expect(right[i]!.y).toBeGreaterThanOrEqual(right[i - 1]!.y + right[i - 1]!.h);
    for (const node of L.nodes) {
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y + node.h).toBeLessThanOrEqual(L.height);
      expect(node.x + node.w).toBeLessThanOrEqual(L.width);
    }
  });

  it("a power that runs on its own trails its flow, chained left to right", () => {
    const L = layoutPowerMap(model({ skills: [n("digest", { flow: [{ name: "Weekdays at 9", sub: "", icon: "" }, { name: "Writer", sub: "", icon: "" }] })] }));
    const power = L.nodes.find((x) => x.kind === "skills")!;
    const flow = L.nodes.filter((x) => x.kind === "flow");
    expect(flow).toHaveLength(2);
    expect(flow[0]!.x).toBeGreaterThan(power.x + NODE_W);
    expect(flow[1]!.x).toBeGreaterThan(flow[0]!.x + flow[0]!.w);
    expect(L.edges.filter((e) => e.kind === "flow").map((e) => [e.from, e.to])).toEqual([[power.id, flow[0]!.id], [flow[0]!.id, flow[1]!.id]]);
  });

  it("an empty super power is the centre alone, and empty groups take no room", () => {
    const L = layoutPowerMap(model());
    expect(L.nodes).toEqual([]);
    expect(L.labels).toEqual([]);
    expect(L.center.r).toBeGreaterThan(0);
  });

  it("an edge is a smooth curve between the two handles", () => {
    expect(edgePath(0, 0, 100, 50)).toBe("M0,0 C50,0 50,50 100,50");
    expect(edgePath(100, 0, 0, 50).startsWith("M100,0 C50,0")).toBe(true);
  });
});

describe("the member's own arrangement (his order, 2026-10-09)", () => {
  it("cards carry a key from what they stand for, not their place in a list", () => {
    const L = layoutPowerMap(model({ skills: [n("clips", { flow: [{ name: "9am", sub: "", icon: "" }] })], models: [n("gemini")] }));
    expect(L.nodes.map((x) => x.key).sort()).toEqual(["models:gemini", "skills:clips", "skills:clips:flow:0"]);
  });
  it("saved positions win, card by card, and the canvas grows to hold them", async () => {
    const { applyLayout, CENTER_KEY } = await import("../../src/renderer/help/power-map");
    const L = layoutPowerMap(model({ skills: [n("clips")], models: [n("gemini")] }));
    const moved = applyLayout(L, { "skills:clips": { x: 2000, y: 900 }, [CENTER_KEY]: { x: 300, y: 200 } });
    expect(moved.nodes.find((x) => x.key === "skills:clips")).toMatchObject({ x: 2000, y: 900 });
    expect(moved.nodes.find((x) => x.key === "models:gemini")).toMatchObject({ x: L.nodes.find((x) => x.key === "models:gemini")!.x });
    expect(moved.center).toMatchObject({ x: 300, y: 200 });
    expect(moved.width).toBeGreaterThan(2000);
    expect(moved.height).toBeGreaterThan(900);
    expect(applyLayout(L, {})).toBe(L);
  });
});
