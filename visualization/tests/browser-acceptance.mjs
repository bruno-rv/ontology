async (page) => {
  const baseUrl = "http://127.0.0.1:4173/visualization/";
  const runtimeDirectory = typeof process !== "undefined" && typeof process.cwd === "function"
    ? process.cwd()
    : "";
  const fileUrl = runtimeDirectory
    ? `file://${encodeURI(`${runtimeDirectory}/visualization/index.html`)}`
    : null;
  const screenshots = {
    desktop: "/tmp/ontology-atlas-final-desktop.png",
    narrow: "/tmp/ontology-atlas-final-narrow.png",
    graphLight: "/tmp/ontology-atlas-graph-light-final.png",
    graphDark: "/tmp/ontology-atlas-graph-dark-final.png",
  };
  const cleanConsoleErrors = [];
  const cleanFailedRequests = [];
  const onConsole = (message) => {
    if (message.type() === "error") {
      cleanConsoleErrors.push(message.text());
    }
  };
  const onRequestFailed = (request) => cleanFailedRequests.push(request.url());
  page.on("console", onConsole);
  page.on("requestfailed", onRequestFailed);

  const fail = (message) => {
    throw new Error(`Browser acceptance failed: ${message}`);
  };
  const text = (selector) => page.locator(selector).textContent();
  const waitForRelease = async (subjects, assertions) => {
    await page.waitForFunction(
      ([expectedSubjects, expectedAssertions]) =>
        document.querySelector("#subject-count")?.textContent === expectedSubjects &&
        document.querySelector("#assertion-count")?.textContent === expectedAssertions,
      [subjects, assertions],
    );
  };
  const resultCount = async () => page.locator("#result-catalog [role=option]").count();
  const assertRenderedResultCount = async (expectedCount) => {
    const expectedLabel = `${expectedCount} result${expectedCount === 1 ? "" : "s"}`;
    if ((await resultCount()) !== expectedCount || await text("#result-count") !== expectedLabel) {
      fail(`catalog count mismatch: expected ${expectedLabel}`);
    }
  };
  const waitForResultCountChange = async (previousCount) => {
    await page.waitForFunction(
      (count) => document.querySelector("#result-count")?.textContent !== `${count} results`,
      previousCount,
    );
  };
  const selectFacet = async (facet, value) => {
    await page.locator(`input[data-facet="${facet}"]`).evaluateAll((inputs, target) => {
      const input = inputs.find((candidate) => JSON.parse(candidate.dataset.value) === target);
      if (!input) {
        throw new Error(`Facet option not found: ${facet}=${target}`);
      }
      input.click();
    }, value);
  };
  const resetSearch = async () => {
    await page.locator("#clear-search").click();
    await page.waitForFunction(() => document.querySelector("#global-search")?.value === "");
  };
  const captureGraphStyle = async (colorScheme) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme });
    await page.goto(baseUrl);
    await waitForRelease("82", "375");
    const style = await page.evaluate(() => {
      const original = globalThis.cytoscape;
      let captured;
      globalThis.cytoscape = (options) => {
        captured = options.style;
        return original(options);
      };
      document.querySelector("#graph-show-values").click();
      globalThis.cytoscape = original;
      return captured;
    });
    if (!style) {
      fail(`${colorScheme} Cytoscape style was not captured`);
    }
    const entry = (selector) => style.find((candidate) => candidate.selector === selector)?.style ?? {};
    return {
      theme: await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--graph-theme").trim()),
      nodeInk: entry("node").color,
      edgeInk: entry("edge").color,
      edgeBackground: entry("edge")["text-background-color"],
      nodeLabels: ["node", "node.literal", "node.class", "node.property", "node.ontology", "node.individual", "node.datatype"]
        .map((selector) => ({
          selector,
          color: entry(selector).color,
          background: entry(selector)["text-background-color"],
          opacity: entry(selector)["text-background-opacity"],
        })),
    };
  };
  const luminance = (hex) => {
    const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.replace(/^#/, "").slice(offset, offset + 2), 16) / 255);
    return channels.reduce((sum, channel, index) => {
      const linear = channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      return sum + linear * [0.2126, 0.7152, 0.0722][index];
    }, 0);
  };
  const ratio = (foreground, background) => {
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  };

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto(baseUrl);
  await waitForRelease("82", "375");
  const version2ResultCount = await resultCount();
  if (version2ResultCount === 0) {
    fail("Version 2.0 catalog is empty");
  }
  await assertRenderedResultCount(version2ResultCount);
  const version2 = {
    counts: [await text("#subject-count"), await text("#assertion-count")],
    results: version2ResultCount,
  };

  const firstResource = page.locator("#result-catalog [role=option][data-kind=resource]").first();
  await firstResource.click();
  const selectedResource = await page.evaluate(() => ({
    active: document.activeElement?.dataset?.itemId,
    selected: document.querySelectorAll("#result-catalog [aria-selected=true]").length,
    signal: document.querySelector("#result-catalog [aria-selected=true] .catalog-selected-indicator")?.textContent,
    details: document.querySelector("#details-content")?.textContent ?? "",
  }));
  if (selectedResource.active !== await firstResource.getAttribute("data-item-id") || selectedResource.selected !== 1 || selectedResource.signal !== "Selected") {
    fail("resource selection did not preserve focus and selected state");
  }
  if (!selectedResource.details.includes("IRI") || !selectedResource.details.includes("Source record indices")) {
    fail("resource details omitted canonical metadata");
  }
  await page.keyboard.press("ArrowDown");
  if ((await page.evaluate(() => document.activeElement?.getAttribute("role"))) !== "option") {
    fail("ArrowDown did not continue catalog navigation");
  }

  const graphNodeId = await page.evaluate(() => {
    const original = globalThis.cytoscape;
    let cy;
    globalThis.cytoscape = (options) => {
      cy = original(options);
      globalThis.__atlasCapturedCy = cy;
      return cy;
    };
    document.querySelector("#graph-show-values").click();
    globalThis.cytoscape = original;
    const node = cy.nodes().toArray().find((candidate) => candidate.data("kind") === "resource");
    node.trigger("tap");
    return node.id();
  });
  await page.waitForFunction(
    (id) => document.querySelector("#result-catalog [aria-selected=true]")?.getAttribute("data-item-id") === id,
    graphNodeId,
  );
  const graphNodeState = await page.evaluate(() => ({
    active: document.activeElement?.dataset?.itemId,
    selected: document.querySelector("#result-catalog [aria-selected=true]")?.getAttribute("data-item-id"),
    details: document.querySelector("#details-heading")?.textContent,
  }));
  if (graphNodeState.active !== graphNodeId || graphNodeState.selected !== graphNodeId || !graphNodeState.details) {
    fail("graph node selection did not focus the matching catalog option");
  }
  const graphEdgeId = await page.evaluate(() => {
    const edge = globalThis.__atlasCapturedCy.edges().first();
    edge.trigger("tap");
    return edge.id();
  });
  await page.waitForFunction(() => document.querySelector("#details-heading")?.textContent === "Assertion");
  const graphEdgeState = await page.evaluate(() => ({
    active: document.activeElement?.dataset?.itemId,
    selected: document.querySelector("#result-catalog [aria-selected=true]")?.getAttribute("data-item-id"),
  }));
  if (graphEdgeState.active !== graphEdgeId || graphEdgeState.selected !== graphEdgeId) {
    fail("graph edge selection did not focus the matching catalog option");
  }

  const assertion = page.locator("#result-catalog [role=option][data-kind=assertion]").first();
  await assertion.click();
  const assertionDetails = await text("#details-content");
  for (const field of ["Subject", "Predicate", "Object", "Source record index", "Source value index"]) {
    if (!assertionDetails.includes(field)) {
      fail(`assertion details omitted ${field}`);
    }
  }

  await page.locator("#global-search").fill("https://w3id.org/dh-atlas/2.0");
  await waitForResultCountChange(version2ResultCount);
  if ((await resultCount()) < 1) {
    fail("full IRI search returned no result");
  }
  await page.locator("#global-search").fill("versionIRI");
  await page.waitForFunction(() => document.querySelector("#result-catalog [role=option]") !== null);
  if ((await resultCount()) < 1) {
    fail("predicate search returned no result");
  }
  await page.locator("#global-search").fill("Cultural Heritage");
  await page.waitForFunction(() => document.querySelector("#result-catalog [role=option]") !== null);
  if ((await resultCount()) < 1) {
    fail("literal search returned no result");
  }
  await resetSearch();

  await selectFacet("kinds", "assertion");
  const afterKindFacet = await resultCount();
  await selectFacet("predicates", "http://www.w3.org/2002/07/owl#versionIRI");
  const afterPredicateFacet = await resultCount();
  if (afterKindFacet <= afterPredicateFacet || afterPredicateFacet < 1) {
    fail("kind and predicate facets did not compose");
  }
  const focusedFacet = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    facet: document.activeElement?.dataset?.facet,
  }));
  if (focusedFacet.tag !== "INPUT" || focusedFacet.facet !== "predicates") {
    fail("facet refresh did not restore checkbox focus");
  }
  await page.locator("#clear-filters").click();
  await page.waitForFunction(() => document.querySelectorAll("#facet-form input:checked").length === 0);
  if (await page.locator("#graph-show-values").getAttribute("aria-pressed") !== "true") {
    fail("Show values did not expose its pressed state");
  }

  const beforeGraphFactories = await page.evaluate(() => {
    const original = globalThis.cytoscape;
    let calls = 0;
    globalThis.cytoscape = (options) => {
      calls += 1;
      return original(options);
    };
    globalThis.__atlasGraphFactoryCalls = () => calls;
    globalThis.__atlasRestoreGraphFactory = () => { globalThis.cytoscape = original; };
    return 0;
  });
  await page.locator("#global-search").fill("versionInfo");
  await waitForResultCountChange(version2ResultCount);
  const searchRefreshCount = await resultCount();
  await assertRenderedResultCount(searchRefreshCount);
  const refreshedSelection = page.locator("#result-catalog [role=option]").first();
  await refreshedSelection.click();
  const refreshedSelectionId = await refreshedSelection.getAttribute("data-item-id");
  await page.locator("#global-search").fill("version");
  await page.waitForFunction(() => document.querySelector("#result-catalog [aria-selected=true]") !== null);
  const continuedSearchCount = await resultCount();
  await assertRenderedResultCount(continuedSearchCount);
  const afterGraphFactories = await page.evaluate(() => globalThis.__atlasGraphFactoryCalls?.());
  const refreshedState = await page.evaluate(() => ({
    selected: document.querySelector("#result-catalog [aria-selected=true]")?.getAttribute("data-item-id"),
    details: document.querySelector("#details-heading")?.textContent,
  }));
  if (beforeGraphFactories !== afterGraphFactories || refreshedState.selected !== refreshedSelectionId || !refreshedState.details) {
    fail("search refresh rebuilt Cytoscape");
  }
  await page.evaluate(() => globalThis.__atlasRestoreGraphFactory?.());
  await resetSearch();

  await page.locator("#version-select").selectOption("1.0");
  await waitForRelease("89", "348");
  const version1ResultCount = await resultCount();
  if (version1ResultCount === 0) {
    fail("Version 1.0 catalog is empty");
  }
  await assertRenderedResultCount(version1ResultCount);
  await page.locator("#version-select").selectOption("2.0");
  await waitForRelease("82", "375");
  await assertRenderedResultCount(version2ResultCount);
  const retainedSelection = page.locator("#result-catalog [role=option][data-kind=resource]").first();
  await retainedSelection.click();
  const retainedSelectionId = await retainedSelection.getAttribute("data-item-id");

  await page.route("**/1.0/dh-atlas.jsonld", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: "{}",
  }));
  await page.locator("#version-select").selectOption("1.0");
  await page.waitForFunction(() => document.querySelector("#load-error")?.textContent.includes("failed to load"));
  const rollback = await page.evaluate(() => ({
    version: document.querySelector("#version-select")?.value,
    counts: [document.querySelector("#subject-count")?.textContent, document.querySelector("#assertion-count")?.textContent],
    loadError: document.querySelector("#load-error")?.textContent,
    graphErrorHidden: document.querySelector("#graph-error")?.hidden,
    selected: document.querySelector("#result-catalog [aria-selected=true]")?.getAttribute("data-item-id"),
  }));
  if (rollback.version !== "2.0" || rollback.counts.join("/") !== "82/375" || !rollback.loadError.includes("Version 2.0 remains displayed") || !rollback.graphErrorHidden || rollback.selected !== retainedSelectionId) {
    fail("failed release switch did not roll back to the retained release");
  }
  await page.unroute("**/1.0/dh-atlas.jsonld");

  await page.route("**/visualization/assets/vendor/cytoscape.min.js", (route) => route.abort());
  await page.reload();
  await waitForRelease("82", "375");
  await page.waitForFunction(() => document.querySelector("#graph-error")?.hidden === false);
  const graphFailure = await page.evaluate(() => ({
    loadErrorHidden: document.querySelector("#load-error")?.hidden,
    graphError: document.querySelector("#graph-error")?.textContent,
    retry: document.querySelector("#graph-retry")?.textContent,
    resultCount: document.querySelector("#result-count")?.textContent,
  }));
  if (!graphFailure.loadErrorHidden || !graphFailure.graphError.includes("vendor is unavailable") || graphFailure.retry !== "Retry graph" || graphFailure.resultCount !== `${version2ResultCount} results`) {
    fail("graph failure did not remain isolated from catalog/load state");
  }
  await page.unroute("**/visualization/assets/vendor/cytoscape.min.js");
  await page.addScriptTag({ url: `${baseUrl}assets/vendor/cytoscape.min.js` });
  await page.locator("#graph-retry").click();
  await page.waitForFunction(() => document.querySelector("#graph-error")?.hidden === true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await waitForRelease("82", "375");
  const narrow = await page.evaluate(() => ({
    disclosureHidden: document.querySelector("#graph-disclosure")?.hidden,
    expanded: document.querySelector("#graph-disclosure")?.getAttribute("aria-expanded"),
    graphHidden: document.querySelector("#graph-overview")?.hidden,
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
  }));
  if (narrow.disclosureHidden || narrow.expanded !== "false" || !narrow.graphHidden || narrow.scrollWidth > narrow.viewportWidth) {
    fail("narrow graph overview was not collapsed without overflow");
  }
  await page.locator("#graph-disclosure").click();
  if (await page.locator("#graph-disclosure").getAttribute("aria-expanded") !== "true") {
    fail("narrow graph disclosure did not open by keyboard-operable button");
  }
  const narrowWidths = await page.evaluate(() => ({
    catalog: document.querySelector("#catalog-panel")?.getBoundingClientRect().width,
    details: document.querySelector("#details-dock")?.getBoundingClientRect().width,
  }));
  if (narrowWidths.catalog !== 390 || narrowWidths.details !== 390) {
    fail("narrow catalog/details lost primary width");
  }
  await page.screenshot({ path: screenshots.narrow });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await waitForRelease("82", "375");
  const reducedMotionDuration = await page.locator("#graph-canvas").evaluate((element) => getComputedStyle(element).transitionDuration);
  if (Number.parseFloat(reducedMotionDuration) > 0.01) {
    fail(`reduced-motion transition was ${reducedMotionDuration}`);
  }

  const lightStyle = await captureGraphStyle("light");
  await page.locator("#graph-canvas").screenshot({ path: screenshots.graphLight });
  const darkStyle = await captureGraphStyle("dark");
  await page.locator("#graph-canvas").screenshot({ path: screenshots.graphDark });
  const contrast = { light: [], dark: [] };
  for (const [name, style] of [["light", lightStyle], ["dark", darkStyle]]) {
    const edgeRatio = ratio(style.edgeInk, style.edgeBackground);
    const nodeRatios = style.nodeLabels.map(({ color, background, opacity }) => {
      if (opacity !== 1 || !background) {
        fail(`${name} node label background is not opaque and explicit`);
      }
      return ratio(color, background);
    });
    contrast[name] = { theme: style.theme, edgeRatio, nodeRatios };
    if (edgeRatio < 4.5 || nodeRatios.some((value) => value < 4.5)) {
      fail(`${name} Cytoscape label contrast fell below 4.5:1`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto(baseUrl);
  await waitForRelease("82", "375");
  await page.screenshot({ path: screenshots.desktop });

  let fileProtocolMessage = "Not run: process.cwd() was unavailable to the CLI artifact.";
  if (fileUrl) {
    await page.goto(fileUrl);
    await page.waitForFunction(() => document.querySelector("#load-error")?.textContent.includes("file:// is not supported"));
    fileProtocolMessage = await text("#load-error");
    if (!fileProtocolMessage.includes("python3 -m http.server 4173 --bind 127.0.0.1") || !fileProtocolMessage.includes("http://127.0.0.1:4173/visualization/")) {
      fail("file protocol message omitted the local HTTP remedy");
    }
  }
  cleanConsoleErrors.length = 0;
  cleanFailedRequests.length = 0;
  await page.goto(baseUrl);
  await waitForRelease("82", "375");

  page.off("console", onConsole);
  page.off("requestfailed", onRequestFailed);
  if (cleanConsoleErrors.length || cleanFailedRequests.length) {
    fail(`clean page emitted console/network failures: ${JSON.stringify({ cleanConsoleErrors, cleanFailedRequests })}`);
  }

  return {
    version2,
    version1: { counts: ["89", "348"], results: version1ResultCount },
    selectedResource,
    graphNodeSelection: { id: graphNodeId, ...graphNodeState },
    graphEdgeSelection: { id: graphEdgeId, ...graphEdgeState },
    assertionFields: ["Subject", "Predicate", "Object", "Source record index", "Source value index"],
    rollback,
    graphFailure,
    narrow,
    reducedMotionDuration,
    contrast,
    screenshots,
    fileProtocolMessage,
    cleanConsoleErrors,
    cleanFailedRequests,
  };
}
