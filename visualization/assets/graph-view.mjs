import { resourceCategory, shortenIri } from "./graph-model.mjs";

export const GRAPH_PALETTES = Object.freeze({
  light: Object.freeze({
    labelInk: "#25231f",
    labelBackground: "#fffaf0",
    nodeLabel: "#25231f",
    selected: "#8c2414",
    edge: "#6d6253",
    nodeFills: Object.freeze({
      resource: "#27513e",
      class: "#1f566d",
      property: "#553b65",
      ontology: "#4f5f2d",
      individual: "#70491f",
      datatype: "#6d3941",
      literal: "#7d321d",
    }),
  }),
  dark: Object.freeze({
    labelInk: "#f6efe0",
    labelBackground: "#25261f",
    nodeLabel: "#f6efe0",
    selected: "#ffb39a",
    edge: "#c5b8a4",
    nodeFills: Object.freeze({
      resource: "#a7d3b6",
      class: "#a8d0de",
      property: "#c9acd7",
      ontology: "#c2d39a",
      individual: "#d7b98e",
      datatype: "#d7a8ae",
      literal: "#e9a58c",
    }),
  }),
});

function channelValue(value) {
  const normalized = value.replace(/^#/, "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((channel) => channel + channel).join("")
    : normalized;
  return Number.parseInt(expanded, 16) / 255;
}

function relativeLuminance(color) {
  const normalized = color.replace(/^#/, "");
  const channels = [0, 2, 4].map((offset) => channelValue(normalized.slice(offset, offset + 2)));
  return channels.reduce((sum, channel, index) => sum + (channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index], 0);
}

export function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function graphPalette(container) {
  if (typeof getComputedStyle === "function") {
    const theme = getComputedStyle(container).getPropertyValue("--graph-theme").trim();
    if (theme === "dark") {
      return GRAPH_PALETTES.dark;
    }
  }
  return GRAPH_PALETTES.light;
}

export function graphStyleForPalette(palette) {
  const nodeLabelStyle = {
    color: palette.nodeLabel,
    "text-background-color": palette.labelBackground,
    "text-background-opacity": 1,
    "text-background-padding": "2px",
    "text-background-shape": "roundrectangle",
  };
  const baseNode = {
    ...nodeLabelStyle,
    "background-color": palette.nodeFills.resource,
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
    "border-color": palette.labelBackground,
  };

  return [
    { selector: "node", style: baseNode },
    {
      selector: "node.literal",
      style: {
        ...nodeLabelStyle,
        shape: "round-rectangle",
        "background-color": palette.nodeFills.literal,
        width: 38,
        height: 25,
      },
    },
    { selector: "node.class", style: { ...nodeLabelStyle, "background-color": palette.nodeFills.class } },
    { selector: "node.property", style: { ...nodeLabelStyle, "background-color": palette.nodeFills.property } },
    { selector: "node.ontology", style: { ...nodeLabelStyle, "background-color": palette.nodeFills.ontology } },
    { selector: "node.individual", style: { ...nodeLabelStyle, "background-color": palette.nodeFills.individual } },
    { selector: "node.datatype", style: { ...nodeLabelStyle, "background-color": palette.nodeFills.datatype } },
    {
      selector: "edge",
      style: {
        width: 1.5,
        "line-color": palette.edge,
        "target-arrow-color": palette.edge,
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        label: "data(label)",
        color: palette.labelInk,
        "font-family": "system-ui, sans-serif",
        "font-size": "9px",
        "text-background-color": palette.labelBackground,
        "text-background-opacity": 1,
        "text-background-padding": "2px",
        "text-rotation": "autorotate",
      },
    },
    { selector: ".is-dimmed", style: { opacity: 0.18 } },
    {
      selector: ".is-selected",
      style: {
        opacity: 1,
        "border-width": 4,
        "border-color": palette.selected,
        "line-color": palette.selected,
        "target-arrow-color": palette.selected,
        width: 38,
        height: 38,
      },
    },
  ];
}

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
  let graphReference = null;
  let showingLiterals = false;
  let selectedSelection = null;

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
    graphReference = null;
  }

  function positionsFor(cytoscapeInstance) {
    const positions = new Map();
    cytoscapeInstance?.nodes?.()?.forEach?.((node) => {
      if (typeof node.position !== "function") {
        return;
      }
      const position = node.position();
      if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
        positions.set(node.id(), { x: position.x, y: position.y });
      }
    });
    return positions;
  }

  function restorePositions(cytoscapeInstance, positions) {
    for (const [id, position] of positions) {
      const element = cytoscapeInstance.getElementById(id);
      if (element.nonempty?.() && typeof element.position === "function") {
        element.position(position);
      }
    }
  }

  function applySelection({ clearWhenEmpty = false } = {}) {
    if (!cy) {
      return;
    }
    if (!selectedSelection && !clearWhenEmpty) {
      return;
    }
    cy.elements().removeClass("is-selected").unselect();
    if (!selectedSelection || typeof selectedSelection.id !== "string") {
      return;
    }
    const element = cy.getElementById(selectedSelection.id);
    const exists = element.nonempty?.() ?? !element.empty?.();
    if (exists) {
      element.addClass("is-selected").select();
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

      const nextShowLiterals = args.showLiterals === true;
      const needsRebuild = !cy || graphReference !== args.graph || showingLiterals !== nextShowLiterals;
      if (needsRebuild) {
        const positions = cy && graphReference === args.graph ? positionsFor(cy) : new Map();
        if (graphReference !== null && graphReference !== args.graph) {
          selectedSelection = null;
        }
        destroyGraph();
        container.replaceChildren();
        cy = cytoscape({
          container,
          elements: graphElements(args.graph, nextShowLiterals),
          style: graphStyleForPalette(graphPalette(container)),
        });
        graphReference = args.graph;
        showingLiterals = nextShowLiterals;
        cy.on("tap", "node", (event) => {
          const node = event.target.data("node");
          if (node) {
            onSelect({ kind: node.kind, id: node.id });
          }
        });
        cy.on("tap", "edge", (event) => {
          onSelect({ kind: "assertion", id: event.target.id() });
        });
        cy.layout({
          name: "cose",
          animate: false,
          fit: true,
          padding: 24,
          randomize: positions.size === 0,
        }).run();
        restorePositions(cy, positions);
      }
      markVisibility(cy, args.visibleNodeIds, args.visibleAssertionIds);
      applySelection();
      return cy;
    } catch (error) {
      destroyGraph();
      report(error, "render");
      return null;
    }
  }

  function select(selection) {
    try {
      selectedSelection = selection && typeof selection.id === "string"
        ? { kind: selection.kind, id: selection.id }
        : null;
      applySelection({ clearWhenEmpty: true });
    } catch (error) {
      report(error, "selection");
    }
  }

  function fit() {
    try {
      if (cy) {
        cy.resize?.();
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
      selectedSelection = null;
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
      selectedSelection = { kind: selection.kind, id: selection.id };
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
    selectedSelection = null;
  }

  return { render, select, fit, reset, focusNeighborhood, retry, destroy };
}
