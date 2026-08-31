import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeJsonLd } from "../assets/graph-model.mjs";
import { assertGraphIntegrity, validateVersionsManifest } from "../assets/app.mjs";
import { createGraphView } from "../assets/graph-view.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(testDirectory, "../..");
const expectedVersions = [
  {
    id: "1.0",
    label: "Version 1.0",
    source: "../1.0/dh-atlas.jsonld",
    expectedSubjects: 89,
    expectedAssertions: 348,
  },
  {
    id: "2.0",
    label: "Version 2.0",
    source: "../2.0/dh-atlas.jsonld",
    expectedSubjects: 82,
    expectedAssertions: 375,
  },
];

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(projectDirectory, "visualization/versions.json"), "utf8"));
}

function readCanonicalGraph(version) {
  const document = JSON.parse(
    fs.readFileSync(path.resolve(projectDirectory, "visualization", version.source), "utf8"),
  );
  return normalizeJsonLd(document, {
    version: version.id,
    sourceUrl: version.source,
  });
}

test("validates the configured releases and their canonical source paths", () => {
  const normalizedVersions = validateVersionsManifest(readManifest());

  assert.deepEqual(normalizedVersions, expectedVersions);
  for (const version of normalizedVersions) {
    assert.equal(fs.existsSync(path.resolve(projectDirectory, "visualization", version.source)), true);
    assertGraphIntegrity(readCanonicalGraph(version), version);
  }
});

test("rejects malformed manifests, duplicate release IDs, missing sources, and invalid counts", () => {
  assert.throws(() => validateVersionsManifest(null), /versions array/);
  assert.throws(
    () =>
      validateVersionsManifest({
        versions: [expectedVersions[0], { ...expectedVersions[0], label: "Duplicate" }],
      }),
    /duplicate release ID.*1\.0/i,
  );
  assert.throws(
    () => validateVersionsManifest({ versions: [{ ...expectedVersions[0], source: "" }] }),
    /source.*non-empty/i,
  );
  assert.throws(
    () => validateVersionsManifest({ versions: [{ ...expectedVersions[0], expectedSubjects: 0 }] }),
    /expectedSubjects.*positive/i,
  );
  assert.throws(
    () => validateVersionsManifest({ versions: [{ ...expectedVersions[0], expectedAssertions: -1 }] }),
    /expectedAssertions.*positive/i,
  );
});

test("rejects absolute, protocol-relative, and non-canonical source URLs", () => {
  assert.throws(
    () => validateVersionsManifest({ versions: [{ ...expectedVersions[0], source: "https://atlas.example/1.0/dh-atlas.jsonld" }] }),
    /relative/i,
  );
  assert.throws(
    () => validateVersionsManifest({ versions: [{ ...expectedVersions[0], source: "//atlas.example/1.0/dh-atlas.jsonld" }] }),
    /relative/i,
  );
  assert.throws(
    () => validateVersionsManifest({ versions: [{ ...expectedVersions[0], source: "../3.0/dh-atlas.jsonld" }] }),
    /canonical/i,
  );
});

test("rejects parser-equivalent sources with whitespace or backslashes", () => {
  assert.throws(
    () => validateVersionsManifest({ versions: [{ ...expectedVersions[0], source: " https://atlas.example/1.0/dh-atlas.jsonld" }] }),
    /relative/i,
  );
  assert.throws(
    () => validateVersionsManifest({ versions: [{ ...expectedVersions[0], source: " //atlas.example/1.0/dh-atlas.jsonld" }] }),
    /relative/i,
  );
  assert.throws(
    () => validateVersionsManifest({ versions: [{ ...expectedVersions[0], source: String.raw`\\atlas.example\1.0\dh-atlas.jsonld` }] }),
    /relative/i,
  );
});

test("rejects subject count mismatch without mutating the last accepted graph", () => {
  const graph = {
    version: "test",
    subjects: 2,
    assertions: [{ id: "a" }, { id: "b" }],
    nodes: [{ id: "resource:test", kind: "resource" }],
  };
  const before = structuredClone(graph);

  assert.throws(
    () => assertGraphIntegrity(graph, { id: "test", expectedSubjects: 3, expectedAssertions: 2 }),
    /subject count mismatch/i,
  );
  assert.deepEqual(graph, before);
});

test("rejects assertion count mismatch without mutating the last accepted graph", () => {
  const graph = {
    version: "test",
    subjects: 2,
    assertions: [{ id: "a" }],
    nodes: [{ id: "resource:test", kind: "resource" }],
  };
  const before = structuredClone(graph);

  assert.throws(
    () => assertGraphIntegrity(graph, { id: "test", expectedSubjects: 2, expectedAssertions: 2 }),
    /assertion count mismatch/i,
  );
  assert.deepEqual(graph, before);
});

test("clearing a graph selection removes the adapter highlight", () => {
  const calls = [];
  const selectedElement = {
    nonempty: () => true,
    addClass: (value) => calls.push(["addClass", value]),
    select: () => calls.push(["select"]),
  };
  const elements = {
    addClass: (value) => calls.push(["elements.addClass", value]),
    removeClass: (value) => calls.push(["elements.removeClass", value]),
    unselect: () => calls.push(["elements.unselect"]),
  };
  const fakeCy = {
    elements: () => elements,
    nodes: () => ({ forEach: () => {} }),
    edges: () => ({ forEach: () => {} }),
    getElementById: () => selectedElement,
    on: () => {},
    layout: () => ({ run: () => {} }),
    destroy: () => {},
  };
  const previousCytoscape = globalThis.cytoscape;
  globalThis.cytoscape = () => fakeCy;
  try {
    const view = createGraphView({
      container: { append: () => {}, replaceChildren: () => {} },
    });
    view.render({ graph: { nodes: [], assertions: [] } });
    view.select({ kind: "resource", id: "resource:test" });
    view.select(null);
    assert.deepEqual(
      calls.filter(([method]) => method === "elements.removeClass"),
      [["elements.removeClass", "is-selected"], ["elements.removeClass", "is-selected"]],
    );
  } finally {
    globalThis.cytoscape = previousCytoscape;
  }
});
