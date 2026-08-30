import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeJsonLd } from "../assets/graph-model.mjs";
import {
  FILE_PROTOCOL_REMEDY,
  isNarrowGraphViewport,
  releaseFailureMessage,
} from "../assets/app.mjs";
import {
  GRAPH_PALETTES,
  contrastRatio,
  createGraphView,
} from "../assets/graph-view.mjs";
import { metadataOrNotAsserted } from "../assets/details-view.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const visualizationDirectory = path.resolve(testDirectory, "..");

function makeCollection() {
  const classes = new Set();
  return {
    addClass(value) {
      classes.add(value);
      return this;
    },
    removeClass(value) {
      classes.delete(value);
      return this;
    },
    toggleClass(value, enabled) {
      if (enabled) {
        classes.add(value);
      } else {
        classes.delete(value);
      }
      return this;
    },
    unselect() { return this; },
    forEach() {},
    classes,
  };
}

test("same-release graph refresh updates visibility without rebuilding or relayout", () => {
  const calls = { create: 0, destroy: 0, layout: 0, selected: 0 };
  const elements = makeCollection();
  const selectedElement = {
    nonempty: () => true,
    addClass: function addClass() {
      calls.selected += 1;
      return this;
    },
    select: () => {},
  };
  const fakeCy = {
    elements: () => elements,
    nodes: () => ({ forEach() {} }),
    edges: () => ({ forEach() {} }),
    getElementById: () => selectedElement,
    on: () => {},
    layout: () => ({ run: () => { calls.layout += 1; } }),
    destroy: () => { calls.destroy += 1; },
  };
  const previousCytoscape = globalThis.cytoscape;
  globalThis.cytoscape = () => {
    calls.create += 1;
    return fakeCy;
  };

  try {
    const view = createGraphView({
      container: { append: () => {}, replaceChildren: () => {} },
    });
    const graph = { version: "test", nodes: [], assertions: [] };
    view.render({ graph, visibleNodeIds: [], visibleAssertionIds: [] });
    view.select({ kind: "resource", id: "resource:test" });
    view.render({ graph, visibleNodeIds: ["resource:test"], visibleAssertionIds: [] });

    assert.equal(calls.create, 1);
    assert.equal(calls.destroy, 0);
    assert.equal(calls.layout, 1);
    assert.ok(calls.selected >= 2);
  } finally {
    globalThis.cytoscape = previousCytoscape;
  }
});

test("light and dark graph label palettes meet the small-text contrast target", () => {
  for (const palette of Object.values(GRAPH_PALETTES)) {
    assert.ok(contrastRatio(palette.labelInk, palette.labelBackground) >= 4.5);
    for (const fill of Object.values(palette.nodeFills)) {
      assert.ok(contrastRatio(palette.nodeLabel, fill) >= 4.5);
    }
  }
});

test("failed release messaging identifies the requested failure and retained release", () => {
  assert.match(
    releaseFailureMessage("Version 1.0", "Version 2.0", new Error("returned HTTP 503")),
    /Version 1\.0.*failed.*503.*Version 2\.0.*remains displayed/i,
  );
});

test("file protocol remedy names the bounded local HTTP server and URL", () => {
  assert.match(FILE_PROTOCOL_REMEDY, /python3 -m http\.server 4173 --bind 127\.0\.0\.1/);
  assert.match(FILE_PROTOCOL_REMEDY, /http:\/\/127\.0\.0\.1:4173\/visualization\//);
});

test("narrow graph disclosure is enabled only at the compact breakpoint", () => {
  assert.equal(isNarrowGraphViewport(767), true);
  assert.equal(isNarrowGraphViewport(768), false);
});

test("external source metadata uses Not asserted instead of an empty value", () => {
  assert.equal(metadataOrNotAsserted([]), "Not asserted");
  assert.equal(metadataOrNotAsserted(undefined), "Not asserted");
  assert.deepEqual(metadataOrNotAsserted([0, 1]), [0, 1]);
});

test("predicate keys must be valid absolute IRIs with source location", () => {
  for (const predicate of ["", "not an iri", "https://", "https://example.test/p with-space"]) {
    assert.throws(
      () => normalizeJsonLd([
        { "@id": "https://example.test/A", [predicate]: [] },
      ], { version: "test", sourceUrl: "memory:" }),
      (error) => error instanceof TypeError &&
        /record 0.*subject https:\/\/example\.test\/A.*predicate.*IRI/i.test(error.message),
    );
  }
});

test("shell uses direct listbox options and has narrow graph disclosure", () => {
  const html = fs.readFileSync(path.join(visualizationDirectory, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(visualizationDirectory, "assets/app.mjs"), "utf8");
  assert.match(html, /id="graph-disclosure"/);
  assert.match(html, /aria-controls="graph-overview"/);
  assert.match(app, /button\.setAttribute\("role", "option"\)/);
  assert.doesNotMatch(html, /<li[^>]+role="option"/);
});
