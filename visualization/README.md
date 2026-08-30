# ATLAS Ontology Explorer

The browser explorer is a source-faithful catalog and relationship view for the checked-in ATLAS Ontology releases.

## Run locally

From the repository root, start the bounded static server:

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open [http://127.0.0.1:4173/visualization/](http://127.0.0.1:4173/visualization/). The explorer uses `fetch()` for the manifest and JSON-LD sources, so `file://` is unsupported: browsers block those cross-file requests under the local-file origin. Use the HTTP server above.

## Canonical inputs

- `visualization/versions.json` defines the release IDs, labels, source paths, and integrity counts.
- `1.0/dh-atlas.jsonld` is the canonical Version 1.0 source.
- `2.0/dh-atlas.jsonld` is the canonical Version 2.0 source.
- `visualization/assets/vendor/cytoscape.min.js` is the checked-in graph runtime, with its license in `CYTOSCAPE-LICENSE.txt`.

The application normalizes the JSON-LD without rewriting IRIs, literal values, language tags, datatypes, assertion order, or source positions. It blocks a release when its configured subject or assertion count does not match.

## No-inference boundary

The explorer presents asserted data only. It does not infer subclasses, inverse relationships, transitive relationships, entailments, clusters, or values that are absent from the canonical JSON-LD. The graph canvas is an interaction aid; the catalog and details panel remain the complete semantic surface, including when Cytoscape is unavailable.

## Tests

Run the pure Node test suite from the repository root:

```bash
node --test visualization/tests/*.test.mjs
```
