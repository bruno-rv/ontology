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
const ALLOWED_SOURCE_STRINGS = new Set(["../1.0/dh-atlas.jsonld", "../2.0/dh-atlas.jsonld"]);
export const FILE_PROTOCOL_REMEDY = "file:// is not supported because browsers block local JSON fetches. Run python3 -m http.server 4173 --bind 127.0.0.1, then open http://127.0.0.1:4173/visualization/.";

export function isNarrowGraphViewport(width) {
  return Number.isFinite(width) && width < 768;
}

export function releaseFailureMessage(requestedLabel, retainedLabel, error) {
  return `${requestedLabel} failed to load: ${readableError(error)}. ${retainedLabel} remains displayed.`;
}

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
  const trimmedSource = source.trim();
  if (
    trimmedSource !== source ||
    /[\\]/.test(source) ||
    /^[a-z][a-z\d+.-]*:/i.test(trimmedSource) ||
    trimmedSource.startsWith("/")
  ) {
    throw new TypeError("source must be a relative URL");
  }
  if (!ALLOWED_SOURCE_STRINGS.has(source)) {
    throw new TypeError("source must be one of the canonical relative ontology inputs");
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
  if (new URL(url).protocol === "file:") {
    throw new Error(FILE_PROTOCOL_REMEDY);
  }
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
    graphOverview: get("graph-overview"),
    graphDisclosure: get("graph-disclosure"),
    graphFallback: get("graph-fallback"),
    graphError: get("graph-error"),
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
    graphOverviewExpanded: false,
    loadToken: 0,
    graphError: null,
  };

  function syncGraphDisclosure() {
    if (!refs.graphOverview || !refs.graphDisclosure) {
      return;
    }
    const viewportWidth = root.defaultView?.innerWidth ?? globalThis.innerWidth;
    const narrow = isNarrowGraphViewport(viewportWidth);
    refs.graphDisclosure.hidden = !narrow;
    refs.graphDisclosure.setAttribute("aria-expanded", String(!narrow || state.graphOverviewExpanded));
    refs.graphDisclosure.textContent = state.graphOverviewExpanded ? "Hide graph overview" : "Show graph overview";
    refs.graphOverview.hidden = narrow && !state.graphOverviewExpanded;
  }

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

  function resetSelection({ render = true } = {}) {
    state.selection = null;
    emptyDetails(refs.detailsContent);
    graphView.select(null);
    if (render) {
      renderCatalog();
    }
  }

  function captureFocusTarget() {
    const active = document.activeElement;
    if (active?.matches?.("input[data-facet]")) {
      return {
        kind: "facet",
        facet: active.dataset.facet,
        value: active.dataset.value,
      };
    }
    if (active?.matches?.("button.catalog-result")) {
      return {
        kind: "catalog",
        selection: `${active.dataset.kind}:${active.dataset.itemId}`,
      };
    }
    return null;
  }

  function restoreFocusTarget(target) {
    if (!target) {
      return;
    }
    if (target.kind === "facet") {
      const input = [...(refs.facetForm?.querySelectorAll("input[data-facet]") ?? [])]
        .find((candidate) => candidate.dataset.facet === target.facet && candidate.dataset.value === target.value);
      input?.focus();
      return;
    }
    if (target.kind === "catalog") {
      const button = [...refs.resultCatalog.querySelectorAll("button.catalog-result")]
        .find((candidate) => `${candidate.dataset.kind}:${candidate.dataset.itemId}` === target.selection);
      button?.focus();
    }
  }

  function focusCatalogSelection(selection) {
    const selected = selectionKey(selection);
    const button = [...refs.resultCatalog.querySelectorAll("button.catalog-result")]
      .find((candidate) => `${candidate.dataset.kind}:${candidate.dataset.itemId}` === selected);
    button?.focus();
  }

  function renderFacets({ focusTarget = captureFocusTarget() } = {}) {
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
    restoreFocusTarget(focusTarget);
  }

  function renderCatalog({ focusTarget = captureFocusTarget() } = {}) {
    refs.resultCatalog.replaceChildren();
    refs.resultCount.textContent = `${state.results.length} result${state.results.length === 1 ? "" : "s"}`;
    refs.catalogEmpty.hidden = state.results.length !== 0;
    const selected = selectionKey(state.selection);
    for (const result of state.results) {
      const selection = selectionForResult(result);
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(selectionKey(selection) === selected));
      button.className = "catalog-result";
      button.dataset.kind = result.kind;
      button.dataset.itemId = result.id;
      const isSelected = selectionKey(selection) === selected;
      button.dataset.selected = String(isSelected);
      button.tabIndex = isSelected || (!selected && state.results[0] === result) ? 0 : -1;
      button.setAttribute("aria-label", `${result.kind}: ${result.displayLabel ?? result.label}`);
      const selectedIndicator = document.createElement("span");
      selectedIndicator.className = "catalog-selected-indicator";
      selectedIndicator.textContent = isSelected ? "Selected" : "";
      selectedIndicator.setAttribute("aria-hidden", "true");
      const kind = document.createElement("span");
      kind.className = "catalog-kind";
      kind.textContent = result.kind;
      const label = document.createElement("span");
      label.className = "catalog-label";
      label.textContent = result.displayLabel ?? result.label;
      button.append(selectedIndicator, kind, label);
      button.addEventListener("click", () => applySelection(selection, {
        focusTarget: { kind: "catalog", selection: selectionKey(selection) },
      }));
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
      refs.resultCatalog.append(button);
    }
    restoreFocusTarget(focusTarget);
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
    graphView.select(state.selection);
    if (rendered && state.graphError) {
      clearGraphError();
    }
  }

  function refresh({ focusTarget = captureFocusTarget() } = {}) {
    if (!state.index) {
      return;
    }
    state.results = queryExplorer(state.index, state.filters);
    if (!currentSelectionIsVisible()) {
      state.selection = null;
      emptyDetails(refs.detailsContent);
      graphView.select(null);
    }
    renderFacets({ focusTarget });
    renderCatalog({ focusTarget });
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

  function applySelection(selection, { focusTarget = null } = {}) {
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
      renderCatalog({ focusTarget });
      focusCatalogSelection(state.selection);
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
    refs.graphError.hidden = false;
    refs.graphError.textContent = readableError(error);
    announce(`Graph error: ${readableError(error)}`);
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
    refs.graphError.hidden = true;
    refs.graphError.textContent = "";
    refs.graphToolbar.querySelector("#graph-retry")?.remove();
    if (refs.loadError.hidden) {
      announce(state.config ? `${state.config.label} loaded: ${state.graph.subjects} subjects / ${state.graph.assertions.length} assertions.` : "Graph available.");
    }
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
    refresh({
      focusTarget: {
        kind: "facet",
        facet: input.dataset.facet,
        value: input.dataset.value,
      },
    });
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
      refs.versionSelect.value = config.id;
      const query = refs.searchInput.value;
      state.filters = defaultFilters();
      state.filters.query = query;
      resetSelection({ render: false });
      refs.subjectCount.textContent = String(graph.subjects);
      refs.assertionCount.textContent = String(graph.assertions.length);
      announce(`${config.label} loaded: ${graph.subjects} subjects / ${graph.assertions.length} assertions.`);
      refresh();
    } catch (error) {
      if (token !== state.loadToken) {
        return;
      }
      if (state.config) {
        refs.versionSelect.value = state.config.id;
        showError(new Error(releaseFailureMessage(config.label, state.config.label, error)), { preserveState: true });
      } else {
        showError(error, { preserveState: false });
      }
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
      if (state.config) {
        refs.versionSelect.value = state.config.id;
      }
      loadRelease(config);
    });
    refs.graphDisclosure?.addEventListener("click", () => {
      state.graphOverviewExpanded = !state.graphOverviewExpanded;
      syncGraphDisclosure();
      if (state.graphOverviewExpanded) {
        graphView.fit();
      }
    });
    root.defaultView?.addEventListener("resize", syncGraphDisclosure);
    refs.graphFit?.addEventListener("click", () => graphView.fit());
    refs.graphReset?.addEventListener("click", () => {
      graphView.reset();
      resetSelection();
    });
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
  syncGraphDisclosure();
  emptyDetails(refs.detailsContent);

  const ready = (async () => {
    try {
      const baseUrl = new URL(root.baseURI ?? document.baseURI);
      if (baseUrl.protocol === "file:") {
        throw new Error(FILE_PROTOCOL_REMEDY);
      }
      const manifestUrl = new URL("versions.json", baseUrl.href);
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
