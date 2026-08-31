export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";

const RESOURCE_CATEGORIES = new Map([
  ["http://www.w3.org/2002/07/owl#Class", "class"],
  ["http://www.w3.org/2002/07/owl#ObjectProperty", "property"],
  ["http://www.w3.org/2002/07/owl#DatatypeProperty", "property"],
  ["http://www.w3.org/2002/07/owl#AnnotationProperty", "property"],
  ["http://www.w3.org/2002/07/owl#Ontology", "ontology"],
  ["http://www.w3.org/2002/07/owl#NamedIndividual", "individual"],
  ["http://www.w3.org/2000/01/rdf-schema#Datatype", "datatype"],
]);

export function shortenIri(iri) {
  if (typeof iri !== "string") {
    return String(iri);
  }

  const fragmentIndex = iri.lastIndexOf("#");
  const pathIndex = iri.lastIndexOf("/");
  const separatorIndex = Math.max(fragmentIndex, pathIndex);
  const shortIri = separatorIndex >= 0 ? iri.slice(separatorIndex + 1) : iri;

  if (!shortIri) {
    return iri;
  }

  try {
    return decodeURIComponent(shortIri);
  } catch {
    return shortIri;
  }
}

export function resourceCategory(node) {
  if (!node || !Array.isArray(node.types)) {
    return "resource";
  }

  for (const type of node.types) {
    const category = RESOURCE_CATEGORIES.get(type);
    if (category) {
      return category;
    }
  }

  return "resource";
}

function sourceLocation(recordIndex, subjectIri, predicateIri, valueIndex) {
  let location = `record ${recordIndex}`;
  if (subjectIri !== undefined) {
    location += ` subject ${subjectIri}`;
  }
  if (predicateIri !== undefined) {
    location += ` predicate ${predicateIri}`;
  }
  if (valueIndex !== undefined) {
    location += ` value ${valueIndex}`;
  }
  return location;
}

function fail(location, message) {
  throw new TypeError(`${location}: ${message}`);
}

function assertNonEmptyIri(value, location, description) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(location, `${description} must be a non-empty string`);
  }
}

function assertPredicateIri(value, location) {
  if (typeof value !== "string" || value.trim() === "" || /\s/.test(value)) {
    fail(location, "predicate must be a valid absolute IRI");
  }

  const schemeMatch = value.match(/^[A-Za-z][A-Za-z\d+.-]*:/);
  if (!schemeMatch) {
    fail(location, "predicate must be a valid absolute IRI");
  }
  if (value.slice(schemeMatch[0].length) === "") {
    fail(location, "predicate must be a valid absolute IRI");
  }

  if (schemeMatch[0].toLowerCase() === "http:" || schemeMatch[0].toLowerCase() === "https:") {
    try {
      const parsed = new URL(value);
      if (!parsed.hostname) {
        fail(location, "predicate must be a valid absolute IRI");
      }
    } catch {
      fail(location, "predicate must be a valid absolute IRI");
    }
  }
}

function validateLiteral(value, location) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(location, "value must be an object containing @id or @value");
  }

  const keys = Object.keys(value);
  const hasIri = Object.prototype.hasOwnProperty.call(value, "@id");
  const hasLiteral = Object.prototype.hasOwnProperty.call(value, "@value");

  if (hasIri) {
    if (keys.length !== 1) {
      fail(location, "IRI value objects may contain only @id");
    }
    assertNonEmptyIri(value["@id"], location, "@id");
    return { kind: "iri", iri: value["@id"] };
  }

  if (!hasLiteral) {
    fail(location, "value object must contain @id or @value");
  }

  const allowedKeys = new Set(["@value", "@language", "@type"]);
  const unknownKey = keys.find((key) => !allowedKeys.has(key));
  if (unknownKey) {
    fail(location, `literal value object contains unknown keyword ${unknownKey}`);
  }
  if (Object.prototype.hasOwnProperty.call(value, "@language")) {
    assertNonEmptyIri(value["@language"], location, "@language");
  }
  if (Object.prototype.hasOwnProperty.call(value, "@type")) {
    assertNonEmptyIri(value["@type"], location, "@type");
  }

  return {
    kind: "literal",
    lexicalValue: value["@value"],
    language: value["@language"],
    datatypeIri: value["@type"],
  };
}

function ensureResource(resources, iri) {
  let resource = resources.get(iri);
  if (!resource) {
    resource = {
      iri,
      declared: false,
      recordIndexes: [],
      types: [],
      label: undefined,
    };
    resources.set(iri, resource);
  }
  return resource;
}

function addUnique(items, value) {
  if (!items.includes(value)) {
    items.push(value);
  }
}

function literalLabel(value) {
  return String(value);
}

export function normalizeJsonLd(document, { version, sourceUrl }) {
  if (!Array.isArray(document)) {
    throw new TypeError("JSON-LD document must be a top-level array");
  }

  const resources = new Map();
  const validatedRecords = [];

  document.forEach((record, recordIndex) => {
    const recordLocation = sourceLocation(recordIndex);
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      fail(recordLocation, "subject record must be an object");
    }

    if (!Object.prototype.hasOwnProperty.call(record, "@id")) {
      fail(recordLocation, "subject record must contain @id");
    }
    const subjectIri = record["@id"];
    assertNonEmptyIri(subjectIri, recordLocation, "@id");

    const predicateEntries = Object.entries(record).filter(([key]) => key !== "@id");
    predicateEntries.forEach(([predicate, values]) => {
      if (predicate.startsWith("@") && predicate !== "@type") {
        fail(sourceLocation(recordIndex, subjectIri, predicate), `unknown keyword ${predicate}`);
      }
      if (predicate !== "@type") {
        assertPredicateIri(predicate, sourceLocation(recordIndex, subjectIri, predicate));
      }
      if (!Array.isArray(values)) {
        fail(
          sourceLocation(recordIndex, subjectIri, predicate),
          "predicate value must be an array",
        );
      }
      if (predicate === "@type") {
        values.forEach((typeIri, valueIndex) => {
          assertNonEmptyIri(
            typeIri,
            sourceLocation(recordIndex, subjectIri, predicate, valueIndex),
            "type value",
          );
        });
      } else {
        values.forEach((value, valueIndex) => {
          validateLiteral(
            value,
            sourceLocation(recordIndex, subjectIri, predicate, valueIndex),
          );
        });
      }
    });

    const resource = ensureResource(resources, subjectIri);
    resource.declared = true;
    resource.recordIndexes.push(recordIndex);
    validatedRecords.push({ record, recordIndex, subjectIri, predicateEntries });
  });

  const assertions = [];
  const literalNodes = [];
  let ordinal = 0;

  for (const { recordIndex, subjectIri, predicateEntries } of validatedRecords) {
    predicateEntries.forEach(([predicate, values], predicateIndex) => {
      values.forEach((value, valueIndex) => {
        const assertionId = `assertion:${encodeURIComponent(version)}:${recordIndex}:${predicateIndex}:${valueIndex}`;
        const location = sourceLocation(recordIndex, subjectIri, predicate, valueIndex);
        const assertion = {
          id: assertionId,
          version,
          ordinal,
          subjectIri,
          predicateIri: predicate === "@type" ? RDF_TYPE : predicate,
          sourceRecordIndex: recordIndex,
          sourceValueIndex: valueIndex,
        };
        ordinal += 1;

        let object;
        if (predicate === "@type") {
          object = { kind: "iri", iri: value };
        } else {
          object = validateLiteral(value, location);
        }

        if (object.kind === "iri") {
          assertion.objectKind = "iri";
          assertion.objectIri = object.iri;
          ensureResource(resources, object.iri);
        } else {
          assertion.objectKind = "literal";
          assertion.lexicalValue = object.lexicalValue;
          if (object.language !== undefined) {
            assertion.language = object.language;
          }
          if (object.datatypeIri !== undefined) {
            assertion.datatypeIri = object.datatypeIri;
          }
          const literalNode = {
            id: `literal:${assertionId}`,
            kind: "literal",
            lexicalValue: object.lexicalValue,
            assertionId,
            label: literalLabel(object.lexicalValue),
          };
          if (object.language !== undefined) {
            literalNode.language = object.language;
          }
          if (object.datatypeIri !== undefined) {
            literalNode.datatypeIri = object.datatypeIri;
          }
          literalNodes.push(literalNode);
        }

        const subjectResource = ensureResource(resources, subjectIri);
        if (assertion.predicateIri === RDF_TYPE && assertion.objectKind === "iri") {
          addUnique(subjectResource.types, assertion.objectIri);
        }
        if (
          assertion.predicateIri === RDFS_LABEL &&
          assertion.objectKind === "literal" &&
          subjectResource.label === undefined
        ) {
          subjectResource.label = literalLabel(assertion.lexicalValue);
        }

        assertions.push(assertion);
      });
    });
  }

  const resourceNodes = [...resources.values()].map((resource) => ({
    id: `resource:${resource.iri}`,
    kind: "resource",
    iri: resource.iri,
    declared: resource.declared,
    recordIndexes: [...resource.recordIndexes],
    types: [...resource.types],
    label: resource.label ?? shortenIri(resource.iri),
  }));

  return {
    version,
    sourceUrl,
    subjects: document.length,
    assertions,
    nodes: [...resourceNodes, ...literalNodes],
  };
}
