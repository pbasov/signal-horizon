// @ts-nocheck
import { describe, it, expect } from "vitest";
import { normalizeAction } from "./action-shape.mjs";

/**
 * SD-55 / AE-06 — every case here is a shape a real run actually emitted. The first live agent run
 * burned seven turns guessing whether the field key was target/name/field/id, which would have
 * landed in M8 and reported the harness's JSON dialect as the game's illegibility.
 */
describe("normalizeAction — the harness's dialect must not cost the agent turns", () => {
  const set = (raw) => normalizeAction(raw).action;

  it("keeps a correctly shaped action untouched", () => {
    const { action, shapeFixed } = normalizeAction({ do: "set", param: "altKm", value: 35786 });
    expect(action).toMatchObject({ do: "set", param: "altKm", value: 35786 });
    expect(shapeFixed).toBe(false);
  });
  it('accepts "target" for a field, the shape that cost the first run its turns', () => {
    expect(set({ do: "set", target: "altKm", value: "35786" })).toMatchObject({ param: "altKm", value: "35786" });
  });
  it("accepts name / field / id for a field", () => {
    for (const k of ["name", "field", "id"]) {
      expect(set({ do: "set", [k]: "incDeg", value: 62 })).toMatchObject({ param: "incDeg", value: 62 });
    }
  });
  it("accepts the field name AS the key", () => {
    expect(set({ do: "set", altKm: "35786" })).toMatchObject({ param: "altKm", value: "35786" });
  });
  it('accepts "altKm=35786" as one string', () => {
    expect(set({ do: "set", param: "altKm=35786" })).toMatchObject({ param: "altKm", value: "35786" });
  });
  it("strips a param- prefix the model copied off the CONTROLS list", () => {
    expect(set({ do: "set", param: "param-subLonDeg", value: 0 })).toMatchObject({ param: "subLonDeg" });
  });
  it("accepts target for a keypress, and press/type as verbs", () => {
    expect(set({ do: "key", target: "ArrowUp" })).toMatchObject({ do: "key", key: "ArrowUp" });
    expect(set({ do: "press", key: "L" })).toMatchObject({ do: "key", key: "L" });
    expect(set({ do: "type", target: "altKm", value: 1 })).toMatchObject({ do: "set", param: "altKm" });
  });
  it("accepts id / control / label for a click", () => {
    expect(set({ do: "click", id: "arm" })).toMatchObject({ do: "click", target: "arm" });
    expect(set({ do: "click", label: "text:SIGN" })).toMatchObject({ target: "text:SIGN" });
  });
  it("accepts minutes / duration for a wait, as a number", () => {
    expect(set({ do: "wait", minutes: "30" })).toMatchObject({ do: "wait", simMinutes: 30 });
  });
  it("reports a repair so it can be counted apart from a real affordance miss", () => {
    expect(normalizeAction({ do: "set", target: "altKm", value: 1 }).shapeFixed).toBe(true);
  });
  it("returns no action for a reply with nothing in it", () => {
    expect(normalizeAction(null).action).toBeNull();
    expect(normalizeAction({}).action.do).toBe("");
  });
});
