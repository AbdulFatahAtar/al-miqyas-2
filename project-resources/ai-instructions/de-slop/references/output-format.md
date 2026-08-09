# De-Slop output format (canonical)

Every run renders in this exact shape. Do not deviate. The skill detects and suggests. It never rewrites or edits the output.

## Shape

1. **A big verdict title** (`#` heading) so the user knows the result at a glance. One of three states:
   - `# ✅ Good to go` — all fired checks green.
   - `# ✅⚠️ Good to go, with a few things you might want to fix` — only ⚠️ drift, no blockers.
   - `# ❌ Not ready` — any blocker / hard cross.
2. **One short line** under the title summarizing the situation. On a fully clean run, this line is optional.
3. **One table, every fired check shown** (greens included), columns in this order:

| Column | What goes in it |
|--------|-----------------|
| Check | The check name. |
| Status | Icon + words: ✅ Good to go / ⚠️ Might wanna fix / ❌ Not ready. |
| What's off | Short and plain. `—` if the row is green. |
| Source | The specific governing doc, not a generic tag (see mapping below). |
| Suggestion | Generic, awareness-level advice for the judgment checks. For the mechanical checks, quote the exact offending span. `—` if green. |

Nothing else. No header box, no "improved version," no "suggested changes" list, no apply prompt.

## Source column mapping

Name the real standard, not a generic label.

| Check | Source shown |
|-------|--------------|
| AI writing tells | Signs of AI writing (humanizer standard) |
| Factual accuracy | World-truth / fact-checker |
| Consistency | Internal coherence |
| Artifacts | Universal slop standard |
| Readability | Universal readability standard |
| Voice | `brand.md` / `voice.md` |
| Company fit | `organization.md` / `strategy.md` / `icp.md` |
| Completeness | The ask |
| Visual | `visual.md` (design system) |

## Suggestion column: two tiers

- **Mechanical checks** (AI writing tells, Artifacts, Readability) — quote the exact offending span so the user sees precisely what to touch. e.g. for Readability, put the actual run-on sentence in the cell.
- **Judgment checks** (Factual accuracy, Consistency, Voice, Company fit, Completeness, Visual) — generic, awareness-level advice. Point at the kind of problem, not a line-edit.

## Canonical example (copy, external, support)

This is the reference render. Match its tone and density.

```
# ✅⚠️ Good to go, with a few things you might want to fix

No blockers. Voice is on and nothing's false about the company. The drift is missing pieces of the ask plus one made-up number.

| Check | Status | What's off | Source | Suggestion |
|-------|--------|-----------|--------|-----------|
| AI writing tells | ✅ Good to go | Clean. No tells, no em dashes. | Signs of AI writing | — |
| Factual accuracy | ⚠️ Might wanna fix | "1-2% of daily Max usage" is an invented metric; "in one pass" implies no setup. | World-truth / fact-checker | Drop precise numbers you can't back up; soften to a general claim. |
| Consistency | ✅ Good to go | Architecture holds start to finish. | Internal coherence | — |
| Artifacts | ✅ Good to go | Nothing stray. | Universal slop standard | — |
| Readability | ⚠️ Might wanna fix | A run-on and a comma splice. | Universal readability standard | Split: "...a qualification layer which matches your standard of a valuable piece of content that fits your personal brand + linkedIn strategy and also has an angle that could resonate with your ICP." And fix the splice: "...runs on a schedule for this, In my experience, shouldn't burn..." |
| Voice | ⚠️ Might wanna fix | One hedge ("technically"). | brand.md / voice.md | Cut hedges; you give direct calls. |
| Company fit | ✅ Good to go | Stays in the enablement lane, no hype. | organization.md / strategy.md / icp.md | — |
| Completeness | ⚠️ Might wanna fix | Skips her time window, her Playwright install, and 2 of her 3 named tools. | The ask | Scan the original question and make sure each named thing gets a line. |
```

## Rules baked into the format

- The skill flags and suggests. It never edits, rewrites, or applies. The human (or another skill) owns the fix.
- A suggestion can be large when something is fundamentally wrong. The scope limit is on ownership of the fix, not the size of the suggestion.
- A clean `# ✅ Good to go` run is normal: the title and the all-green table, no caveat line needed.
