import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeJsonLd,
  RDF_TYPE,
  resourceCategory,
  shortenIri,
} from "../assets/graph-model.mjs";

const SOURCE_RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";

function sortTuples(tuples) {
  return tuples.sort((left, right) => {
    const leftKey = JSON.stringify(left);
    const rightKey = JSON.stringify(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function flattenSourceMultiset(source) {
  const tuples = [];

  source.forEach((record) => {
    const subjectIri = record["@id"];
    const predicateEntries = Object.entries(record).filter(([key]) => key !== "@id");

    predicateEntries.forEach(([predicate, values]) => {
      values.forEach((value) => {
        if (predicate === "@type") {
          tuples.push([subjectIri, SOURCE_RDF_TYPE, "iri", value]);
        } else if (Object.prototype.hasOwnProperty.call(value, "@id")) {
          tuples.push([subjectIri, predicate, "iri", value["@id"]]);
        } else if (Object.prototype.hasOwnProperty.call(value, "@value")) {
          tuples.push([
            subjectIri,
            predicate,
            "literal",
            value["@value"],
            value["@language"] ?? null,
            value["@type"] ?? null,
          ]);
        } else {
          throw new TypeError("Test oracle encountered an unsupported source value");
        }
      });
    });
  });

  return sortTuples(tuples);
}

function assertionMultiset(assertions) {
  return sortTuples(
    assertions.map((assertion) => {
      if (assertion.objectKind === "iri") {
        return [
          assertion.subjectIri,
          assertion.predicateIri,
          "iri",
          assertion.objectIri,
        ];
      }

      return [
        assertion.subjectIri,
        assertion.predicateIri,
        "literal",
        assertion.lexicalValue,
        assertion.language ?? null,
        assertion.datatypeIri ?? null,
      ];
    }),
  );
}

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

test("duplicate equal literals remain distinct assertion and literal nodes", () => {
  const source = [
    {
      "@id": "https://example.test/A",
      [RDFS_LABEL]: [{ "@value": "same" }, { "@value": "same" }],
    },
  ];
  const graph = normalizeJsonLd(source, { version: "test", sourceUrl: "memory:" });
  const [first, second] = graph.assertions;
  const literalNodes = graph.nodes.filter((node) => node.kind === "literal");

  assert.equal(graph.assertions.length, 2);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(
    literalNodes.map(({ id, assertionId }) => [id, assertionId]),
    [
      [`literal:${first.id}`, first.id],
      [`literal:${second.id}`, second.id],
    ],
  );
});

test("literal lexical value, language, and datatype survive unchanged", () => {
  const source = [
    {
      "@id": "https://example.test/A",
      "https://example.test/value": [
        { "@value": "quatre", "@language": "fr" },
        { "@value": "4", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
      ],
    },
  ];
  const graph = normalizeJsonLd(source, { version: "test", sourceUrl: "memory:" });
  const [languageAssertion, datatypeAssertion] = graph.assertions;

  assert.equal(languageAssertion.lexicalValue, "quatre");
  assert.equal(languageAssertion.language, "fr");
  assert.equal(languageAssertion.datatypeIri, undefined);
  assert.equal(datatypeAssertion.lexicalValue, "4");
  assert.equal(datatypeAssertion.language, undefined);
  assert.equal(datatypeAssertion.datatypeIri, "http://www.w3.org/2001/XMLSchema#integer");
});

test("referenced IRIs without subject records are undeclared resources", () => {
  const source = [
    {
      "@id": "https://example.test/A",
      "https://example.test/pointsTo": [{ "@id": "https://example.test/External" }],
    },
  ];
  const graph = normalizeJsonLd(source, { version: "test", sourceUrl: "memory:" });
  const external = graph.nodes.find(
    (node) => node.kind === "resource" && node.iri === "https://example.test/External",
  );

  assert.ok(external);
  assert.equal(external.declared, false);
  assert.deepEqual(external.recordIndexes, []);
});

test("duplicate subject records retain both source record indices", () => {
  const source = [
    {
      "@id": "https://example.test/A",
      "https://example.test/first": [{ "@id": "https://example.test/B" }],
    },
    {
      "@id": "https://example.test/A",
      "https://example.test/second": [{ "@value": "second" }],
    },
  ];
  const graph = normalizeJsonLd(source, { version: "test", sourceUrl: "memory:" });
  const resource = graph.nodes.find(
    (node) => node.kind === "resource" && node.iri === "https://example.test/A",
  );

  assert.deepEqual(resource.recordIndexes, [0, 1]);
  assert.deepEqual(
    graph.assertions.map(({ sourceRecordIndex, sourceValueIndex }) => [
      sourceRecordIndex,
      sourceValueIndex,
    ]),
    [
      [0, 0],
      [1, 0],
    ],
  );
});

test("labels prefer asserted rdfs:label values and shorten IRI fragments or paths", () => {
  const source = [
    {
      "@id": "https://example.test/ns#Named",
      [RDFS_LABEL]: [{ "@language": "en", "@value": "Readable name" }],
      "https://example.test/other": [{ "@id": "https://example.test/ns/Other" }],
    },
  ];
  const graph = normalizeJsonLd(source, { version: "test", sourceUrl: "memory:" });
  const named = graph.nodes.find(
    (node) => node.kind === "resource" && node.iri === "https://example.test/ns#Named",
  );
  const other = graph.nodes.find(
    (node) => node.kind === "resource" && node.iri === "https://example.test/ns/Other",
  );

  assert.equal(named.label, "Readable name");
  assert.equal(other.label, "Other");
  assert.equal(shortenIri("https://example.test/ns#Named"), "Named");
  assert.equal(shortenIri("https://example.test/ns/Other"), "Other");
  assert.equal(resourceCategory(named), "resource");
});

function assertLocationRichTypeError(document, pattern) {
  assert.throws(
    () => normalizeJsonLd(document, { version: "test", sourceUrl: "memory:" }),
    (error) => {
      assert.ok(error instanceof TypeError);
      assert.match(error.message, pattern);
      return true;
    },
  );
}

test("rejects a non-array document", () => {
  assertLocationRichTypeError({}, /top-level array/);
});

test("rejects a missing subject ID with its record location", () => {
  assertLocationRichTypeError([{}], /record 0.*@id/);
});

test("rejects an empty subject ID with its record location", () => {
  assertLocationRichTypeError([{ "@id": "" }], /record 0.*@id/);
});

test("rejects a non-array predicate value with its source location", () => {
  assertLocationRichTypeError(
    [{ "@id": "https://example.test/A", "https://example.test/p": { "@id": "https://example.test/B" } }],
    /record 0.*subject https:\/\/example\.test\/A.*predicate https:\/\/example\.test\/p.*array/,
  );
});

test("rejects an unknown keyword with its source location", () => {
  assertLocationRichTypeError(
    [{ "@id": "https://example.test/A", "@unknown": [] }],
    /record 0.*subject https:\/\/example\.test\/A.*@unknown/,
  );
});

test("rejects an unsupported value object with record, predicate, and value indices", () => {
  assertLocationRichTypeError(
    [{ "@id": "https://example.test/A", "https://example.test/p": [{ nope: true }] }],
    /record 0.*subject https:\/\/example\.test\/A.*predicate https:\/\/example\.test\/p.*value 0/,
  );
});
