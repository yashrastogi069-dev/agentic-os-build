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

7. **Model routing (refined by Yash 2026-07-08):** Fable = planning, advisory
   reviews, and the MOST IMPORTANT tasks. Opus = complex execution. Sonnet =
   standard execution. Haiku = small mechanical tasks (icon swaps, doc
   updates, renames). Shift model + effort per task, don't burn big models on
   small work. Design skills (ui-ux-pro-max, impeccable, taste,
   emilkowal-animations) must be applied in all UI phases.

8. **Yash's standing design standards outrank convenience recommendations.**
   Fable recommended keeping lucide to save migration cost; Yash overrode to
   Phosphor (his cross-project icon standard). When a standing user policy
   exists, default to it in recommendations rather than optimizing for least
   effort.
