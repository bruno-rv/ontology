import assert from "node:assert/strict";
import test from "node:test";
import { normalizeJsonLd, RDF_TYPE } from "../assets/graph-model.mjs";
import {
  buildAssertionDetails,
  buildNodeDetails,
} from "../assets/details-view.mjs";

const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const RDFS_COMMENT = "http://www.w3.org/2000/01/rdf-schema#comment";
const OWL_CLASS = "http://www.w3.org/2002/07/owl#Class";
const OWL_THING = "http://www.w3.org/2002/07/owl#Thing";
const OWL_INDIVIDUAL = "http://www.w3.org/2002/07/owl#NamedIndividual";
const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";
const A = "https://example.test/A";
const B = "https://example.test/B";
const EXTERNAL = "https://example.test/External";
const RELATED = "https://example.test/related";
const VALUE = "https://example.test/value";

const source = [
  {
    "@id": A,
    "@type": [OWL_CLASS, OWL_THING],
    [RDFS_LABEL]: [
      { "@value": "Alpha", "@language": "en" },
      { "@value": "Alpha", "@language": "en" },
    ],
    [RDFS_COMMENT]: [{ "@value": "A source comment" }],
    [RELATED]: [{ "@id": B }, { "@id": B }],
    [VALUE]: [
      { "@value": "bonjour", "@language": "fr" },
      { "@value": "42", "@type": XSD_INTEGER },
      { "@value": "plain" },
    ],
    ["https://example.test/external"]: [{ "@id": EXTERNAL }],
  },
  {
    "@id": B,
    "@type": [OWL_INDIVIDUAL],
    [RELATED]: [{ "@id": A }],
  },
];

const graph = normalizeJsonLd(source, { version: "test", sourceUrl: "memory:" });

function resource(iri) {
  return graph.nodes.find((node) => node.kind === "resource" && node.iri === iri);
}

function assertion(predicateIri, objectKind, objectValue) {
  return graph.assertions.find(
    (item) =>
      item.predicateIri === predicateIri &&
      item.objectKind === objectKind &&
      (objectKind === "iri" ? item.objectIri : item.lexicalValue) === objectValue,
  );
}

test("assertion details expose canonical subject predicate object and source positions", () => {
  const sourceAssertion = graph.assertions[0];
  const details = buildAssertionDetails(graph, sourceAssertion.id);

  assert.equal(details.kind, "assertion");
  assert.equal(details.id, sourceAssertion.id);
  assert.equal(details.subjectIri, sourceAssertion.subjectIri);
  assert.equal(details.predicateIri, sourceAssertion.predicateIri);
  assert.equal(details.objectKind, sourceAssertion.objectKind);
  assert.equal(details.objectIri, sourceAssertion.objectIri);
  assert.equal(details.sourceRecordIndex, 0);
  assert.equal(details.sourceValueIndex, 0);
  assert.equal(details.ordinal, sourceAssertion.ordinal);
});

test("resource details preserve declarations, types, labels, assertions, and raw records", () => {
  const details = buildNodeDetails(graph, source, resource(A).id);

  assert.equal(details.kind, "resource");
  assert.equal(details.nodeId, resource(A).id);
  assert.equal(details.iri, A);
  assert.equal(details.declared, true);
  assert.deepEqual(details.recordIndexes, [0]);
  assert.deepEqual(details.types, [OWL_CLASS, OWL_THING]);
  assert.deepEqual(details.labels, ["Alpha", "Alpha"]);
  assert.deepEqual(details.comments, ["A source comment"]);
  assert.deepEqual(details.rawSourceRecords, [source[0]]);

  const repeatedOutgoing = details.outgoingAssertions.filter(
    (item) => item.predicateIri === RELATED && item.objectIri === B,
  );
  assert.equal(repeatedOutgoing.length, 2);
  assert.notEqual(repeatedOutgoing[0].id, repeatedOutgoing[1].id);
  assert.equal(details.incomingAssertions.filter((item) => item.subjectIri === B).length, 1);
  assert.equal(details.values.length, details.outgoingAssertions.length);
});

test("external resource details keep exact IRI and show unasserted metadata", () => {
  const details = buildNodeDetails(graph, source, resource(EXTERNAL).id);

  assert.equal(details.iri, EXTERNAL);
  assert.equal(details.declared, false);
  assert.deepEqual(details.recordIndexes, []);
  assert.deepEqual(details.types, []);
  assert.deepEqual(details.outgoingAssertions, []);
  assert.equal(details.language, "Not asserted");
  assert.equal(details.datatypeIri, "Not asserted");
  assert.deepEqual(details.rawSourceRecords, []);
});

test("literal node details retain lexical value language datatype and source assertion", () => {
  const languageAssertion = assertion(VALUE, "literal", "bonjour");
  const languageNode = graph.nodes.find(
    (node) => node.kind === "literal" && node.assertionId === languageAssertion.id,
  );
  const details = buildNodeDetails(graph, source, languageNode.id);

  assert.equal(details.kind, "literal");
  assert.equal(details.nodeId, languageNode.id);
  assert.equal(details.lexicalValue, "bonjour");
  assert.equal(details.language, "fr");
  assert.equal(details.datatypeIri, "Not asserted");
  assert.equal(details.assertionId, languageAssertion.id);
  assert.equal(details.sourceRecordIndex, 0);
  assert.equal(details.sourceValueIndex, 0);
  assert.equal(details.subjectIri, A);
  assert.equal(details.predicateIri, VALUE);
  assert.deepEqual(details.rawSourceRecords, [source[0]]);
});

test("plain literal assertion details use Not asserted for missing language and datatype", () => {
  const plainAssertion = assertion(VALUE, "literal", "plain");
  const details = buildAssertionDetails(graph, plainAssertion.id);

  assert.equal(details.objectKind, "literal");
  assert.equal(details.lexicalValue, "plain");
  assert.equal(details.language, "Not asserted");
  assert.equal(details.datatypeIri, "Not asserted");
  assert.equal(details.objectIri, undefined);
  assert.equal(details.subjectIri, A);
  assert.equal(details.predicateIri, VALUE);
});

test("type assertions retain RDF type and canonical object IRI", () => {
  const typeAssertion = assertion(RDF_TYPE, "iri", OWL_CLASS);
  const details = buildAssertionDetails(graph, typeAssertion.id);

  assert.equal(details.predicateIri, RDF_TYPE);
  assert.equal(details.objectKind, "iri");
  assert.equal(details.objectIri, OWL_CLASS);
  assert.equal(details.language, "Not asserted");
  assert.equal(details.datatypeIri, "Not asserted");
});
