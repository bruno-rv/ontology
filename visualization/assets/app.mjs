import { normalizeJsonLd } from "./graph-model.mjs";
import {
  createExplorerIndex,
  defaultFilters,
  facetOptions,
  queryExplorer,
  selectionForResult,
} from "./explorer-state.mjs";
import {
  buildAssertionDetails,
  buildNodeDetails,
  renderDetails as renderDetailsView,
} from "./details-view.mjs";
import { createGraphView } from "./graph-view.mjs";

const FACET_KEYS = [
  "kinds",
  "declared",
  "namespaces",
  "rdfTypes",
  "predicates",
  "datatypes",
  "languages",
];

const DEFAULT_GRAPH_FALLBACK = "The graph is an interaction aid. Use the catalog and details below to inspect every asserted value if the canvas is unavailable.";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNonEmptyString(value, description) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${description} must be a non-empty string`);
  }
}

function assertPositiveCount(value, description) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${description} must be a positive integer`);
  }
}

function assertRelativeSource(source) {
  try {
    const resolved = new URL(source, "https://atlas.example/visualization/versions.json");
    if (resolved.origin !== "https://atlas.example" || resolved.protocol !== "https:") {
      throw new TypeError("source must be a relative URL");
    }
  } catch (error) {
    if (error instanceof TypeError && /relative URL/.test(error.message)) {
      throw error;
    }
    throw new TypeError("source must be a valid relative URL");
  }
}

export function validateVersionsManifest(manifest) {
  if (!isRecord(manifest) || !Array.isArray(manifest.versions) || manifest.versions.length === 0) {
    throw new TypeError("versions array is required");
  }

  const seenIds = new Set();
  return manifest.versions.map((version, index) => {
    const location = `versions[${index}]`;
    if (!isRecord(version)) {
      throw new TypeError(`${location} must be an object`);
    }
    assertNonEmptyString(version.id, `${location}.id`);
    if (seenIds.has(version.id)) {
      throw new TypeError(`duplicate release ID: ${version.id}`);
    }
    seenIds.add(version.id);
    assertNonEmptyString(version.label, `${location}.label`);
    assertNonEmptyString(version.source, `${location}.source`);
    assertRelativeSource(version.source);
    assertPositiveCount(version.expectedSubjects, `${location}.expectedSubjects`);
    assertPositiveCount(version.expectedAssertions, `${location}.expectedAssertions`);
    return {
      id: version.id,
      label: version.label,
      source: version.source,
      expectedSubjects: version.expectedSubjects,
      expectedAssertions: version.expectedAssertions,
    };
  });
}

export function assertGraphIntegrity(graph, versionConfig) {
  if (!isRecord(graph) || !Array.isArray(graph.assertions)) {
    throw new TypeError("graph must contain an assertions array");
  }
  if (!isRecord(versionConfig)) {
    throw new TypeError("version configuration is required");
  }
  if (graph.subjects !== versionConfig.expectedSubjects) {
    throw new Error(
      `subject count mismatch for ${versionConfig.id}: expected ${versionConfig.expectedSubjects}, received ${graph.subjects}`,
    );
  }
  if (graph.assertions.length !== versionConfig.expectedAssertions) {
    throw new Error(
      `assertion count mismatch for ${versionConfig.id}: expected ${versionConfig.expectedAssertions}, received ${graph.assertions.length}`,
    );
  }
  return graph;
}

function formatFacetValue(key, value) {
  if (key === "declared") {
    return value ? "Declared" : "External resource";
  }
  return String(value);
}

function selectionKey(selection) {
  return selection ? `${selection.kind}:${selection.id}` : "";
}

function readableError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchJson(url, description) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${description} returned HTTP ${response.status}`);
  }
  return response.json();
}

function createReferences(root) {
  const get = (id) => root.querySelector(`#${id}`);
  return {
    root,
    versionSelect: get("version-select"),
    subjectCount: get("subject-count"),
    assertionCount: get("assertion-count"),
    searchForm: get("search-form"),
    searchInput: get("global-search"),
    loadStatus: get("load-status"),
    loadError: get("load-error"),
    facetForm: get("facet-form"),
    facetOptions: Object.fromEntries(FACET_KEYS.map((key) => [key, get(`facet-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}-options`)])),
    graphCanvas: get("graph-canvas"),
    graphFallback: get("graph-fallback"),
    graphToolbar: get("graph-toolbar"),
    graphFit: get("graph-fit"),
    graphReset: get("graph-reset"),
    graphShowValues: get("graph-show-values"),
    graphFocusNeighborhood: get("graph-focus-neighborhood"),
    resultCount: get("result-count"),
    resultCatalog: get("result-catalog"),
    catalogEmpty: get("catalog-empty"),
    detailsContent: get("details-content"),
  };
}

function emptyDetails(container) {
  container.replaceChildren();
  const message = document.createElement("p");
  message.className = "empty-state";
  message.textContent = "Select a resource, literal, or assertion from the catalog.";
  container.append(message);
}

export function initializeApplication(root = document) {
  const refs = createReferences(root);
  if (!refs.versionSelect || !refs.searchInput || !refs.graphCanvas || !refs.resultCatalog || !refs.detailsContent) {
    throw new Error("Ontology explorer shell is missing required DOM elements");
  }

  const state = {
    refs,
    manifestUrl: null,
    versions: [],
    graph: null,
    sourceDocument: null,
    index: null,
    config: null,
    filters: defaultFilters(),
    selection: null,
    results: [],
    showLiterals: false,
    loadToken: 0,
    graphError: null,
  };

  function announce(message) {
    refs.loadStatus.textContent = message;
  }

  function clearError() {
    refs.loadError.hidden = true;
    refs.loadError.textContent = "";
  }

  function showError(error, { preserveState = true } = {}) {
    const message = readableError(error);
    refs.loadError.hidden = false;
    refs.loadError.textContent = message;
    announce(`Error: ${message}`);
    if (!preserveState) {
      refs.subjectCount.textContent = "Not loaded";
      refs.assertionCount.textContent = "Not loaded";
      refs.resultCount.textContent = "Not loaded";
      refs.resultCatalog.replaceChildren();
      refs.catalogEmpty.hidden = true;
      emptyDetails(refs.detailsContent);
    }
  }

  function currentSelectionIsVisible() {
    if (!state.selection) {
      return true;
    }
    return state.results.some((result) => selectionKey(selectionForResult(result)) === selectionKey(state.selection));
  }

  function resetSelection() {
    state.selection = null;
    emptyDetails(refs.detailsContent);
    graphView.select(null);
    renderCatalog();
  }

  function renderFacets() {
    const options = state.index ? facetOptions(state.index) : {};
    for (const key of FACET_KEYS) {
      const container = refs.facetOptions[key];
      if (!container) {
        continue;
      }
      container.replaceChildren();
      for (const value of options[key] ?? []) {
        const label = document.createElement("label");
        label.className = "facet-option";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.dataset.facet = key;
        input.dataset.value = JSON.stringify(value);
        input.checked = state.filters[key].has(value);
        const text = document.createElement("span");
        text.textContent = formatFacetValue(key, value);
        label.append(input, text);
        container.append(label);
      }
    }
  }

  function renderCatalog() {
    refs.resultCatalog.replaceChildren();
    refs.resultCount.textContent = `${state.results.length} result${state.results.length === 1 ? "" : "s"}`;
    refs.catalogEmpty.hidden = state.results.length !== 0;
    const selected = selectionKey(state.selection);
    for (const result of state.results) {
      const selection = selectionForResult(result);
      const item = document.createElement("li");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(selectionKey(selection) === selected));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "catalog-result";
      button.dataset.kind = result.kind;
      button.dataset.itemId = result.id;
      button.tabIndex = selectionKey(selection) === selected || (!selected && state.results[0] === result) ? 0 : -1;
      button.setAttribute("aria-label", `${result.kind}: ${result.displayLabel ?? result.label}`);
      const kind = document.createElement("span");
      kind.className = "catalog-kind";
      kind.textContent = result.kind;
      const label = document.createElement("span");
      label.className = "catalog-label";
      label.textContent = result.displayLabel ?? result.label;
      button.append(kind, label);
      button.addEventListener("click", () => applySelection(selection));
      button.addEventListener("keydown", (event) => {
        const buttons = [...refs.resultCatalog.querySelectorAll("button.catalog-result")];
        const index = buttons.indexOf(button);
        let nextIndex = -1;
        if (event.key === "ArrowDown") {
          nextIndex = Math.min(buttons.length - 1, index + 1);
        } else if (event.key === "ArrowUp") {
          nextIndex = Math.max(0, index - 1);
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = buttons.length - 1;
        }
        if (nextIndex >= 0 && nextIndex !== index) {
          event.preventDefault();
          buttons.forEach((candidate, candidateIndex) => {
            candidate.tabIndex = candidateIndex === nextIndex ? 0 : -1;
          });
          buttons[nextIndex].focus();
        }
      });
      item.append(button);
      refs.resultCatalog.append(item);
    }
  }

  function renderGraph() {
    refs.graphCanvas.setAttribute("aria-busy", "true");
    const rendered = graphView.render({
      graph: state.graph,
      visibleNodeIds: state.results.filter(({ kind }) => kind !== "assertion").map(({ id }) => id),
      visibleAssertionIds: state.results.filter(({ kind }) => kind === "assertion").map(({ id }) => id),
      showLiterals: state.showLiterals,
    });
    refs.graphCanvas.setAttribute("aria-busy", "false");
    if (rendered && state.graphError) {
      clearGraphError();
    }
  }

  function refresh() {
    if (!state.index) {
      return;
    }
    state.results = queryExplorer(state.index, state.filters);
    if (!currentSelectionIsVisible()) {
      resetSelection();
    }
    renderFacets();
    renderCatalog();
    renderGraph();
  }

  async function copyCanonical(value) {
    const text = String(value);
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        announce(`Copied ${text}`);
        return;
      }
    } catch {
      // Fall through to the selection-based clipboard API.
    }
    let copied = false;
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      copied = typeof document.execCommand === "function" && document.execCommand("copy");
      textarea.remove();
    } catch {
      copied = false;
    }
    announce(copied ? `Copied ${text}` : `Unable to copy ${text}`);
  }

  function applySelection(selection) {
    if (!state.graph || !selection || typeof selection.id !== "string") {
      return;
    }
    try {
      const details = selection.kind === "assertion"
        ? buildAssertionDetails(state.graph, selection.id)
        : buildNodeDetails(state.graph, state.sourceDocument, selection.id);
      state.selection = { kind: selection.kind, id: selection.id };
      renderDetailsView(refs.detailsContent, details, {
        onCopy: copyCanonical,
        onSelect: applySelection,
      });
      graphView.select(state.selection);
      renderCatalog();
      announce(`Selected ${selection.kind}`);
    } catch (error) {
      showError(error);
    }
  }

  function resetFilters({ preserveQuery = false } = {}) {
    const query = preserveQuery ? refs.searchInput.value : "";
    state.filters = defaultFilters();
    state.filters.query = query;
    refs.searchInput.value = query;
    refresh();
  }

  function onGraphError(error) {
    state.graphError = error;
    refs.graphFallback.textContent = "The graph canvas is unavailable. Catalog and details remain available.";
    announce(readableError(error));
    refs.loadError.hidden = false;
    refs.loadError.textContent = readableError(error);
    let retryButton = refs.graphToolbar.querySelector("#graph-retry");
    if (!retryButton) {
      retryButton = document.createElement("button");
      retryButton.type = "button";
      retryButton.className = "button button-subtle";
      retryButton.id = "graph-retry";
      retryButton.textContent = "Retry graph";
      retryButton.addEventListener("click", () => {
        if (graphView.retry()) {
          clearGraphError();
        }
      });
      refs.graphToolbar.append(retryButton);
    }
  }

  function clearGraphError() {
    state.graphError = null;
    refs.graphFallback.textContent = DEFAULT_GRAPH_FALLBACK;
    refs.graphToolbar.querySelector("#graph-retry")?.remove();
    clearError();
    announce(state.config ? `${state.config.label} loaded: ${state.graph.subjects} subjects / ${state.graph.assertions.length} assertions.` : "Graph available.");
  }

  function onFacetChange(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.facet) {
      return;
    }
    const key = input.dataset.facet;
    const value = JSON.parse(input.dataset.value);
    if (input.checked) {
      state.filters[key].add(value);
    } else {
      state.filters[key].delete(value);
    }
    refresh();
  }

  async function loadRelease(config) {
    const token = ++state.loadToken;
    announce(`Loading ${config.label}…`);
    clearError();
    const sourceUrl = new URL(config.source, state.manifestUrl);
    try {
      const document = await fetchJson(sourceUrl.href, `${config.label} source`);
      const graph = normalizeJsonLd(document, { version: config.id, sourceUrl: sourceUrl.href });
      assertGraphIntegrity(graph, config);
      const index = createExplorerIndex(graph);
      if (token !== state.loadToken) {
        return;
      }
      state.graph = graph;
      state.sourceDocument = document;
      state.index = index;
      state.config = config;
      refs.subjectCount.textContent = String(graph.subjects);
      refs.assertionCount.textContent = String(graph.assertions.length);
      announce(`${config.label} loaded: ${graph.subjects} subjects / ${graph.assertions.length} assertions.`);
      refresh();
    } catch (error) {
      if (token !== state.loadToken) {
        return;
      }
      showError(error, { preserveState: Boolean(state.graph) });
    }
  }

  function populateVersions() {
    const requested = refs.versionSelect.value || "2.0";
    refs.versionSelect.replaceChildren();
    for (const version of state.versions) {
      const option = document.createElement("option");
      option.value = version.id;
      option.textContent = version.label;
      refs.versionSelect.append(option);
    }
    const selected = state.versions.some(({ id }) => id === requested) ? requested : state.versions[0].id;
    refs.versionSelect.value = selected;
    return state.versions.find(({ id }) => id === selected) ?? state.versions[0];
  }

  function wireEvents() {
    refs.searchInput.addEventListener("input", () => {
      state.filters.query = refs.searchInput.value;
      refresh();
    });
    refs.searchForm?.addEventListener("reset", (event) => {
      event.preventDefault();
      refs.searchInput.value = "";
      state.filters.query = "";
      refresh();
    });
    refs.facetForm?.addEventListener("change", onFacetChange);
    refs.facetForm?.addEventListener("reset", (event) => {
      event.preventDefault();
      resetFilters({ preserveQuery: true });
    });
    refs.versionSelect.addEventListener("change", () => {
      const config = state.versions.find(({ id }) => id === refs.versionSelect.value);
      if (!config) {
        return;
      }
      state.filters = defaultFilters();
      state.filters.query = refs.searchInput.value;
      resetSelection();
      loadRelease(config);
    });
    refs.graphFit?.addEventListener("click", () => graphView.fit());
    refs.graphReset?.addEventListener("click", () => graphView.reset());
    refs.graphShowValues?.addEventListener("click", () => {
      state.showLiterals = !state.showLiterals;
      refs.graphShowValues.setAttribute("aria-pressed", String(state.showLiterals));
      announce(state.showLiterals ? "Literal values shown in graph." : "Literal values hidden in graph.");
      if (state.graph) {
        renderGraph();
      }
    });
    refs.graphFocusNeighborhood?.addEventListener("click", () => {
      if (!state.selection) {
        announce("Select a catalog item before focusing its neighborhood.");
        return;
      }
      graphView.focusNeighborhood(state.selection);
    });
  }

  const graphView = createGraphView({
    container: refs.graphCanvas,
    onSelect: applySelection,
    onError: onGraphError,
  });
  wireEvents();
  emptyDetails(refs.detailsContent);

  const ready = (async () => {
    try {
      const manifestUrl = new URL("versions.json", document.baseURI);
      const manifest = await fetchJson(manifestUrl.href, "Version manifest");
      state.manifestUrl = manifestUrl;
      state.versions = validateVersionsManifest(manifest);
      const initialVersion = populateVersions();
      await loadRelease(initialVersion);
    } catch (error) {
      showError(error, { preserveState: false });
    }
  })();

  return { state, refs, graphView, ready };
}

function installInlineFavicon() {
  if (typeof document === "undefined" || !document.head || document.querySelector('link[rel="icon"]')) {
    return;
  }
  const favicon = document.createElement("link");
  favicon.rel = "icon";
  favicon.href = "data:,";
  document.head.append(favicon);
}

if (typeof document !== "undefined") {
  installInlineFavicon();
  const boot = () => {
    if (!document.documentElement.dataset.ontologyExplorerInitialized) {
      document.documentElement.dataset.ontologyExplorerInitialized = "true";
      initializeApplication();
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}
