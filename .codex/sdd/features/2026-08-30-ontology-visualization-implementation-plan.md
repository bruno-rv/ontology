# ATLAS Ontology Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a source-faithful static explorer for ATLAS ontology versions 1.0 and 2.0 with selectable graph nodes and edges plus complete metadata inspection.

**Architecture:** A zero-build static application loads the canonical JSON-LD files directly, normalizes the verified JSON-LD subset into a lossless assertion model, and renders synchronized Cytoscape and accessible catalog/details views. Pure model, search, facet, and detail derivation modules are tested with Node's built-in test runner; browser checks validate the integrated experience and fallback behavior.

**Tech Stack:** Browser ES modules, HTML5, CSS, Node `node:test`, Cytoscape.js 3.34.2 (vendored UMD distribution), Python's static HTTP server for local preview.

**Spec:** `.codex/sdd/features/2026-08-30-ontology-visualization-design.md`

## Global Constraints

- Canonical inputs are `1.0/dh-atlas.jsonld` and `2.0/dh-atlas.jsonld`; no normalized graph copy may be checked in.
- Load both versions as separate asserted graphs; do not infer facts, align versions, resolve imports, or add mapping CSV assertions.
- Preserve exact IRIs, repeated values, lexical values, datatypes, languages, record indices, and value indices.
- Keep intentional `http` and `https` identifiers distinct.
- Do not expose confidence or assertion provenance controls because the source contains neither.
- Render ontology content through safe text APIs, never unsanitized HTML.
- The catalog and details views must remain usable if Cytoscape is unavailable.
- Add no framework, bundler, package manifest, backend, account system, or persistence layer.
- Keep all new application files under `visualization/` except the root README discoverability update.

---

### Task 1: Lossless JSON-LD graph model

**Files:**
- Create: `visualization/assets/graph-model.mjs`
- Create: `visualization/tests/graph-model.test.mjs`

**Interfaces:**
- Consumes: a parsed top-level JSON-LD array, release ID, and source URL.
- Produces: `normalizeJsonLd(document, { version, sourceUrl }) -> OntologyGraph`, `shortenIri(iri) -> string`, `resourceCategory(node) -> string`, and exported `RDF_TYPE`.

- [ ] **Step 1: Write source-fidelity and invalid-input tests**

Create tests that load both canonical files and exercise the exact contract:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeJsonLd, RDF_TYPE } from "../assets/graph-model.mjs";

const cases = [
  ["1.0", "../../1.0/dh-atlas.jsonld", 89, 348],
  ["2.0", "../../2.0/dh-atlas.jsonld", 82, 375],
];

for (const [version, relativePath, subjects, assertions] of cases) {
  test(`${version} preserves every asserted triple`, async () => {
    const source = JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
    const graph = normalizeJsonLd(source, { version, sourceUrl: relativePath });
    assert.equal(graph.subjects, subjects);
    assert.equal(graph.assertions.length, assertions);
    assert.equal(new Set(graph.assertions.map(({ id }) => id)).size, assertions);
    assert.deepEqual(assertionMultiset(graph.assertions), flattenSourceMultiset(source));
  });
}

test("type values become rdf:type assertions without rewriting IRIs", () => {
  const source = [{ "@id": "http://example.test/A", "@type": ["https://example.test/A"] }];
  const graph = normalizeJsonLd(source, { version: "test", sourceUrl: "memory:" });
  assert.equal(graph.assertions.length, 1);
  assert.equal(graph.assertions[0].predicateIri, RDF_TYPE);
  assert.equal(graph.assertions[0].subjectIri, "http://example.test/A");
  assert.equal(graph.assertions[0].objectIri, "https://example.test/A");
});
```

Implement `flattenSourceMultiset` only in the test file with a hand-auditable expansion of `@type` and predicate arrays, and compare sorted literal tuples rather than calling production helpers. Add focused fixtures proving:

- duplicate equal literal values create distinct assertion and literal-node IDs;
- literal lexical value, language, and datatype survive unchanged;
- referenced IRIs without subject records become `declared: false` resources;
- duplicate subject records retain both record indices;
- a non-array document, missing/empty `@id`, non-array predicate value, unknown keyword, and unsupported value object each throw a location-rich `TypeError`.

- [ ] **Step 2: Run the focused test and confirm the expected import failure**

Run:

```bash
node --test visualization/tests/graph-model.test.mjs
```

Expected: FAIL because `visualization/assets/graph-model.mjs` does not exist.

- [ ] **Step 3: Implement the minimal fail-closed normalizer**

Implement the model with these exact exported shapes:

```js
export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

export function normalizeJsonLd(document, { version, sourceUrl }) {
  if (!Array.isArray(document)) {
    throw new TypeError("JSON-LD document must be a top-level array");
  }
  // First pass: validate records and register declared resource nodes.
  // Second pass: expand @type and predicate arrays into assertion occurrences.
  // Final pass: derive exact resource types and presentation-only labels.
  return { version, sourceUrl, subjects: document.length, assertions, nodes };
}
```

Use deterministic IDs that include version and exact source positions:

```js
const assertionId = `assertion:${encodeURIComponent(version)}:${recordIndex}:${predicateIndex}:${valueIndex}`;
const resourceId = `resource:${iri}`;
const literalId = `literal:${assertionId}`;
```

Treat `@id` objects as IRI objects and `@value` objects as literal objects. Permit only the optional literal keys `@language` and `@type`. Derive labels from asserted `rdfs:label` values first and IRI fragments/paths second; never mutate canonical identifiers.

- [ ] **Step 4: Run the focused model test**

Run:

```bash
node --test visualization/tests/graph-model.test.mjs
```

Expected: PASS with all model tests green and exact `89/348` and `82/375` source counts.

- [ ] **Step 5: Commit Task 1**

```bash
git add visualization/assets/graph-model.mjs visualization/tests/graph-model.test.mjs
git commit -m "feat: add lossless ontology graph model"
```

---

### Task 2: Search, facets, and selection state

**Files:**
- Create: `visualization/assets/explorer-state.mjs`
- Create: `visualization/tests/explorer-state.test.mjs`

**Interfaces:**
- Consumes: the `OntologyGraph` returned by `normalizeJsonLd`.
- Produces: `createExplorerIndex(graph)`, `defaultFilters()`, `queryExplorer(index, filters)`, `facetOptions(index)`, and `selectionForResult(result)`.

- [ ] **Step 1: Write state tests against a compact in-memory graph**

Cover global search, composed facets, deterministic result order, and selection identity:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeJsonLd } from "../assets/graph-model.mjs";
import {
  createExplorerIndex,
  defaultFilters,
  facetOptions,
  queryExplorer,
  selectionForResult,
} from "../assets/explorer-state.mjs";

const graph = normalizeJsonLd([
  {
    "@id": "https://example.test/LanguageModel",
    "@type": ["https://www.w3.org/2002/07/owl#Class"],
    "http://www.w3.org/2000/01/rdf-schema#label": [
      { "@language": "en", "@value": "Language Model" },
    ],
    "https://example.test/used": [{ "@id": "https://example.test/Dataset" }],
  },
], { version: "test", sourceUrl: "memory:" });

test("search covers labels, full IRIs, predicates, and literal values", () => {
  const index = createExplorerIndex(graph);
  for (const query of ["Language Model", "https://example.test/LanguageModel", "used", "en"]) {
    assert.ok(queryExplorer(index, { ...defaultFilters(), query }).length > 0);
  }
});
```

Add tests for `kind`, `declared`, `namespace`, `rdfType`, `predicate`, `datatype`, and `language` filters; filter intersection; reset defaults; empty results; deduplicated/sorted facet options; and conversion of node/assertion results into `{ kind, id }` selections.

- [ ] **Step 2: Run the focused test and confirm the expected import failure**

```bash
node --test visualization/tests/explorer-state.test.mjs
```

Expected: FAIL because `explorer-state.mjs` does not exist.

- [ ] **Step 3: Implement a pure explorer index and filtering pipeline**

Use one presentation item per resource node, literal node, and assertion. Each item has a normalized lowercase `searchText` assembled from exact searchable fields while retaining exact display values separately.

```js
export function defaultFilters() {
  return {
    query: "",
    kinds: new Set(),
    declared: new Set(),
    namespaces: new Set(),
    rdfTypes: new Set(),
    predicates: new Set(),
    datatypes: new Set(),
    languages: new Set(),
  };
}

export function queryExplorer(index, filters) {
  return index.items
    .filter((item) => matchesQuery(item, filters.query))
    .filter((item) => matchesFacets(item, filters))
    .sort(compareExplorerItems);
}
```

Do not hide literal/assertion catalog results when the canvas `Show values` control is off; canvas visibility and semantic search are separate state.

- [ ] **Step 4: Run both pure-module suites**

```bash
node --test visualization/tests/graph-model.test.mjs visualization/tests/explorer-state.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add visualization/assets/explorer-state.mjs visualization/tests/explorer-state.test.mjs
git commit -m "feat: add ontology search and facet state"
```

---

### Task 3: Accessible static shell and metadata details

**Files:**
- Create: `visualization/index.html`
- Create: `visualization/versions.json`
- Create: `visualization/assets/details-view.mjs`
- Create: `visualization/assets/styles.css`
- Create: `visualization/assets/vendor/cytoscape.min.js`
- Create: `visualization/assets/vendor/CYTOSCAPE-LICENSE.txt`
- Create: `visualization/tests/details-view.test.mjs`

**Interfaces:**
- Consumes: graph nodes/assertions plus the original source document.
- Produces: `buildNodeDetails(graph, sourceDocument, nodeId)`, `buildAssertionDetails(graph, assertionId)`, and `renderDetails(container, details, actions)`.
- Provides: all stable DOM IDs and accessible regions consumed by `app.mjs` in Task 4.

- [ ] **Step 1: Write pure detail-model tests**

Verify resource and assertion detail completeness without a DOM dependency:

```js
test("assertion details expose canonical subject predicate object and source positions", () => {
  const graph = normalizeJsonLd(source, { version: "test", sourceUrl: "memory:" });
  const assertion = graph.assertions[0];
  const details = buildAssertionDetails(graph, assertion.id);
  assert.equal(details.kind, "assertion");
  assert.equal(details.subjectIri, assertion.subjectIri);
  assert.equal(details.predicateIri, assertion.predicateIri);
  assert.equal(details.sourceRecordIndex, 0);
  assert.equal(details.sourceValueIndex, 0);
});
```

Also prove node details contain exact IRI, declaration status, all types, incoming/outgoing assertions, repeated values, raw source records, literal language/datatype, and `Not asserted` values rather than inferred defaults.

- [ ] **Step 2: Run the detail test and confirm the expected import failure**

```bash
node --test visualization/tests/details-view.test.mjs
```

Expected: FAIL because `details-view.mjs` does not exist.

- [ ] **Step 3: Implement pure detail derivation and safe DOM rendering**

Build all content with `document.createElement`, `textContent`, and explicit attributes. Copy actions receive canonical strings through callbacks; do not embed ontology strings in `innerHTML`.

```js
export function renderDetails(container, details, { onCopy, onSelect }) {
  container.replaceChildren();
  const fragment = document.createDocumentFragment();
  // Create semantic headings, definition lists, assertion buttons, and raw pre text.
  container.append(fragment);
}
```

- [ ] **Step 4: Create the complete static application shell**

`index.html` must include:

- a skip link and `aria-live` status region;
- version selector, global search, counts, and graph toolbar;
- facet fieldsets for every approved facet;
- graph canvas with a textual fallback message;
- keyboard-navigable result catalog;
- persistent details dock;
- non-module Cytoscape vendor script followed by the module `app.mjs` script.

Use the approved scholarly-atlas direction in CSS. Define light/dark-safe semantic tokens with warm neutrals, ink, moss, and vermilion; use fluid typography and spacing; avoid generic cards, neon, glass effects, or purple/blue gradients. Provide visible `:focus-visible`, `prefers-reduced-motion`, high-contrast selection, and a narrow-screen mode where the catalog/details remain primary.

- [ ] **Step 5: Add exact release configuration**

Create `versions.json` with the approved source paths and integrity counts:

```json
{
  "versions": [
    {
      "id": "1.0",
      "label": "Version 1.0",
      "source": "../1.0/dh-atlas.jsonld",
      "expectedSubjects": 89,
      "expectedAssertions": 348
    },
    {
      "id": "2.0",
      "label": "Version 2.0",
      "source": "../2.0/dh-atlas.jsonld",
      "expectedSubjects": 82,
      "expectedAssertions": 375
    }
  ]
}
```

- [ ] **Step 6: Vendor Cytoscape.js 3.34.2 reproducibly**

Use a temporary directory outside the repository, fetch the official npm tarball for exactly `cytoscape@3.34.2`, copy `dist/cytoscape.min.js`, and copy the upstream MIT license text plus a version/source header into `CYTOSCAPE-LICENSE.txt`. Do not add `node_modules`, a lockfile, tarball, or package manifest.

Verify the vendored script exposes `globalThis.cytoscape` in the browser and record its SHA-256 in the license file.

- [ ] **Step 7: Run details and all current tests**

```bash
node --test visualization/tests/*.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add visualization/index.html visualization/versions.json visualization/assets/details-view.mjs visualization/assets/styles.css visualization/assets/vendor visualization/tests/details-view.test.mjs
git commit -m "feat: add accessible ontology explorer shell"
```

---

### Task 4: Cytoscape integration, application orchestration, and delivery docs

**Files:**
- Create: `visualization/assets/graph-view.mjs`
- Create: `visualization/assets/app.mjs`
- Create: `visualization/tests/app.test.mjs`
- Create: `visualization/README.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1–3 exports and the stable DOM contract.
- Produces: `createGraphView({ container, onSelect, onError })`, plus the complete browser application initialized by `app.mjs`.

- [ ] **Step 1: Write application configuration and integrity behavior tests**

Import `validateVersionsManifest` and `assertGraphIntegrity` from the not-yet-created `app.mjs`. Read the real `versions.json` and canonical JSON-LD files, normalize each configured release, and assert:

- the manifest returns exactly the configured 1.0 and 2.0 releases;
- each configured source path resolves to a canonical JSON-LD document;
- each normalized graph passes its configured subject and assertion integrity counts;
- malformed manifests, duplicate release IDs, missing source paths, and non-positive expected counts fail clearly;
- subject or assertion count mismatch fails without modifying the last accepted graph.

Derive expected values from hand-written test literals, not from production helpers. Run the test before implementation and confirm it fails because `app.mjs` does not exist. HTML semantics, script ordering, license presentation, documentation, and CDN absence are reviewed through the real browser artifact and the task review rather than source-grep tests.

- [ ] **Step 2: Implement the Cytoscape adapter**

Expose this lifecycle:

```js
export function createGraphView({ container, onSelect, onError }) {
  let cy = null;
  return {
    render({ graph, visibleNodeIds, visibleAssertionIds, showLiterals }),
    select(selection),
    fit(),
    reset(),
    focusNeighborhood(selection),
    retry(),
    destroy(),
  };
}
```

Requirements:

- treat resource/literal nodes and assertion edges as distinct Cytoscape element kinds;
- render arrow direction and abbreviated predicate labels while retaining full assertion data;
- make both node and edge taps emit `{ kind, id }` selections;
- dim rather than delete context during neighborhood focus;
- render only resource-to-resource assertions by default and include literal occurrence nodes when `showLiterals` is true;
- catch missing Cytoscape, initialization, layout, and render failures and call `onError` without disabling other UI;
- use the bundled COSE layout and deterministic style categories, not inferred clusters.

- [ ] **Step 3: Implement application orchestration**

`app.mjs` must export pure `validateVersionsManifest(manifest)` and `assertGraphIntegrity(graph, versionConfig)` functions for the configuration tests, then:

1. fetch and validate `versions.json`;
2. populate and load the selected release;
3. fetch canonical JSON-LD and normalize it;
4. block success on count mismatch;
5. build the explorer index, facets, catalog, details, and graph;
6. synchronize node/edge/catalog selection;
7. preserve query text but reset selection on version switch;
8. wire graph fit/reset/show-values/focus/retry controls;
9. announce loading, success, errors, copies, and empty results through the live region;
10. retain the last valid catalog/details state after a subsequent load failure.

Catalog rows must be real buttons or links with clear kind labels. Copy actions use `navigator.clipboard.writeText` with a selection fallback and always copy canonical values.

- [ ] **Step 4: Add delivery documentation and discoverability**

Document this exact local flow:

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4173/visualization/`. Explain why `file://` is unsupported, identify the canonical inputs, list the no-inference boundary, and provide the pure test command:

```bash
node --test visualization/tests/*.test.mjs
```

Add a concise `Visualization` section to the root README linking to `visualization/README.md` and the browser entrypoint.

- [ ] **Step 5: Run the complete static suite and syntax checks**

```bash
node --test visualization/tests/*.test.mjs
node --check visualization/assets/app.mjs
node --check visualization/assets/graph-view.mjs
```

Expected: all commands exit 0.

- [ ] **Step 6: Start the static server and perform browser acceptance**

Serve the repository on `127.0.0.1:4173`, then verify in a real browser:

- version 2.0 loads with `82 subjects / 375 assertions` and no console errors;
- version 1.0 loads with `89 subjects / 348 assertions`;
- a resource node selection opens full exact metadata;
- an edge selection opens canonical subject, predicate, object, and source positions;
- searches find a full IRI, predicate, and literal value;
- kind, namespace, predicate, datatype, language, and declaration filters compose and reset;
- `Show values` materializes literal nodes without removing catalog results;
- keyboard-only catalog selection moves details predictably with visible focus;
- narrow viewport retains search, catalog, and details usability;
- reduced-motion mode has no required animated transition;
- blocking the Cytoscape vendor script leaves catalog/details exploration operational;
- no ontology string is interpreted as HTML.

Capture screenshots at desktop and narrow widths for visual inspection, but do not commit transient screenshots.

- [ ] **Step 7: Commit Task 4**

```bash
git add visualization/assets/graph-view.mjs visualization/assets/app.mjs visualization/tests/app.test.mjs visualization/README.md README.md
git commit -m "feat: deliver interactive ontology explorer"
```

---

### Task 5: Final independent review and acceptance

**Files:**
- Review only: `.codex/sdd/features/2026-08-30-ontology-visualization-design.md`
- Review only: all files under `visualization/`
- Review only: `README.md`

**Interfaces:**
- Consumes: completed Tasks 1–4.
- Produces: review findings, fixes by the owning implementer, and fresh completion evidence.

- [ ] **Step 1: Run a specification-compliance review**

Check every design requirement and non-goal against the diff. Reject silent metadata loss, rewritten identifiers, unselectable edges, canvas-only information, invented semantics, or undocumented runtime requirements.

- [ ] **Step 2: Run a code-quality and accessibility review**

Inspect state ownership, error recovery, XSS safety, deterministic IDs, DOM semantics, keyboard behavior, focus, contrast, responsive layout, and third-party license handling. Report actionable findings with exact file and line references.

- [ ] **Step 3: Route fixes to the task owner and re-review**

The original implementer fixes any finding in its owned files. Repeat the relevant review until no blocking findings remain.

- [ ] **Step 4: Run fresh full verification**

```bash
node --test visualization/tests/*.test.mjs
node --check visualization/assets/*.mjs
git diff --check main...HEAD
git status --short
```

Repeat the full browser acceptance matrix from Task 4 against the final commit. Completion requires exact current command output, browser evidence, and a clean tracked worktree; agent reports alone are insufficient.
