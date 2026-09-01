/**
 * SD-60 — THE CAST. Pins the rules the setting/beats docs set for the narrative layer, so the
 * story cannot quietly grow teeth it is not allowed to have.
 *
 * The load-bearing claim under test: **the fiction is inert.** Every scenario tender carries a
 * client whose copy resolves, and a contract WITHOUT a client degrades to nothing shown — never
 * to a crash, a placeholder, or an empty row. A player who reads none of it loses nothing.
 */

// @ts-nocheck — node imports are fine under vitest; the browser tsconfig has no node types.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CLIENTS, clientName, clientReason } from "./clients";
import { Ephemeris } from "../sim/ephemeris";
import { NetSession } from "../sim/net/session";
import { offerNetContract, renewalOffer } from "../sim/net/contract";
import { NET_ACT1_REGION } from "../sim/net/endpoint";
import { DT } from "../sim/clock";

describe("SD-60 — the cast resolves", () => {
  it("every client has a name and a reason", () => {
    for (const [id, v] of Object.entries(CLIENTS)) {
      expect(v.name, id).toBeTruthy();
      expect(v.reason, id).toBeTruthy();
    }
  });

  it("an unknown client degrades to empty, never to a placeholder", () => {
    expect(clientName("")).toBe("");
    expect(clientReason("")).toBe("");
    expect(clientName("nobody-of-record")).toBe("");
    expect(clientReason("nobody-of-record")).toBe("");
  });

  it("a contract offered without a client carries no client", () => {
    const c = offerNetContract("T", NET_ACT1_REGION);
    expect(c.clientId).toBe("");
    expect(clientName(c.clientId)).toBe("");
  });
});

describe("SD-60 — the reason lines obey the beats rules", () => {
  const lines = Object.entries(CLIENTS);

  it("never state the number (the card already does)", () => {
    // Beats §4: "Never states the number — the card already does." A digit in a reason line
    // means the copy is duplicating an instrument, which is how flavour turns into a rule.
    // Spelled-out quantities ("eleven people", "sixty-two north") are the world, not the SLA.
    for (const [id, v] of lines) expect(v.reason, id).not.toMatch(/\d/);
  });

  it("never advise and never thank", () => {
    for (const [id, v] of lines) {
      expect(v.reason.toLowerCase(), id).not.toMatch(/\bthank|\bplease\b|\byou should\b|\bmake sure\b/);
    }
  });

  it("are one line each", () => {
    for (const [id, v] of lines) expect(v.reason.includes("\n"), id).toBe(false);
  });
});

describe("SD-60 — the scenario tenders are cast", () => {
  it("the Act-1 opener names its customer", () => {
    const s = new NetSession();
    s.step(Ephemeris.build({}), DT, DT); // the act1 beat emits at t≈0
    const offered = s.contracts.filter((c) => c.state === "offered");
    expect(offered.length).toBeGreaterThan(0);
    for (const c of offered) {
      expect(c.clientId, c.id).not.toBe("");
      expect(clientName(c.clientId), c.id).not.toBe("");
      expect(clientReason(c.clientId), c.id).not.toBe("");
    }
  });

  it("every clientId the scenario table uses resolves to real copy", () => {
    // The failure this catches: a typo'd key degrades SILENTLY to "" (by design — absent copy
    // must never crash), so a mis-cast tender would just quietly lose its voice and no other
    // test would notice. Read the scenario source and check every key it hands out.
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../sim/net/scenario.ts"), "utf8");
    const used = [...src.matchAll(/clientId:\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThanOrEqual(5); // the five authored tenders
    for (const id of used) {
      expect(CLIENTS[id], `scenario.ts uses clientId "${id}" with no entry in CLIENTS`).toBeDefined();
    }
    // And the other direction: EVERY authored tender must be cast. Without this, a new tender
    // added by unrelated work renders anonymous and nothing complains — the exact gap a rebase
    // over main's board-becomes-a-map work could have opened.
    const offers = [...src.matchAll(/offerNetContract\(/g)].length;
    expect(used.length, `${offers} authored tenders but only ${used.length} carry a client`).toBe(offers);
  });

  it("a renewal keeps the same customer (recurrence does the worldbuilding)", () => {
    const base = offerNetContract("R", NET_ACT1_REGION, { clientId: "halden" });
    const renewed = renewalOffer(base, 1, 100);
    expect(renewed.clientId).toBe("halden");
    expect(clientName(renewed.clientId)).toBe(clientName("halden"));
  });
});
