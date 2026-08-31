import assert from "node:assert/strict";
import test from "node:test";
import { normalizeJsonLd, RDF_TYPE } from "../assets/graph-model.mjs";
import {
  createExplorerIndex,
  defaultFilters,
  facetOptions,
  queryExplorer,
  selectionForResult,
} from "../assets/explorer-state.mjs";

const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const OWL_CLASS = "http://www.w3.org/2002/07/owl#Class";
const OWL_INDIVIDUAL = "http://www.w3.org/2002/07/owl#NamedIndividual";
const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";

const graph = normalizeJsonLd(
  [
    {
      "@id": "https://example.test/LanguageModel",
      "@type": [OWL_CLASS],
      [RDFS_LABEL]: [{ "@language": "en", "@value": "Language Model" }],
      "https://example.test/used": [{ "@id": "https://example.test/Dataset" }],
      "https://example.test/count": [{ "@value": "4", "@type": XSD_INTEGER }],
    },
    {
      "@id": "http://other.test/External",
      "@type": [OWL_INDIVIDUAL],
      [RDFS_LABEL]: [{ "@language": "pt", "@value": "Outside" }],
      "https://example.test/relates": [{ "@language": "pt", "@value": "Olá" }],
    },
  ],
  { version: "test", sourceUrl: "memory:" },
);

const index = createExplorerIndex(graph);

test("search covers labels, full IRIs, predicates, and literal values", () => {
  for (const query of [
    "Language Model",
    "https://example.test/LanguageModel",
    "used",
    "Olá",
    "integer",
    "pt",
  ]) {
    assert.ok(queryExplorer(index, { ...defaultFilters(), query }).length > 0, query);
  }
});

test("query results have a deterministic kind, label, and ID order", () => {
  const first = queryExplorer(index, defaultFilters());
  const second = queryExplorer(index, defaultFilters());

  assert.deepEqual(
    first.map(({ kind, id }) => [kind, id]),
    second.map(({ kind, id }) => [kind, id]),
  );
  assert.deepEqual(
    first.map(({ kind }) => kind),
    [
      "resource",
      "resource",
      "resource",
      "resource",
      "resource",
      "literal",
      "literal",
      "literal",
      "literal",
      "assertion",
      "assertion",
      "assertion",
      "assertion",
      "assertion",
      "assertion",
      "assertion",
    ],
  );
});

test("kind and declaration facets select only matching item kinds", () => {
  const resources = queryExplorer(index, {
    ...defaultFilters(),
    kinds: new Set(["resource"]),
  });
  assert.equal(resources.length, 5);
  assert.ok(resources.every(({ kind }) => kind === "resource"));

  const externalResources = queryExplorer(index, {
    ...defaultFilters(),
    kinds: new Set(["resource"]),
    declared: new Set([false]),
  });
  assert.deepEqual(
    externalResources.map(({ iri }) => iri),
    [
      "http://www.w3.org/2002/07/owl#Class",
      "https://example.test/Dataset",
      "http://www.w3.org/2002/07/owl#NamedIndividual",
    ],
  );
});

test("namespace, RDF type, predicate, datatype, and language facets compose by intersection", () => {
  const results = queryExplorer(index, {
    ...defaultFilters(),
    kinds: new Set(["assertion"]),
    namespaces: new Set(["https://example.test/"]),
    rdfTypes: new Set([OWL_CLASS]),
    predicates: new Set([RDF_TYPE]),
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].subjectIri, "https://example.test/LanguageModel");
  assert.equal(results[0].objectIri, OWL_CLASS);

  const typedLiteral = queryExplorer(index, {
    ...defaultFilters(),
    kinds: new Set(["literal"]),
    datatypes: new Set([XSD_INTEGER]),
  });
  assert.equal(typedLiteral.length, 1);
  assert.equal(typedLiteral[0].lexicalValue, "4");

  const portuguese = queryExplorer(index, {
    ...defaultFilters(),
    languages: new Set(["pt"]),
    predicates: new Set(["https://example.test/relates"]),
  });
  assert.ok(portuguese.length > 0);
  assert.ok(portuguese.every((item) => item.languages.includes("pt")));
  assert.ok(portuguese.every((item) => item.predicates.includes("https://example.test/relates")));
});

test("default filters are independent reset state and preserve empty-filter results", () => {
  const first = defaultFilters();
  const second = defaultFilters();
  assert.notEqual(first.kinds, second.kinds);
  first.kinds.add("resource");
  assert.equal(second.kinds.size, 0);
  assert.equal(first.query, "");
  assert.equal(queryExplorer(index, second).length, index.items.length);
});

test("empty searches preserve facets and return no results", () => {
  const filters = {
    ...defaultFilters(),
    query: "not present anywhere",
    kinds: new Set(["resource"]),
  };
  assert.deepEqual(queryExplorer(index, filters), []);
});

test("facet options are deduplicated and sorted", () => {
  assert.deepEqual(facetOptions(index), {
    kinds: ["assertion", "literal", "resource"],
    declared: [false, true],
    namespaces: [
      "http://other.test/",
      "http://www.w3.org/2002/07/owl#",
      "https://example.test/",
    ],
    rdfTypes: [OWL_CLASS, OWL_INDIVIDUAL],
    predicates: [
      RDF_TYPE,
      RDFS_LABEL,
      "https://example.test/count",
      "https://example.test/relates",
      "https://example.test/used",
    ],
    datatypes: [XSD_INTEGER],
    languages: ["en", "pt"],
  });
});

test("literal and assertion results stay available to semantic search", () => {
  const literalResults = queryExplorer(index, { ...defaultFilters(), query: "Olá" });
  assert.ok(literalResults.some(({ kind }) => kind === "literal"));
  assert.ok(literalResults.some(({ kind }) => kind === "assertion"));
});

test("node and assertion results convert to exact selections", () => {
  for (const result of [
    index.items.find(({ kind }) => kind === "resource"),
    index.items.find(({ kind }) => kind === "literal"),
    index.items.find(({ kind }) => kind === "assertion"),
  ]) {
    assert.deepEqual(selectionForResult(result), { kind: result.kind, id: result.id });
  }
});
