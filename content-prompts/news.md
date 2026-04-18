# Template: News Article (news)

## Format selection
Pick the single best format for the keyword/topic from the list below. Declare it as the first property in body_json as `"news_format"`. Choose exactly one:

| Format | When to use |
|---|---|
| `breaking` | New product launch, firmware update, company announcement, regulatory news |
| `research` | New study, clinical trial result, meta-analysis, expert review published |
| `roundup` | "Best of", "Week in", "X things to know" — aggregating multiple signals |
| `expert_reaction` | Industry expert commentary on a trend, study, or product |
| `data_brief` | Data-led angle — trending metrics, benchmark shifts, usage statistics |

## Universal rules
- Open with a 60-word max intro that leads with the news hook, not background.
- Use present-tense, active-voice reporting style. Avoid passive constructions.
- Lead with the most important fact, not context-building.
- Every factual claim must have an inline source (named study, publication, brand announcement, or expert).
- Include a mandatory verdict block with exactly 3 bullets in order:
  1) Best for: ...
  2) Avoid if: ...
  3) Bottom line: ...
- Include at least 3 FAQs targeting "what does this mean for X" style questions.
- Mandatory CTA context: ring + $1/mo newsletter + free protocol PDF.
- Include a "What we don't know yet" section covering unresolved limitations or missing data.
- All internal links MUST use markdown format: `[descriptive anchor text](/template/slug)`. Never use bare paths.
- Attribute claims to named experts, journals, brands, or published reports — never "experts say" without naming them.

## Format-specific requirements

### breaking
- Open sentence must name the brand/product and the announcement.
- Include a "What's new" definition_box section covering: what changed, firmware/version, price impact, availability date.
- Compare against the previous version or nearest competitor.
- End with a "Should you care?" paragraph that cuts through the marketing.

### research
- Lead with the specific finding (e.g. "A new randomized trial of 142 recreational athletes found...").
- Include a "Study at a glance" definition_box: journal, sample size, duration, methodology.
- Explain limitations — sample size, funding source, generalizability.
- Translate findings into practical action for the reader.
- Minimum 2 references: the study itself + a corroborating or contrasting source.

### roundup
- Use a numbered list structure for the main body.
- Each item must include: what it is, why it matters this week/month, and a verdict.
- Link each item to a relevant internal page where one exists.
- End with an "Editor's pick" callout block identifying the single most important item.

### expert_reaction
- Name the expert in the first sentence with credentials (e.g. "Dr. Emily Torres, CSCS, head of performance at USOC...").
- Use direct quotes where available; paraphrase only when necessary with attribution.
- Present a counter-view or nuance from a second source.
- Include a "What this means for your training" practical takeaway section.

### data_brief
- Lead with the headline number (e.g. "HRV variability in recreational athletes dropped 18%...").
- Include a data_table section with the key figures.
- Explain the methodology behind the data (where it came from, how it was collected).
- Contextualise against historical baseline or benchmarks.
- Include a "So what?" section converting the data into actionable guidance.

## Newsroom context usage

When `newsroom_context` is provided in the generation payload, you MUST use it — it is your primary source of truth for this article.

### source_events
Each object in `newsroom_context.source_events` is a verified news signal. Use them as primary citations:
- Reference the event's `headline` or `summary` as the news hook.
- Cite the `source_url` or `source_name` inline (e.g. "According to [source_name], …").
- Use the `published_at` date to establish recency ("Published [date], …").
- Do NOT invent additional sources not present in `source_events` unless you can cite a named publication.

### storyline
`newsroom_context.storyline` provides the ongoing story thread this article belongs to:
- Use `storyline.title` and `storyline.summary` to frame the article's broader context.
- Reference the storyline to show how this development fits into a larger trend.
- Use `storyline.key_entities` to ensure consistent entity naming throughout.

### entities
`newsroom_context.entities` contains named organisations, products, and people relevant to this topic:
- Use exact entity names (brand capitalisation, official product names) as they appear in the entities list.
- When attributing claims, prefer entity names from this list over generic descriptions.
- Cross-link entities where relevant (e.g. a product entity to its company entity).

### Priority rule
`newsroom_context` > your training knowledge > general knowledge. If the context contradicts your priors, trust the context — it is more recent.

## Metadata requirement
The JSON output root MUST include:
```json
{ "metadata": { "news_format": "breaking|research|roundup|expert_reaction|data_brief", "published_date": "YYYY-MM-DD" } }
```
