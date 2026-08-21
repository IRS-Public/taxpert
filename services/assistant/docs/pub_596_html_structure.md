# HTML Structure Evaluation — `data/html/pub_596.html`

How IRS Publication 596 (*Earned Income Credit*) is marked up, and how the RAG
indexer (`src/rag/indexer.py`) exploits that structure to produce
section-aligned embeddings. Written to justify the parsing choices and to guide
anyone adding a new IRS HTML source.

> **Bottom line:** the page is a server-rendered Drupal ("barrio" theme)
> document with a clean, machine-readable outline encoded in heading **role
> classes** — not in the `h1`–`h6` tag numbers. Parsing that outline (rather
> than raw tags or raw text) is what lets us turn a 1.2 MB page into ~77
> topical chunks instead of hundreds of fragments.

---

## 1. File at a glance

| Metric | Value |
|---|---|
| File size | ~1.2 MB (22,948 lines) |
| Total text | ~216,000 chars |
| Article text | ~210,000 chars (97% of the text is the publication itself) |
| `<table>` elements | 8 |
| `<nav>` elements | 8 (site chrome) |
| Language-switcher blocks | 4 |
| Accessibility nav labels (`h2.visually-hidden`) | 7 |
| Accordion headers (footer help menus) | 6 |

The page is one IRS publication wrapped in a standard agency template. The
template contributes most of the *element* count but almost none of the useful
*text*.

---

## 2. The content container

The publication body is a Drupal field. Three `div.field--name-body` elements
exist; **two are 80-char stubs** (summary/teaser copies) and **one holds the
full 210 KB** of prose:

```
field--name-body divs: [80, 80, 210321]
```

The real article also appears as:

```html
<article about="/publications/p596"
         class="node node--type-pup-xmlbc node--view-mode-full clearfix">
```

**Indexer choice** (`_select_content_root`): pick the **largest**
`div.field--name-body`; fall back to `<article>` → `<main>` → `<body>` for
non-IRS HTML. Selecting the largest body div is what removes the surrounding
nav, breadcrumbs, language switcher, and footer in one step — they live outside
this div, so no element-by-element blocklist is needed.

---

## 3. Heading taxonomy — the load-bearing structure

Every heading carries a semantic `role-*` class. The `h`-number is **not** a
reliable depth signal; the class is. Counts across the document:

| Tag + class | Count | Logical role | Example |
|---|---|---|---|
| `h1.title` | 3 | publication / part title | *Publication 596 (2025)…* |
| `h2.title.role-chap` | 6 | **chapter** | *1. Rules for Everyone* |
| `h3.title.role-highlight` | 10 | intro Q&A | *What Is the EIC?* |
| `h3.title.worksheet` | 3 | worksheet | *Worksheet 1. Investment Income* |
| `h4.title.role-hd1` | 24 | **rule / main subsection** | *Rule 7—You Must Have Earned Income* |
| `h4.title.role-hd2` | 11 | sub-topic | *Earned Income* |
| `h4.title.role-hd3` | 4 | sub-sub-topic | *How Can TAS Help Me?* |
| `h6.title.role-figure` | 1 | figure caption | *Figure A. Tests for Qualifying Child* |

### The critical detail

The document's **most useful retrieval units — the 15 numbered Rules — are
`h4`s** (`role-hd1`), and their sub-topics (*Earned Income*, *Disability
Benefits*, …) are **also `h4`s** (`role-hd2`). A parser that ranks depth by tag
number sees them as siblings; a parser that reads the role class sees the
correct nesting:

```
2. Rules if You Have a Qualifying Child        (h2.role-chap   → depth 1)
└─ Rule 8—Your Child Must Meet…                (h4.role-hd1    → depth 2)
   ├─ Relationship Test                        (h4.role-hd2    → depth 3)
   ├─ Age Test                                 (h4.role-hd2    → depth 3)
   └─ Residency Test                           (h4.role-hd2    → depth 3)
```

**Indexer choice** (`_ROLE_DEPTH`, `_heading_depth`): map role class → logical
depth, falling back to the `h`-number only for unclassed headings.

```python
_ROLE_DEPTH = {
    "role-chap": 1, "role-highlight": 1, "worksheet": 2,
    "role-hd1": 2, "role-hd2": 3, "role-hd3": 4,
}
```

`worksheet` is deliberately depth **2** (not 1): worksheets are interleaved
*beside* Rules within a chapter, so giving them depth 1 would wrongly evict the
chapter from the breadcrumb (e.g. producing `Worksheet 2 > Rule 7` instead of
`1. Rules for Everyone > Rule 7`).

---

## 4. Breadcrumb sections

The extractor (`_extract_html_sections`) walks the content root, maintains a
depth-ordered heading **stack**, and emits each run of block text
(`p`, `li`, `td`, `th`, `pre`) tagged with the `A > B > C` trail of the
headings scoping it:

```
1. Rules for Everyone > Rule 7—You Must Have Earned Income > Earned Income
```

Two payoffs:

1. **Disambiguation.** Pub 596 has *two* subsections literally titled "Earned
   Income" — one under **Rule 7**, one under **Rule 15**. Bare leaf titles
   collide in vector space; breadcrumbs keep them apart:
   ```
   1. Rules for Everyone        > Rule 7—You Must Have Earned Income  > Earned Income
   4. Figuring and Claiming…    > Rule 15—Earned Income Limits        > Earned Income
   ```
2. **Topical embeddings.** The breadcrumb is **prepended to the chunk text
   before embedding**, so the vector encodes the section topic, not just the
   prose. This is the single biggest retrieval-quality lever for a document
   where many passages share boilerplate ("…must have a valid SSN…").

---

## 5. Noise sources and how they're handled

### 5.1 The EIC lookup table — 13,740 cells

The 8 tables break down by `<td>` count as:

```
[13740, 94, 58, 47, 12, 5, 1, 1]
```

The 13,740-cell monster is the **EIC amount lookup table** (income band →
credit, every $50 step). Flattened to text it is thousands of bare numbers —
pure noise that, in earlier runs, dominated the chunk count and produced
meaningless embeddings.

**Indexer choice** (`_MAX_TABLE_CELLS = 30`): `decompose()` any table with more
than 30 `<td>`s before extraction. The small tables (≤94 cells) carry real
tabular prose and are kept.

### 5.2 Duplicated table of contents

Before the first content heading, the body repeats the section list **twice**
as link text (~2,100 words of nav). It adds no retrievable prose.

**Indexer choice:** once any heading has been seen, content is only emitted
under a heading; pre-first-heading text is dropped. (The heading-less fallback
that keeps the whole body still applies to non-IRS pages with no headings.)

### 5.3 Site chrome

Eight `<nav>`s, four language switchers, seven `visually-hidden` a11y headings,
and six accordion footer menus. **All of it lives outside the body `div`** and
is excluded for free by §2's container selection — no explicit blocklist
required.

### 5.4 `script` / `style` / `noscript`

Removed up front with `soup(["script", "style", "noscript"])` → `decompose()`.

---

## 6. Resulting chunk profile

Splitting on the real hierarchy collapses the section count and right-sizes each
unit. Section granularity, content body only:

| Strategy | Sections | Median words | Max words |
|---|---|---|---|
| Split on `h1`–`h3` (naive, tag-based) | 23 | 633 | 6,620 |
| Split on role-aware hierarchy (current) | 56 | 219 | 2,945 |

After the word-window chunker (`_CHUNK_WORDS = 600`, `_OVERLAP_WORDS = 50`) and
the `_MIN_CHUNK_WORDS = 20` filter:

- **~77 chunks**, median ~280 words, max ~620 words
- **56 distinct breadcrumb titles** — i.e. nearly one chunk per logical section,
  with only the longest sections (Rule 9, the detailed examples) spilling into a
  second chunk.

The naive tag-based split, by contrast, produced a dozen sections over 600 words
that the chunker then sliced **across rule boundaries** — the original cause of
"embeddings that don't correspond to sections."

---

## 7. HTML vs. PDF for this source

The same publication exists as `data/irs_publications/p596.pdf`. Both paths now
build breadcrumb section titles, but the signal quality differs sharply:

| | HTML | PDF |
|---|---|---|
| Heading detection | **structural** (`role-*` classes) | **heuristic** (ALL-CAPS / Title Case) |
| Depth signal | exact | inferred from case only |
| Breadcrumb quality | clean (`1. Rules for Everyone > Rule 7 > Earned Income`) | noisy — false positives like `TIP`, `EIC?`, wrapped-title fragments |
| Table noise | dropped by cell count | numbers leak into text |
| Pagination artifacts | none | headers/footers, hyphenation |

**Recommendation:** when a publication is available as IRS HTML, **prefer the
HTML source**. The role-class outline is the authoritative structure; PDF text
extraction can only approximate it. The PDF path remains useful for
publications that have no HTML rendering.

---

## 8. Adding a new IRS HTML publication

The current parser should work unchanged for any page from the same Drupal
template. Verify with a dry run:

```bash
uv run python -c "from src.rag.indexer import extract_html_chunks; \
  cs = extract_html_chunks('data/html/<file>.html'); \
  import statistics; w=[len(c['content'].split()) for c in cs]; \
  print(len(cs),'chunks; median',int(statistics.median(w)),'max',max(w)); \
  print(sorted({c['section_title'] for c in cs})[:20])"
```

Check that breadcrumb titles look like the document's real outline. If a new
template introduces different role classes, extend `_ROLE_DEPTH`; if it nests
the body differently, adjust `_select_content_root`.
