import { RDF_TYPE, shortenIri } from "./graph-model.mjs";

const FACET_KEYS = [
  "kinds",
  "declared",
  "namespaces",
  "rdfTypes",
  "predicates",
  "datatypes",
  "languages",
];

const KIND_ORDER = new Map([
  ["resource", 0],
  ["literal", 1],
  ["assertion", 2],
]);

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

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null))];
}

function stringValue(value) {
  return String(value);
}

function searchableText(values) {
  return unique(values.map(stringValue)).join("\n").toLowerCase();
}

function namespaceForIri(iri) {
  if (typeof iri !== "string") {
    return undefined;
  }

  const fragmentIndex = iri.lastIndexOf("#");
  const pathIndex = iri.lastIndexOf("/");
  const separatorIndex = Math.max(fragmentIndex, pathIndex);
  if (separatorIndex < 0 || separatorIndex === iri.length - 1) {
    return iri;
  }
  return iri.slice(0, separatorIndex + 1);
}

function assertionSearchValues(assertion) {
  const values = [
    assertion.subjectIri,
    shortenIri(assertion.subjectIri),
    assertion.predicateIri,
    shortenIri(assertion.predicateIri),
    assertion.objectIri,
    assertion.objectIri === undefined ? undefined : shortenIri(assertion.objectIri),
    assertion.lexicalValue,
    assertion.language,
    assertion.datatypeIri,
    assertion.datatypeIri === undefined ? undefined : shortenIri(assertion.datatypeIri),
  ];
  return values;
}

function assertionsForResource(graph, resourceNodes) {
  const relations = new Map(resourceNodes.map((node) => [node.iri, []]));
  const addRelation = (iri, assertion) => {
    const related = relations.get(iri);
    if (related && !related.some(({ id }) => id === assertion.id)) {
      related.push(assertion);
    }
  };

  for (const assertion of graph.assertions) {
    addRelation(assertion.subjectIri, assertion);
    if (assertion.objectKind === "iri") {
      addRelation(assertion.objectIri, assertion);
    }
  }
  return relations;
}

function resourceItem(node, relatedAssertions) {
  const rdfTypes = [...node.types];
  const predicates = unique(relatedAssertions.map(({ predicateIri }) => predicateIri));
  const datatypes = unique(relatedAssertions.map(({ datatypeIri }) => datatypeIri));
  const languages = unique(relatedAssertions.map(({ language }) => language));
  const searchableValues = [
    node.label,
    node.iri,
    shortenIri(node.iri),
    ...rdfTypes,
    ...relatedAssertions.flatMap(assertionSearchValues),
  ];

  return {
    ...node,
    label: node.label,
    displayLabel: node.label,
    namespaces: unique([namespaceForIri(node.iri)]),
    rdfTypes,
    predicates,
    datatypes,
    languages,
    searchText: searchableText(searchableValues),
  };
}

function literalItem(node, assertion) {
  const subjectIri = assertion?.subjectIri;
  const predicateIri = assertion?.predicateIri;
  const datatypes = unique([node.datatypeIri]);
  const languages = unique([node.language]);
  const predicates = unique([predicateIri]);
  const searchableValues = [
    node.label,
    node.lexicalValue,
    node.language,
    node.datatypeIri,
    node.datatypeIri === undefined ? undefined : shortenIri(node.datatypeIri),
    ...(assertion ? assertionSearchValues(assertion) : []),
  ];

  return {
    ...node,
    label: node.label,
    displayLabel: node.label,
    subjectIri,
    predicateIri,
    namespaces: unique([namespaceForIri(subjectIri)]),
    rdfTypes: [],
    predicates,
    datatypes,
    languages,
    searchText: searchableText(searchableValues),
  };
}

function assertionItem(assertion) {
  const rdfTypes =
    assertion.predicateIri === RDF_TYPE && assertion.objectKind === "iri"
      ? [assertion.objectIri]
      : [];
  const datatypes = unique([assertion.datatypeIri]);
  const languages = unique([assertion.language]);
  const objectLabel =
    assertion.objectKind === "iri" ? shortenIri(assertion.objectIri) : stringValue(assertion.lexicalValue);
  const label = `${shortenIri(assertion.subjectIri)} ${shortenIri(assertion.predicateIri)} ${objectLabel}`;

  return {
    ...assertion,
    kind: "assertion",
    label,
    displayLabel: label,
    namespaces: unique([namespaceForIri(assertion.subjectIri)]),
    rdfTypes,
    predicates: [assertion.predicateIri],
    datatypes,
    languages,
    searchText: searchableText(assertionSearchValues(assertion)),
  };
}

export function createExplorerIndex(graph) {
  const resourceNodes = graph.nodes.filter(({ kind }) => kind === "resource");
  const literalNodes = graph.nodes.filter(({ kind }) => kind === "literal");
  const assertionsById = new Map(graph.assertions.map((assertion) => [assertion.id, assertion]));
  const relations = assertionsForResource(graph, resourceNodes);

  const resourceItems = resourceNodes.map((node) => resourceItem(node, relations.get(node.iri) ?? []));
  const literalItems = literalNodes.map((node) =>
    literalItem(node, assertionsById.get(node.assertionId)),
  );
  const assertionItems = graph.assertions.map(assertionItem);

  return {
    graph,
    items: [...resourceItems, ...literalItems, ...assertionItems],
  };
}

function selectedValues(filters, key) {
  const selected = filters?.[key];
  if (selected instanceof Set) {
    return selected;
  }
  if (Array.isArray(selected)) {
    return new Set(selected);
  }
  return new Set();
}

function itemFacetValues(item, key) {
  if (key === "kinds") {
    return item.kind === undefined ? [] : [item.kind];
  }
  const value = item[key];
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

function matchesFacets(item, filters) {
  for (const key of FACET_KEYS) {
    const selected = selectedValues(filters, key);
    if (selected.size === 0) {
      continue;
    }
    if (key === "kinds") {
      if (!selected.has(item.kind)) {
        return false;
      }
      continue;
    }
    const values = itemFacetValues(item, key);
    if (!values.some((value) => selected.has(value))) {
      return false;
    }
  }
  return true;
}

function matchesQuery(item, query) {
  const normalizedQuery = stringValue(query ?? "").trim().toLowerCase();
  return normalizedQuery === "" || item.searchText.includes(normalizedQuery);
}

function compareStrings(left, right) {
  const leftKey = stringValue(left).toLowerCase();
  const rightKey = stringValue(right).toLowerCase();
  if (leftKey < rightKey) {
    return -1;
  }
  if (leftKey > rightKey) {
    return 1;
  }
  return stringValue(left) < stringValue(right) ? -1 : stringValue(left) > stringValue(right) ? 1 : 0;
}

function compareExplorerItems(left, right) {
  const kindOrder = (KIND_ORDER.get(left.kind) ?? Number.MAX_SAFE_INTEGER) -
    (KIND_ORDER.get(right.kind) ?? Number.MAX_SAFE_INTEGER);
  if (kindOrder !== 0) {
    return kindOrder;
  }
  if (left.kind === "assertion" && right.kind === "assertion") {
    return left.ordinal - right.ordinal || compareStrings(left.id, right.id);
  }
  return compareStrings(left.label, right.label) || compareStrings(left.id, right.id);
}

export function queryExplorer(index, filters = defaultFilters()) {
  return index.items
    .filter((item) => matchesQuery(item, filters.query))
    .filter((item) => matchesFacets(item, filters))
    .sort(compareExplorerItems);
}

function compareFacetValues(left, right) {
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }
  return compareStrings(left, right);
}

export function facetOptions(index) {
  return Object.fromEntries(
    FACET_KEYS.map((key) => {
      const values = new Set();
      for (const item of index.items) {
        for (const value of itemFacetValues(item, key)) {
          values.add(value);
        }
      }
      return [key, [...values].sort(compareFacetValues)];
    }),
  );
}

export function selectionForResult(result) {
  if (!result || typeof result.kind !== "string" || typeof result.id !== "string") {
    throw new TypeError("Explorer result must contain string kind and id fields");
  }
  return { kind: result.kind, id: result.id };
}
