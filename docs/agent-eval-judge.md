# AGENT-EVAL — THE BLIND JUDGE RUBRIC
### v1.0 · 2026-09-01 · pre-registered · NOT YET BUILT (gated — see `agent-eval.md` §9)

> This rubric is written before the first run so it cannot be shaped by a result. It is deliberately
> **unbuilt**: the deterministic half (`agent-eval-metrics.md`) ships first, and the judge is
> constructed only when we hold a legibility question that matters and the action log provably cannot
> answer. Nothing that reads a judge verdict may gate a build until §4's calibration passes.

---

## 1. The information-withholding protocol — structural, not requested

The judge receives exactly two things:

1. `observations.jsonl` — the design-free observation stream the agent saw, verbatim.
2. The agent's own utterances (its per-turn reasoning and intent strings) and the end-of-run debrief.

The judge never receives: the GDD, the M1 spec, `m1-redesign.md`, this rubric's *rationale* column,
the golden path, the design laws, the act script, or any metric value. Preference leakage
(arXiv:2502.01534) is subtler and harder to detect than position or verbosity bias, so the boundary
is enforced by what the bundle hands over, not by instructing the judge to ignore things.

The agent seat is already blind by construction (`--tools ""`, no filesystem). The judge must be made
blind by assembly.

---

## 2. The questions — atomic, binary, quote-bound

Coarse yes/no criteria with mandatory evidence reach near-human agreement where Likert scales do not;
LLM judges struggle to make fine-grained distinctions on wide scales. So: no scales anywhere. Each
answer requires a verbatim quote from the transcript **before** the verdict, and a judgement that
cannot cite is recorded as `NO EVIDENCE`, which is a distinct third value — never silently a NO.

```
INPUT: { observation_stream, agent_utterances }     # nothing else
For each question: reason briefly, quote the single grounding observation or utterance, then answer.

Q1  Did the player state, in their own words, what the current goal was?
Q2  Did the player attribute an escalation to their own prior success, rather than to the game
    announcing it?                                              # GDD §9 claim 2
Q3  Did the player ever act solely because on-screen text imperatively told them to?
                                                                # instruction-leak; LAW 2 residue
Q4  Did the player correctly identify the binding constraint before acting on it?
Q5  Did the player explain the consolidate-vs-split trade-off before choosing?
Q6  Did the player name a specific system when asked what they would do differently?
                                                                # GDD §9 claim 1 (specificity)
Q7  Did the player self-correct after a failed beat, rather than repeating the same action?
Q8  Did the player reach a working state without opening any diagnostic instrument?
                                                                # GDD §9 claim 4 (novice floor)

OUTPUT: strict JSON — { "q1": {"quote": "...", "verdict": "YES|NO|NO EVIDENCE"}, ..., "notes": "..." }
TEMPERATURE 0.0 with a pinned model VERSION for any gate; 3-sample majority only for reporting.
```

**Q3 is the load-bearing one.** It is the semantic complement of the `literalist` persona: the
persona tests whether imperative copy is *sufficient* to play, the question tests whether it was
*used*. If either fires, LAW 2 leaked.

---

## 3. Bias controls, with the effect sizes they answer

- **Reference-free single-transcript grading**, never pairwise. Position bias in pairwise judging runs
  10–15 points; declining to do pairwise removes the failure mode instead of averaging it away.
- **Judge family ≠ agent family** where any comparative claim is at stake; self-preference runs
  10–25%. The pairing is recorded in `run.json` as a confound regardless.
- **Reason before verdict**, and cite. "One token to fool an LLM judge" (arXiv:2507.08794) is why the
  quote is mandatory rather than encouraged.
- **Ensemble only across families.** Re-running one model nine times is nine correlated trials worth
  about two effective votes (arXiv:2605.29800); a same-model ensemble is a false comfort.
- **Comprehension is scored separately from outcome.** The Success Paradox (arXiv:2606.07805) is
  judges rewarding completion regardless of process — here an agent that succeeded *while misreading
  the screen* must score NO on Q4 and still be recorded as having completed. Never one blended number.
- **Verdict-order randomisation** in the prompt, and no metric values in context, so the judge cannot
  anchor on a number the deterministic half already produced.

---

## 4. Calibration gate — the judge does not ship until this passes

1. Hand-label 100–150 transcripts drawn from real runs, two annotators, per-question.
2. **Inter-annotator Cohen's κ first.** Below 0.4 the rubric is ambiguous — fix the rubric, not the
   judge. 0.4–0.6 tunable. Ship at ≥ 0.6.
3. Then **judge-to-human κ**; rework below 0.5.
4. **κ, not raw agreement.** A judge that always answers YES scores ~90% raw and κ≈0 on a 90%-YES
   set, and legibility questions are exactly that imbalanced.
5. **Pin the judge model version as an artifact.** Judge rankings shift by up to 14 positions across
   benchmarks and a minor version bump silently moves means (arXiv:2606.19544) — so any version change
   re-runs the calibration set before the gate is trusted again.

---

## 5. Standing limits on what a verdict may be used for

- A verdict is a **lead for human playtesting**. It never passes or fails the M1 gate, which is five
  cold humans and the user's to run (GDD §9).
- Judge output may never be aggregated into a single "legibility score". Per-question verdicts only.
- Judge reliability on interactive *game* transcripts is under-studied — the near-human κ figures come
  from tool-use agent traces, which is adjacent, not identical. Our own calibration set is the
  authority; the literature is the prior.
