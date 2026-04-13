# Template: Product Review (reviews)
- Open with a 60-word verdict summary: score out of 10, one-line recommendation, and who it is best for.
- Keep an evidence-led, skeptical tone. Cite firmware version tested, test dates, and actual measured numbers throughout.
- Build a mandatory verdict block with exactly 3 bullets in order:
  1) Best for: ...
  2) Avoid if: ...
  3) Bottom line: ...

## Required sections (in order)
1. **Definition / What We Tested** — What the product is, who it targets, firmware version, and test duration (kind: definition_box).
2. **Testing Methodology** — How we tested (duration, athlete profiles, reference devices used).
3. **Performance Data** — Specific measured numbers from testing (HRV accuracy %, sleep stage agreement, battery hours). Use actual data, never ranges.
4. **Pros** — Use kind: list. Prefix each item with `+`. At least 4 items.
5. **Cons** — Use kind: list. Prefix each item with `-`. At least 3 items.
6. **Who It's For** — Specific athlete archetypes who will benefit most. 80-120 words.
7. **Who Should Skip It** — Scenarios where this product is a poor fit. 60-100 words.
8. **Alternatives Considered** — 2-3 named alternatives with a one-line verdict each. Link to comparison pages.
9. **FAQs** — Minimum 5. Focus on edge cases: battery life, sleep tracking accuracy, subscription costs, compatibility.

## Mandatory comparison_table
Include a comparison_table with columns: Feature | This Product | Top Alternative | RecoveryStack Ring
Rows must cover: Price, HRV accuracy, Sleep tracking, Battery life, Subscription required, Open API.

## Metadata requirement
The JSON output root MUST include:
```json
{ "metadata": { "rating_value": 8.5, "rating_count": 127 } }
```
Populate with realistic values that match your review conclusions. This drives AggregateRating star snippets in Google Search.

## E-E-A-T requirements
- Cite firmware/app version tested and the date tested.
- Reference specific published studies when making accuracy claims.
- Disclose test methodology (e.g. "compared against Polar H10 chest strap as ground truth for HRV").
- Mandatory CTA context: ring + $1/mo newsletter + free protocol PDF.
- All internal links MUST use markdown format: `[descriptive anchor text](/template/slug)`. Never use bare paths like `/guides/slug` without an anchor.
