import { shortenIri } from "./graph-model.mjs";

const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const RDFS_COMMENT = "http://www.w3.org/2000/01/rdf-schema#comment";
export const NOT_ASSERTED = "Not asserted";

export function metadataOrNotAsserted(value) {
  if (Array.isArray(value)) {
    return value.length === 0 ? NOT_ASSERTED : value;
  }
  return value === undefined || value === null ? NOT_ASSERTED : value;
}

function valueOrNotAsserted(value) {
  return value === undefined ? NOT_ASSERTED : value;
}

function displayValue(value) {
  return value === undefined ? NOT_ASSERTED : String(value);
}

function assertionObjectValue(assertion) {
  return assertion.objectKind === "iri" ? assertion.objectIri : assertion.lexicalValue;
}

function assertionLocation(assertion) {
  return `record ${assertion.sourceRecordIndex}, value ${assertion.sourceValueIndex}`;
}

function toAssertionDetails(assertion) {
  const details = {
    kind: "assertion",
    id: assertion.id,
    version: assertion.version,
    ordinal: assertion.ordinal,
    subjectIri: assertion.subjectIri,
    predicateIri: assertion.predicateIri,
    objectKind: assertion.objectKind,
    objectValue: assertionObjectValue(assertion),
    language: valueOrNotAsserted(assertion.language),
    datatypeIri: valueOrNotAsserted(assertion.datatypeIri),
    sourceRecordIndex: assertion.sourceRecordIndex,
    sourceValueIndex: assertion.sourceValueIndex,
    sourceLocation: assertionLocation(assertion),
  };

  if (assertion.objectKind === "iri") {
    details.objectIri = assertion.objectIri;
  } else {
    details.lexicalValue = assertion.lexicalValue;
  }

  return details;
}

export function buildAssertionDetails(graph, assertionId) {
  if (!graph || !Array.isArray(graph.assertions)) {
    throw new TypeError("Graph must contain an assertions array");
  }

  const assertion = graph.assertions.find(({ id }) => id === assertionId);
  if (!assertion) {
    throw new Error(`Unknown assertion: ${assertionId}`);
  }

  return toAssertionDetails(assertion);
}

function relatedAssertions(graph, node) {
  const incoming = [];
  const outgoing = [];

  for (const assertion of graph.assertions) {
    if (assertion.subjectIri === node.iri) {
      outgoing.push(toAssertionDetails(assertion));
    }
    if (assertion.objectKind === "iri" && assertion.objectIri === node.iri) {
      incoming.push(toAssertionDetails(assertion));
    }
  }

  return { incoming, outgoing };
}

function rawRecordsFor(sourceDocument, iri, recordIndexes) {
  if (!Array.isArray(sourceDocument)) {
    throw new TypeError("Source document must be a top-level array");
  }

  return sourceDocument.filter(
    (record, index) =>
      record &&
      typeof record === "object" &&
      record["@id"] === iri &&
      (recordIndexes.length === 0 || recordIndexes.includes(index)),
  );
}

function buildResourceDetails(graph, sourceDocument, node) {
  const { incoming, outgoing } = relatedAssertions(graph, node);
  const labels = outgoing
    .filter(({ predicateIri, objectKind }) => predicateIri === RDFS_LABEL && objectKind === "literal")
    .map(({ lexicalValue }) => lexicalValue);
  const comments = outgoing
    .filter(({ predicateIri, objectKind }) => predicateIri === RDFS_COMMENT && objectKind === "literal")
    .map(({ lexicalValue }) => lexicalValue);
  const recordIndexes = Array.isArray(node.recordIndexes) ? [...node.recordIndexes] : [];

  return {
    kind: "resource",
    nodeId: node.id,
    iri: node.iri,
    label: node.label,
    declared: node.declared,
    declarationStatus: node.declared ? "Declared" : "External resource",
    recordIndexes,
    sourceRecordIndexes: [...recordIndexes],
    types: Array.isArray(node.types) ? [...node.types] : [],
    labels,
    comments,
    incomingAssertions: incoming,
    outgoingAssertions: outgoing,
    values: outgoing,
    language: NOT_ASSERTED,
    datatypeIri: NOT_ASSERTED,
    rawSourceRecords: rawRecordsFor(sourceDocument, node.iri, recordIndexes),
  };
}

function buildLiteralDetails(graph, sourceDocument, node) {
  const assertion = graph.assertions.find(({ id }) => id === node.assertionId);
  if (!assertion) {
    throw new Error(`Unknown literal assertion: ${node.assertionId}`);
  }

  const assertionDetails = toAssertionDetails(assertion);
  const rawSourceRecords = Array.isArray(sourceDocument)
    ? rawRecordsFor(sourceDocument, assertion.subjectIri, [assertion.sourceRecordIndex])
    : (() => {
        throw new TypeError("Source document must be a top-level array");
      })();

  return {
    kind: "literal",
    nodeId: node.id,
    label: node.label,
    lexicalValue: node.lexicalValue,
    language: valueOrNotAsserted(node.language),
    datatypeIri: valueOrNotAsserted(node.datatypeIri),
    assertionId: node.assertionId,
    sourceRecordIndex: assertion.sourceRecordIndex,
    sourceValueIndex: assertion.sourceValueIndex,
    subjectIri: assertion.subjectIri,
    predicateIri: assertion.predicateIri,
    assertion: assertionDetails,
    incomingAssertions: [],
    outgoingAssertions: [],
    values: [assertionDetails],
    rawSourceRecords,
  };
}

export function buildNodeDetails(graph, sourceDocument, nodeId) {
  if (!graph || !Array.isArray(graph.nodes)) {
    throw new TypeError("Graph must contain a nodes array");
  }

  const node = graph.nodes.find(({ id }) => id === nodeId);
  if (!node) {
    throw new Error(`Unknown node: ${nodeId}`);
  }

  if (node.kind === "resource") {
    return buildResourceDetails(graph, sourceDocument, node);
  }
  if (node.kind === "literal") {
    return buildLiteralDetails(graph, sourceDocument, node);
  }
  throw new Error(`Unsupported node kind: ${node.kind}`);
}

function appendText(parent, tagName, text, className) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  element.textContent = displayValue(text);
  parent.append(element);
  return element;
}

function appendCopyButton(parent, label, value, onCopy) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "detail-copy";
  button.textContent = `Copy ${label}`;
  button.setAttribute("aria-label", `Copy ${label}: ${displayValue(value)}`);
  button.addEventListener("click", () => onCopy(String(value)));
  parent.append(button);
  return button;
}

function appendDefinition(parent, label, value, { copy, onCopy } = {}) {
  const term = document.createElement("dt");
  term.textContent = label;
  parent.append(term);

  const description = document.createElement("dd");
  const displayMetadata = metadataOrNotAsserted(value);
  if (Array.isArray(displayMetadata)) {
    const list = document.createElement("ul");
    list.className = "detail-values";
    for (const item of displayMetadata) {
      const listItem = document.createElement("li");
      listItem.textContent = displayValue(item);
      list.append(listItem);
    }
    description.append(list);
  } else {
    description.textContent = displayValue(displayMetadata);
  }
  if (copy && onCopy) {
    appendCopyButton(description, copy, value, onCopy);
  }
  parent.append(description);
}

function appendAssertionList(parent, title, assertions, onSelect) {
  const section = document.createElement("section");
  section.className = "detail-assertions";
  appendText(section, "h3", `${title} (${assertions.length})`);
  const list = document.createElement("ul");
  list.className = "assertion-list";

  if (assertions.length === 0) {
    appendText(list, "li", "Not asserted");
  } else {
    for (const assertion of assertions) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "assertion-link";
      button.dataset.assertionId = assertion.id;
      const object = assertion.objectKind === "iri"
        ? assertion.objectIri
        : displayValue(assertion.lexicalValue);
      button.textContent = `${shortenIri(assertion.predicateIri)} → ${object}`;
      button.setAttribute("aria-label", `Select assertion ${assertion.id}`);
      button.addEventListener("click", () => onSelect({ kind: "assertion", id: assertion.id }));
      item.append(button);
      list.append(item);
    }
  }

  section.append(list);
  parent.append(section);
}

function appendRawRecords(parent, records) {
  const section = document.createElement("section");
  section.className = "detail-raw";
  appendText(section, "h3", "Raw source records");
  if (!Array.isArray(records) || records.length === 0) {
    appendText(section, "p", NOT_ASSERTED);
  } else {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(records, null, 2);
    section.append(pre);
  }
  parent.append(section);
}

function appendHeading(parent, text) {
  const heading = document.createElement("h2");
  heading.id = "details-heading";
  heading.textContent = text;
  parent.append(heading);
}

function renderResourceDetails(fragment, details, actions) {
  appendHeading(fragment, details.label || shortenIri(details.iri));
  const definitionList = document.createElement("dl");
  appendDefinition(definitionList, "IRI", details.iri, { copy: "IRI", onCopy: actions.onCopy });
  appendDefinition(definitionList, "Declaration", details.declarationStatus);
  appendDefinition(definitionList, "RDF types", details.types.length ? details.types : NOT_ASSERTED);
  appendDefinition(definitionList, "Labels", details.labels.length ? details.labels : NOT_ASSERTED);
  appendDefinition(definitionList, "Comments", details.comments.length ? details.comments : NOT_ASSERTED);
  appendDefinition(definitionList, "Source record indices", details.recordIndexes);
  fragment.append(definitionList);
  appendAssertionList(fragment, "Outgoing assertions", details.outgoingAssertions, actions.onSelect);
  appendAssertionList(fragment, "Incoming assertions", details.incomingAssertions, actions.onSelect);
  appendRawRecords(fragment, details.rawSourceRecords);
}

function renderLiteralDetails(fragment, details, actions) {
  appendHeading(fragment, "Literal value");
  const definitionList = document.createElement("dl");
  appendDefinition(definitionList, "Value", details.lexicalValue, {
    copy: "value",
    onCopy: actions.onCopy,
  });
  appendDefinition(definitionList, "Language", details.language);
  appendDefinition(definitionList, "Datatype", details.datatypeIri, {
    copy: details.datatypeIri === NOT_ASSERTED ? undefined : "datatype",
    onCopy: actions.onCopy,
  });
  appendDefinition(definitionList, "Source record index", details.sourceRecordIndex);
  appendDefinition(definitionList, "Source value index", details.sourceValueIndex);
  fragment.append(definitionList);
  appendAssertionList(fragment, "Source assertion", [details.assertion], actions.onSelect);
  appendRawRecords(fragment, details.rawSourceRecords);
}

function renderAssertionDetails(fragment, details, actions) {
  appendHeading(fragment, "Assertion");
  const definitionList = document.createElement("dl");
  appendDefinition(definitionList, "Subject", details.subjectIri, {
    copy: "subject IRI",
    onCopy: actions.onCopy,
  });
  appendDefinition(definitionList, "Predicate", details.predicateIri, {
    copy: "predicate IRI",
    onCopy: actions.onCopy,
  });
  if (details.objectKind === "iri") {
    appendDefinition(definitionList, "Object", details.objectIri, {
      copy: "object IRI",
      onCopy: actions.onCopy,
    });
  } else {
    appendDefinition(definitionList, "Literal value", details.lexicalValue, {
      copy: "literal value",
      onCopy: actions.onCopy,
    });
  }
  appendDefinition(definitionList, "Language", details.language);
  appendDefinition(definitionList, "Datatype", details.datatypeIri, {
    copy: details.datatypeIri === NOT_ASSERTED ? undefined : "datatype",
    onCopy: actions.onCopy,
  });
  appendDefinition(definitionList, "Ordinal", details.ordinal);
  appendDefinition(definitionList, "Source record index", details.sourceRecordIndex);
  appendDefinition(definitionList, "Source value index", details.sourceValueIndex);
  fragment.append(definitionList);
}

export function renderDetails(container, details, { onCopy = () => {}, onSelect = () => {} } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Details container must be a DOM element");
  }
  if (!details || typeof details.kind !== "string") {
    throw new TypeError("Details must contain a kind");
  }

  container.replaceChildren();
  const fragment = document.createDocumentFragment();
  const actions = { onCopy, onSelect };

  if (details.kind === "resource") {
    renderResourceDetails(fragment, details, actions);
  } else if (details.kind === "literal") {
    renderLiteralDetails(fragment, details, actions);
  } else if (details.kind === "assertion") {
    renderAssertionDetails(fragment, details, actions);
  } else {
    appendHeading(fragment, "Details");
    appendText(fragment, "p", "Not asserted");
  }

  container.append(fragment);
  return container;
}
