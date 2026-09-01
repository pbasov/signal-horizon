// @ts-nocheck
import { describe, it, expect } from "vitest";
import { extractJson } from "./brain.mjs";

/** SD-55 / AE-05 — the reply parser is the one place a brain turn can silently become a lost turn. */
describe("extractJson — a reply is a reply however the model dressed it", () => {
  it("reads a bare object", () => {
    expect(extractJson('{"read":"a","action":{"do":"wait","simMinutes":5}}').action.do).toBe("wait");
  });
  it("reads it out of a fenced block", () => {
    expect(extractJson('```json\n{"a":1}\n```').a).toBe(1);
  });
  it("reads it out of surrounding prose", () => {
    expect(extractJson('Sure — here is my move:\n{"a":2}\nHope that helps.').a).toBe(2);
  });
  it("survives braces inside strings", () => {
    expect(extractJson('{"read":"it said {press this}","a":3}').a).toBe(3);
  });
  it("survives escaped quotes inside strings", () => {
    expect(extractJson('{"read":"the label is \\"SIGN\\"","a":4}').a).toBe(4);
  });
  it("returns null for a reply with no object, so the caller can repair instead of guessing", () => {
    expect(extractJson("I am not sure what to do here.")).toBeNull();
    expect(extractJson("")).toBeNull();
    expect(extractJson("{ this is not json ")).toBeNull();
  });
});
