# ATLAS Ontology Explorer Design

**Status:** Approved for implementation  
**Date:** 2026-08-30  
**Target:** A source-faithful, static visualization for ATLAS ontology versions 1.0 and 2.0

## Purpose

Add a maintainable visualization layer to the ATLAS ontology repository so a reader can explore the graph and inspect the complete asserted metadata of every resource and relationship. The graph is an interaction aid; the checked-in JSON-LD releases remain the only ontology truth.

The first release covers both ontology versions as separate graphs. It presents asserted RDF only. It does not infer facts, align versions, or turn mapping documentation into ontology assertions.

## Confirmed source facts

- Version 1.0 contains 89 JSON-LD subject records and 348 asserted triples.
- Version 2.0 contains 82 JSON-LD subject records and 375 asserted triples.
- Each JSON-LD release is a top-level array of subject records. Records use exact IRI keys, `@id`, `@type`, IRI objects, and literal objects with optional language or datatype.
- Version IRIs and namespaces intentionally differ across `http` and `https`; the explorer must never normalize or equate them.
- The ontology contains no assertion-level confidence or provenance metadata. The UI must not invent either.
- Mapping CSVs describe crosswalks and restrictions but are documentation, not RDF instance data.

## Product decisions

- Ship maintainable source and a static site in this repository.
- Load the canonical 1.0 and 2.0 JSON-LD files directly in the browser.
- Use the pinned Cytoscape.js 3.34.2 browser distribution for the graph canvas and retain its MIT license.
- Require no application server, framework, bundler, account, database, or persistence layer.
- Provide a complete searchable list and details surface independent of the canvas.
- Use a scholarly cartographic visual direction: warm paper-toned surfaces, ink-like relationships, restrained vermilion selection, and editorial typography.

## Non-goals

- RDFS or OWL inference, import resolution, SHACL validation, or reasoning closure
- Ontology editing, saving, or export
- Semantic rename/equivalence detection across versions
- Mapping-table rows as graph nodes or assertions
- Confidence or provenance controls not supported by the source
- Accounts, collaboration, saved layouts, analytics, or backend APIs
- Side-by-side synchronized canvases

## Architecture

The explorer lives under `visualization/` and is served as static files. `versions.json` identifies the two canonical JSON-LD sources and their expected subject/assertion counts. Browser modules load a selected release, normalize the verified JSON-LD subset into an assertion-preserving graph model, derive view state, and render both Cytoscape and an accessible catalog/details interface.

No normalized graph artifact is checked in. This avoids a second ontology copy and eliminates regeneration drift. Unsupported input shapes fail closed with a precise location instead of being silently omitted.

### Planned files

```text
visualization/
  index.html                 Static application shell
  versions.json              Release source paths and expected counts
  README.md                  Local serving and verification instructions
  assets/
    app.mjs                  Application bootstrap and orchestration
    graph-model.mjs          Lossless JSON-LD normalization
    graph-view.mjs           Cytoscape rendering and graph interaction
    explorer-state.mjs       Search, facets, selection, and derived results
    details-view.mjs         Safe node/edge metadata presentation
    styles.css               Responsive scholarly-atlas design system
    vendor/
      cytoscape.min.js       Cytoscape.js 3.34.2 browser distribution
      CYTOSCAPE-LICENSE.txt  Upstream MIT license and version record
  tests/
    graph-model.test.mjs     Fidelity and invalid-input tests
    explorer-state.test.mjs  Search/filter/selection tests
```

Keeping normalization, state derivation, graph rendering, and details rendering separate makes source fidelity testable without a browser and keeps canvas failure from disabling metadata exploration.

## Source and normalization contract

`versions.json` contains delivery configuration only:

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

The normalizer applies these rules:

1. The document must be an array; every record must contain a non-empty string `@id`.
2. `@type` values become ordinary `rdf:type` assertions.
3. Every member of every predicate array becomes one assertion occurrence. Repeated equal values remain distinct.
4. An object containing only `@id` is an IRI object. Its target becomes a resource node.
5. An object containing `@value` is a literal object. Its exact lexical value, language, and datatype are retained. Each literal assertion gets its own occurrence node so duplicate literals remain selectable.
6. Referenced IRIs without subject records become inspectable resource nodes marked `declared: false`.
7. Full IRIs are canonical identifiers. Short labels and namespace prefixes are presentation-only.
8. Duplicate subject records may share one displayed resource node, but their record and value indices remain attached to every assertion.
9. Unknown keywords or value shapes produce a load error with record, subject, predicate, and value index.
10. All ontology content is rendered with safe text APIs, never injected as HTML.

### Normalized model

```ts
type ResourceNode = {
  id: string;
  kind: "resource";
  iri: string;
  declared: boolean;
  recordIndexes: number[];
  types: string[];
  label: string;
};

type LiteralNode = {
  id: string;
  kind: "literal";
  lexicalValue: unknown;
  language?: string;
  datatypeIri?: string;
  assertionId: string;
  label: string;
};

type Assertion = {
  id: string;
  version: string;
  ordinal: number;
  subjectIri: string;
  predicateIri: string;
  objectKind: "iri" | "literal";
  objectIri?: string;
  lexicalValue?: unknown;
  language?: string;
  datatypeIri?: string;
  sourceRecordIndex: number;
  sourceValueIndex: number;
};

type OntologyGraph = {
  version: string;
  sourceUrl: string;
  subjects: number;
  assertions: Assertion[];
  nodes: Array<ResourceNode | LiteralNode>;
};
```

Assertion and literal-node IDs are deterministic functions of the selected version and source positions. Display labels never replace exact values.

## Interaction design

### Workspace

- A compact header contains the ATLAS title, version selector, loaded counts, and global search.
- A facet rail filters by resource/literal kind, declaration status, namespace, RDF type, predicate, datatype, and language.
- The graph canvas occupies the primary workspace.
- A persistent details dock shows the selected node or assertion.
- A synchronized result catalog remains keyboard-navigable and complete at all viewport sizes.

### Graph behavior

- The default semantic view shows resource nodes and IRI-object assertions only.
- Literal assertions remain visible in node details and search results. A `Show values` control materializes literal occurrence nodes and their edges.
- Nodes and edges are independently selectable.
- Selection highlights the assertion or node and its immediate neighborhood without deleting the rest of the result catalog.
- `Fit`, `reset view`, `show values`, and `focus neighborhood` are explicit controls.
- The bundled COSE layout is sufficient at the current scale. Community detection or clustering is excluded because it could imply undocumented ontology semantics.

### Search and details

Search matches exact/full IRIs, shortened labels, predicates, literal lexical values, datatypes, and languages. Results identify whether an item is a resource, literal occurrence, or assertion.

Resource details include:

- full exact IRI and copy action
- declared/external status and all RDF types
- labels, comments, and every incoming/outgoing assertion
- repeated values as separate assertion rows
- literal datatype and language when asserted
- source record indices and a safe raw-record view

Assertion details include:

- full subject, predicate, and object or literal value
- exact datatype and language when asserted
- assertion ordinal, record index, and value index
- copy actions for canonical values

Missing metadata is shown as `Not asserted`; it is never inferred.

## Accessibility and responsive behavior

- The result catalog and details dock expose the complete information architecture without relying on the canvas.
- Search, facets, results, version switching, and details are operable by keyboard.
- Focus is visible and predictable; status and errors use an `aria-live` region.
- Canvas selection synchronizes focus/selection state with the catalog.
- Color is never the sole state signal.
- Motion respects `prefers-reduced-motion`.
- On narrow screens, the graph becomes a collapsible overview while search, catalog, and details remain fully usable.

## Loading and failure behavior

- A source fetch failure identifies the version and URL, distinguishes likely `file://` restrictions, and leaves another successfully loaded version usable.
- Invalid JSON does not replace the last valid graph.
- Missing `@id` or an unsupported value shape reports exact source indices and blocks the affected version.
- Observed counts must match `versions.json`; a mismatch is an integrity error, not a successful load.
- Unknown target IRIs render as undeclared external resources.
- Empty searches preserve active filters and provide one clear reset action.
- Cytoscape load, layout, or render failure retains the complete catalog and details interface and offers a graph retry.

## Verification strategy

Use Node's built-in `node:test` runner for pure modules and browser-driven acceptance checks for the shipped static interface.

### Normalizer invariants

- Version 1.0 produces exactly 89 subject records and 348 assertions.
- Version 2.0 produces exactly 82 subject records and 375 assertions.
- Reconstructing the assertion multiset from normalized data exactly matches the JSON-LD source, including duplicates.
- `http` and `https` IRIs remain distinct.
- Repeated equal values produce distinct deterministic assertion IDs.
- Literal values, datatypes, and language tags survive unchanged.
- Missing subject IDs, malformed documents, and unsupported shapes fail explicitly.
- Mapping CSVs contribute no graph elements.

### Interaction acceptance

- Both versions load from a plain local HTTP server with no console errors.
- Displayed counts match the source and integrity manifest.
- Every visible graph edge is selectable and exposes its complete assertion.
- Full IRIs and literal values are available without hover.
- Search can locate a full IRI, a predicate, and a literal value.
- Filters compose and reset deterministically.
- A keyboard-only user can choose a result and read its details.
- Focus, live status, narrow layout, and reduced-motion behavior are verified.
- With Cytoscape intentionally unavailable, catalog and details exploration still works.

## Delivery

The visualization is complete when the source modules, pinned vendor file/license, tests, and serving instructions are committed together; all tests pass; and browser verification covers both versions, node selection, edge selection, search, facets, literal disclosure, responsive behavior, and canvas-failure fallback.
