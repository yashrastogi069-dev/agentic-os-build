# Lessons — self-improvement log (Jarvis build)

Rules written after user corrections. Read this file at the start of every work
iteration. Add a new entry after ANY correction from Yash.

## 2026-07-08

1. **Pause for approval after planning.** Yash interrupted a run to say "after
   planning pause for my approval." Never roll from plan into execution without
   an explicit go-ahead. Plans are reviewed by Yash before code is written.

2. **Don't assume — ask.** Standing instruction. When a requirement is
   ambiguous (scope words, project names, branch intent), ask a pointed
   question instead of picking an interpretation. Guessing costs more than the
   round-trip.

3. **Keep BOTH the Arc Reactor and the neural network.** Earlier plan framing
   implied merging them into one centerpiece. Wrong: two distinct elements —
   a neural network center stage that drives OS colors, and a dynamic
   interactive Arc Reactor you can talk to.

4. **Model routing is a hard rule.** Fable 5 (high effort) = planner/advisor;
   every plan goes to Yash for review. Opus/Sonnet (xhigh) = executors; after
   each completed chunk, the work goes back to Fable for advisory review.
   Set model + effort explicitly on every subagent call.

5. **Verification before done.** Never mark a task complete without
   demonstrating it works: run it, screenshot it, check logs, diff against the
   base branch. "Would a senior engineer approve this?" is the bar.

6. **One task per subagent.** Offload research/exploration/parallel analysis;
   keep the main thread for decisions and synthesis.

7. **Model routing (refined by Yash 2026-07-08, tightened 2026-07-09):**
   Fable = planning, advisory reviews, and the MOST IMPORTANT tasks. Opus =
   complex execution only. Sonnet = standard feature execution. Haiku = ALL
   small work: md/doc updates, state-file maintenance, renames, any small
   read/write chore (Yash's final rule, superseding the earlier "sonnet does
   small things" note: "use small models to update md files or to do any
   small work read and write or any small work use haiku"). Never bundle doc
   chores into an Opus or Sonnet executor's scope — route them to Haiku
   separately. Design skills (ui-ux-pro-max, impeccable, taste,
   emilkowal-animations) must be applied in all UI phases.

8. **Phases 3 and 6 run via Workflow with effort:'xhigh'** (Yash-approved
   2026-07-09). The Agent tool cannot set per-agent effort (inherits session
   high); Workflow's agent() can. Use Workflow orchestration for the two
   heavyweight phases — Phase 3 (neural core + Arc Reactor + theme engine)
   and Phase 6 (streaming voice) — with Opus executors pinned to xhigh.

9. **Keep advisory reviews lean.** The Phase 0 Fable reviewer was stopped
   mid-run (usage limits are real on this plan). Front-load the verdict, keep
   review scope tight, and let executors self-serve code-level detail from
   PLAN.md instead of re-deriving it in review agents.

10. **Yash's standing design standards outrank convenience recommendations.**
   Fable recommended keeping lucide to save migration cost; Yash overrode to
   Phosphor (his cross-project icon standard). When a standing user policy
   exists, default to it in recommendations rather than optimizing for least
   effort.

11. **Batch verification, keep momentum (Yash 2026-07-09, during Phase 1).**
    Yash stopped a mid-phase verification probe: complete 2-3 phases of major
    work first, then do the review/verification pass midway or at the end —
    don't stall a run on exhaustive per-phase probing. Record exactly which
    checks were deferred in JARVIS_BUILD_STATE.md so the batched review pass
    can pick them up. Executor conversations should run Opus (high).
