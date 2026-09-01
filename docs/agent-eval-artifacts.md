# AGENT-EVAL — THE ARTIFACT BUNDLE
### v1.0 · 2026-09-01 · one directory per run, gitignored, self-describing

`tools/agent-eval/runs/<build>/<persona>/<seed>/`

| File | Contents |
|---|---|
| `run.json` | the run key + termination + baselines pointer (schema below) |
| `actions.jsonl` | the sim's own ordered `SimAction` log, `{kind, at_tick, payload}` — replayable, the crown jewel |
| `transcript.jsonl` | every brain request and response, with usage, cost, latency_ms, session id |
| `observations.jsonl` | the design-free observation stream — **the only file the judge is ever given** |
| `probes.jsonl` | per-turn `__netState` / `__trace` / `__regionProbe` snapshots |
| `metrics.json` | the deterministic metrics (`agent-eval-metrics.md`) |
| `verdicts.json` | judge verdicts + quotes + votes (absent until the judge is built) |
| `shots/NN-<tag>.png` | a frame per turn, for the human reading the bundle |
| `report.md` | the rendered read: metrics table with baselines, the turn-by-turn intent trail, findings |

```json
{
  "key": { "build_hash": "", "seed": 0, "model_id": "", "model_version": "",
           "params_hash": "", "prompt_version": "", "persona": "", "clock_mode": "PDQ" },
  "clock": { "mode": "PDQ", "injected_latency_ms_total": 0, "sim_seconds_elapsed": 0 },
  "budgets": { "max_turns": 40, "max_wall_ms": 1200000, "max_usd": 2.0 },
  "spend":   { "turns": 0, "wall_ms": 0, "usd": 0.0 },
  "termination": { "reason": "complete|stall|budget|error", "gate": null, "stalls": 0 },
  "baselines": { "random": "fuzz", "scripted": "act1,hour", "human": "not measured" }
}
```

**Rules.** `observations.jsonl` is written by the same code path that feeds the brain, so the judge
provably reads what the agent read. `prompt_version` is `sha256(persona file + observation schema
version)`, so a prompt edit can never present as a build regression. On failure the driver exits
nonzero and `termination` names which budget or gate fired.
