import { resourceCategory, shortenIri } from "./graph-model.mjs";

const STYLE = [
  {
    selector: "node",
    style: {
      "background-color": "#4d765d",
      color: "#2e332d",
      label: "data(label)",
      "font-family": "system-ui, sans-serif",
      "font-size": "11px",
      "text-wrap": "wrap",
      "text-max-width": "110px",
      "text-valign": "center",
      "text-halign": "center",
      width: 30,
      height: 30,
      "border-width": 2,
      "border-color": "#f8f4e9",
    },
  },
  {
    selector: "node.literal",
    style: {
      shape: "round-rectangle",
      "background-color": "#bf6545",
      color: "#fffaf0",
      width: 38,
      height: 25,
    },
  },
  {
    selector: "node.class",
    style: { "background-color": "#386f83" },
  },
  {
    selector: "node.property",
    style: { "background-color": "#725c88" },
  },
  {
    selector: "node.ontology",
    style: { "background-color": "#68744d" },
  },
  {
    selector: "node.individual",
    style: { "background-color": "#8c6f43" },
  },
  {
    selector: "node.datatype",
    style: { "background-color": "#8a5b61" },
  },
  {
    selector: "edge",
    style: {
      width: 1.5,
      "line-color": "#9a8d76",
      "target-arrow-color": "#9a8d76",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      label: "data(label)",
      color: "#5d564b",
      "font-family": "system-ui, sans-serif",
      "font-size": "9px",
      "text-background-color": "#f8f4e9",
      "text-background-opacity": 0.9,
      "text-background-padding": "2px",
      "text-rotation": "autorotate",
    },
  },
  {
    selector: ".is-dimmed",
    style: { opacity: 0.18 },
  },
  {
    selector: ".is-selected",
    style: {
      opacity: 1,
      "border-width": 4,
      "border-color": "#bd4d2d",
      "line-color": "#bd4d2d",
      "target-arrow-color": "#bd4d2d",
      width: 38,
      height: 38,
    },
  },
];

function noop() {}

function asError(error, phase) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Graph ${phase} failed: ${message}`);
}

function graphElements(graph, showLiterals) {
  const nodes = graph.nodes.filter((node) => showLiterals || node.kind === "resource");
  const nodeIds = new Set(nodes.map(({ id }) => id));
  const elements = nodes.map((node) => ({
    group: "nodes",
    data: {
      id: node.id,
      kind: node.kind,
      label: node.kind === "resource" ? node.label || shortenIri(node.iri) : String(node.label ?? node.lexicalValue),
      iri: node.iri,
      node,
    },
    classes: node.kind === "literal" ? "literal" : resourceCategory(node),
  }));

  for (const assertion of graph.assertions) {
    const sourceId = `resource:${assertion.subjectIri}`;
    const targetId = assertion.objectKind === "iri"
      ? `resource:${assertion.objectIri}`
      : `literal:${assertion.id}`;
    if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) {
      continue;
    }
    elements.push({
      group: "edges",
      data: {
        ...assertion,
        id: assertion.id,
        kind: "assertion",
        source: sourceId,
        target: targetId,
        label: shortenIri(assertion.predicateIri),
      },
      classes: "assertion",
    });
  }

  return elements;
}

function markVisibility(cy, visibleNodeIds, visibleAssertionIds) {
  const nodeIds = new Set(visibleNodeIds ?? []);
  const assertionIds = new Set(visibleAssertionIds ?? []);
  const hasNodeFilter = nodeIds.size > 0;
  const hasAssertionFilter = assertionIds.size > 0;

  cy.nodes().forEach((node) => {
    node.toggleClass("is-dimmed", hasNodeFilter && !nodeIds.has(node.id()));
  });
  cy.edges().forEach((edge) => {
    edge.toggleClass("is-dimmed", hasAssertionFilter && !assertionIds.has(edge.id()));
  });
}

export function createGraphView({ container, onSelect = noop, onError = noop } = {}) {
  let cy = null;
  let lastRender = null;

  function report(error, phase) {
    try {
      onError(asError(error, phase));
    } catch {
      // An error reporter must not turn a graph failure into an app failure.
    }
  }

  function destroyGraph() {
    if (cy) {
      cy.destroy();
      cy = null;
    }
  }

  function render(args = {}) {
    lastRender = { ...args };
    try {
      if (!container || typeof container.append !== "function") {
        throw new TypeError("graph container must be a DOM element");
      }
      const cytoscape = globalThis.cytoscape ?? globalThis.window?.cytoscape;
      if (typeof cytoscape !== "function") {
        throw new Error("Cytoscape vendor is unavailable");
      }
      if (!args.graph || !Array.isArray(args.graph.nodes) || !Array.isArray(args.graph.assertions)) {
        throw new TypeError("graph must contain nodes and assertions arrays");
      }

      destroyGraph();
      container.replaceChildren();
      cy = cytoscape({
        container,
        elements: graphElements(args.graph, args.showLiterals === true),
        style: STYLE,
      });
      cy.on("tap", "node", (event) => {
        const node = event.target.data("node");
        if (node) {
          onSelect({ kind: node.kind, id: node.id });
        }
      });
      cy.on("tap", "edge", (event) => {
        onSelect({ kind: "assertion", id: event.target.id() });
      });
      markVisibility(cy, args.visibleNodeIds, args.visibleAssertionIds);
      cy.layout({
        name: "cose",
        animate: false,
        fit: true,
        padding: 24,
        randomize: true,
      }).run();
      return cy;
    } catch (error) {
      destroyGraph();
      report(error, "render");
      return null;
    }
  }

  function select(selection) {
    try {
      if (!cy || !selection || typeof selection.id !== "string") {
        return;
      }
      cy.elements().removeClass("is-selected").unselect();
      const element = cy.getElementById(selection.id);
      if (element.nonempty()) {
        element.addClass("is-selected").select();
      }
    } catch (error) {
      report(error, "selection");
    }
  }

  function fit() {
    try {
      if (cy) {
        cy.fit(undefined, 24);
      }
    } catch (error) {
      report(error, "fit");
    }
  }

  function reset() {
    try {
      if (cy) {
        cy.elements().removeClass("is-selected is-dimmed").unselect();
        markVisibility(cy, lastRender?.visibleNodeIds, lastRender?.visibleAssertionIds);
        cy.fit(undefined, 24);
      }
    } catch (error) {
      report(error, "reset");
    }
  }

  function focusNeighborhood(selection) {
    try {
      if (!cy || !selection || typeof selection.id !== "string") {
        return;
      }
      const target = cy.getElementById(selection.id);
      if (target.empty()) {
        return;
      }
      cy.elements().addClass("is-dimmed");
      target.union(target.neighborhood()).removeClass("is-dimmed");
      cy.elements().removeClass("is-selected").unselect();
      target.addClass("is-selected").select();
    } catch (error) {
      report(error, "focus");
    }
  }

  function retry() {
    if (lastRender) {
      return render(lastRender);
    }
    return null;
  }

  function destroy() {
    destroyGraph();
    lastRender = null;
  }

  return { render, select, fit, reset, focusNeighborhood, retry, destroy };
}
