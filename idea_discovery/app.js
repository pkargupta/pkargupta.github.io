const DEFAULT_DATA_ROOT = "../data/idea_graphs";

const NODE_COLORS = {
  problem: { fill: "#d1495b", stroke: "#a52842" },
  idea: { fill: "#7a4cc4", stroke: "#573592" },
  method: { fill: "#1d7874", stroke: "#125853" },
  background: { fill: "#6b7280", stroke: "#48505d" },
  evidence: { fill: "#2a6fdb", stroke: "#1b4d9a" },
  assumption: { fill: "#d97b29", stroke: "#a35614" },
  limitation: { fill: "#ef476f", stroke: "#ae2448" },
  implication: { fill: "#8d99ae", stroke: "#616b7d" },
  resource: { fill: "#c0841a", stroke: "#8c5e0f" },
  default: { fill: "#3c7a89", stroke: "#1f5560" },
};

const TYPE_ORDER = [
  "problem", "background", "assumption", "idea", "method",
  "evidence", "limitation", "implication", "resource", "other",
];

const state = {
  dataRoot: DEFAULT_DATA_ROOT,
  directoryHandle: null,
  summary: null,
  selectedPoolKey: "",
  selectedPaperIndex: null,
  currentGraphArtifact: null,
  graphTextMode: "label",
};

const loadStatus = document.getElementById("load-status");
const dataRootInput = document.getElementById("data-root-input");
const pickDirectoryButton = document.getElementById("pick-directory-button");
const loadDataButton = document.getElementById("load-data-button");
const poolSelect = document.getElementById("pool-select");
const paperSelect = document.getElementById("paper-select");
const graphTextModeSelect = document.getElementById("graph-text-mode");
const poolSummary = document.getElementById("pool-summary");
const paperSummary = document.getElementById("paper-summary");
const graphTitle = document.getElementById("graph-title");
const graphStats = document.getElementById("graph-stats");
const detailsContent = document.getElementById("details-content");
const graphCanvas = document.getElementById("graph-canvas");

function setStatus(message, isError = false) {
  loadStatus.textContent = message;
  loadStatus.style.background = isError ? "rgba(209, 73, 91, 0.14)" : "rgba(31, 111, 120, 0.1)";
  loadStatus.style.color = isError ? "#8c2234" : "#1f6f78";
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (${response.status})`);
  }
  return response.json();
}

async function readJsonFromDirectoryHandle(directoryHandle, relativePath) {
  const parts = String(relativePath).split("/").filter(Boolean);
  let cursor = directoryHandle;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = await cursor.getDirectoryHandle(parts[index]);
  }
  const fileHandle = await cursor.getFileHandle(parts.at(-1));
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text());
}

async function loadJsonResource(relativePath, fetchPath = relativePath) {
  if (state.directoryHandle) {
    return readJsonFromDirectoryHandle(state.directoryHandle, relativePath);
  }
  return loadJson(fetchPath);
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function detailCard(label, value, className = "") {
  if (value === null || value === undefined || value === "") return "";
  return `<div class="detail-card ${className}"><span class="detail-label">${escapeHtml(label)}</span><p class="detail-value">${escapeHtml(value)}</p></div>`;
}

function shortText(text, maxLength = 700) {
  if (!text) return "";
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`;
}

function nodeColor(nodeType) {
  return NODE_COLORS[nodeType] || NODE_COLORS.default;
}

function typeRank(type) {
  const index = TYPE_ORDER.indexOf(type);
  return index === -1 ? TYPE_ORDER.length : index;
}

function getPools() {
  if (!state.summary || typeof state.summary !== "object") return {};
  if (state.summary.pools && typeof state.summary.pools === "object") {
    return state.summary.pools;
  }
  return state.summary;
}

function getPoolMeta(poolKey) {
  return getPools()[poolKey] || null;
}

function getSelectedPaperMeta() {
  const poolMeta = getPoolMeta(state.selectedPoolKey);
  if (!poolMeta) return null;
  return poolMeta.papers?.find((paper) => paper.paper_index === state.selectedPaperIndex) || null;
}

function paperFilePath(poolKey, fileName) {
  return `${state.dataRoot}/${encodeURIComponent(poolKey)}/${encodeURIComponent(fileName)}`;
}

function nodeDisplayText(node) {
  if (state.graphTextMode === "domain-agnostic") {
    return node.domain_agnostic_text || node.text || node.label || node.node_id;
  }
  return node.label || node.text || node.node_id;
}

function renderPoolOptions() {
  poolSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a pool";
  poolSelect.appendChild(placeholder);

  Object.keys(getPools()).sort().forEach((poolKey) => {
    const option = document.createElement("option");
    option.value = poolKey;
    option.textContent = poolKey;
    poolSelect.appendChild(option);
  });

  poolSelect.disabled = Object.keys(getPools()).length === 0;
}

function renderPoolSummary(poolKey) {
  const poolMeta = getPoolMeta(poolKey);
  if (!poolMeta) {
    poolSummary.innerHTML = '<div class="summary-empty">Select a pool to view its summary.</div>';
    return;
  }

  poolSummary.innerHTML = `
    <div>
      <p class="eyebrow">Selected Pool</p>
      <h2 style="margin: 4px 0 10px;">${escapeHtml(poolKey)}</h2>
      <p class="detail-value">${escapeHtml(poolMeta.research_problem || "No research problem text available.")}</p>
      <div class="detail-grid" style="margin-top: 16px;">
        ${detailCard("Papers in pool", String(poolMeta.paper_count ?? 0))}
        ${detailCard("Data root", state.dataRoot, "mono")}
      </div>
    </div>
  `;
}

function renderPaperSelect(poolKey) {
  paperSelect.innerHTML = "";
  const poolMeta = getPoolMeta(poolKey);
  const papers = poolMeta?.papers || [];

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = papers.length ? "Select a paper" : "No papers available";
  paperSelect.appendChild(placeholder);

  papers.forEach((entry) => {
    const option = document.createElement("option");
    option.value = String(entry.paper_index);
    option.textContent = `${entry.paper_index + 1}. ${entry.paper?.title || `Paper ${entry.paper_index + 1}`}`;
    paperSelect.appendChild(option);
  });

  paperSelect.disabled = papers.length === 0;
  paperSelect.value = "";
}

function renderPaperSummary(artifact, paperMeta = null) {
  if (!artifact && !paperMeta) {
    paperSummary.innerHTML = '<div class="summary-empty">Select a paper to load its graph.</div>';
    return;
  }

  const paper = artifact?.paper || paperMeta?.paper || {};
  const abstractText = artifact?.graph?.source_text || "";
  paperSummary.innerHTML = `
    <div>
      <p class="eyebrow">Selected Paper</p>
      <h2 style="margin: 4px 0 10px;">${escapeHtml(paper.title || "Untitled paper")}</h2>
      <div class="detail-grid" style="margin-bottom: 14px;">
        ${detailCard("Field", paper.field)}
        ${detailCard("Paper id", paper.paper_id, "mono")}
      </div>
      <p class="detail-value">${escapeHtml(shortText(abstractText || "Load the paper to view its abstract and graph."))}</p>
    </div>
  `;
}

function renderArtifactSummary(artifact) {
  if (!artifact) {
    graphTitle.textContent = "No paper selected";
    graphStats.textContent = "";
    return;
  }
  graphTitle.textContent = artifact.paper?.title || "Untitled paper";
  if (artifact.error) {
    graphStats.textContent = "Graph construction failed for this paper.";
    return;
  }
  const nodeCount = artifact.graph?.nodes?.length || 0;
  const edgeCount = artifact.graph?.edges?.length || 0;
  graphStats.textContent = `${nodeCount} nodes • ${edgeCount} edges • ${artifact.paper?.field || "Unknown field"}`;
}

function wrapText(text, maxChars) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) current = candidate;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4);
}

function computeLevels(graph) {
  const nodeMap = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const incomingCount = new Map(graph.nodes.map((node) => [node.node_id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.node_id, []]));

  for (const edge of graph.edges) {
    if (!nodeMap.has(edge.source_id) || !nodeMap.has(edge.target_id)) continue;
    incomingCount.set(edge.target_id, (incomingCount.get(edge.target_id) || 0) + 1);
    outgoing.get(edge.source_id).push(edge.target_id);
  }

  const queue = [];
  const levels = new Map();
  for (const node of graph.nodes) {
    if ((incomingCount.get(node.node_id) || 0) === 0) {
      queue.push(node.node_id);
      levels.set(node.node_id, 0);
    }
  }

  if (queue.length === 0) {
    const sorted = [...graph.nodes].sort((a, b) => typeRank(a.node_type) - typeRank(b.node_type));
    if (sorted[0]) {
      queue.push(sorted[0].node_id);
      levels.set(sorted[0].node_id, 0);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    const currentLevel = levels.get(current) || 0;
    for (const next of outgoing.get(current) || []) {
      const candidateLevel = currentLevel + 1;
      if (!levels.has(next) || candidateLevel > levels.get(next)) levels.set(next, candidateLevel);
      incomingCount.set(next, (incomingCount.get(next) || 0) - 1);
      if ((incomingCount.get(next) || 0) <= 0) queue.push(next);
    }
  }

  for (const node of graph.nodes) {
    if (!levels.has(node.node_id)) levels.set(node.node_id, Math.max(0, typeRank(node.node_type) - 2));
  }
  return levels;
}

function computeLayout(graph) {
  const levels = computeLevels(graph);
  const columns = new Map();
  for (const node of graph.nodes) {
    const level = levels.get(node.node_id) || 0;
    if (!columns.has(level)) columns.set(level, []);
    columns.get(level).push(node);
  }

  const orderedLevels = [...columns.keys()].sort((a, b) => a - b);
  const positions = new Map();
  const nodeHeight = 108;
  const nodeWidth = 260;
  const verticalGap = 30;
  const horizontalGap = 110;
  const topPadding = 38;
  const leftPadding = 36;

  orderedLevels.forEach((level, columnIndex) => {
    const columnNodes = columns.get(level).sort((a, b) => {
      const typeDelta = typeRank(a.node_type) - typeRank(b.node_type);
      if (typeDelta !== 0) return typeDelta;
      return nodeDisplayText(a).localeCompare(nodeDisplayText(b));
    });
    columnNodes.forEach((node, rowIndex) => {
      positions.set(node.node_id, {
        x: leftPadding + columnIndex * (nodeWidth + horizontalGap),
        y: topPadding + rowIndex * (nodeHeight + verticalGap),
        width: nodeWidth,
        height: nodeHeight,
      });
    });
  });

  const maxRows = Math.max(...orderedLevels.map((level) => columns.get(level).length), 1);
  const width = leftPadding * 2 + orderedLevels.length * nodeWidth + Math.max(0, orderedLevels.length - 1) * horizontalGap;
  const height = topPadding * 2 + maxRows * nodeHeight + Math.max(0, maxRows - 1) * verticalGap;
  return { positions, width, height };
}

function edgeGeometry(source, target) {
  const startX = source.x + source.width;
  const startY = source.y + source.height / 2;
  const endX = target.x;
  const endY = target.y + target.height / 2;
  const midX = (startX + endX) / 2;
  const bend = Math.max(44, Math.abs(endY - startY) * 0.22);
  const path = `M ${startX} ${startY} C ${midX - 42} ${startY}, ${midX - 18} ${startY} ${midX} ${startY + (endY > startY ? bend : -bend)} S ${endX - 44} ${endY}, ${endX} ${endY}`;
  const labelX = midX;
  const labelY = Math.min(startY, endY) - 10 + Math.abs(endY - startY) * 0.18;
  return { path, labelX, labelY };
}

function createSvgElement(tag, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}

function attachPanZoom(svg, viewport, width, height) {
  const canvasWidth = graphCanvas.clientWidth || 900;
  const canvasHeight = graphCanvas.clientHeight || 560;
  const fitScale = Math.min(
    Math.max(0.55, (canvasWidth - 40) / width),
    Math.max(0.55, (canvasHeight - 40) / height),
    1.9,
  );
  const view = {
    scale: fitScale,
    x: Math.max(16, (canvasWidth - width * fitScale) / 2),
    y: Math.max(12, (canvasHeight - height * fitScale) / 2),
  };

  const applyTransform = () => {
    viewport.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.scale})`);
  };
  applyTransform();

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const zoomFactor = event.deltaY < 0 ? 1.08 : 0.92;
    const nextScale = Math.min(3.2, Math.max(0.4, view.scale * zoomFactor));
    const rect = svg.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const worldX = (mouseX - view.x) / view.scale;
    const worldY = (mouseY - view.y) / view.scale;
    view.scale = nextScale;
    view.x = mouseX - worldX * view.scale;
    view.y = mouseY - worldY * view.scale;
    applyTransform();
  }, { passive: false });

  svg.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".svg-node-group, .svg-edge-group")) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    svg.classList.add("is-dragging");
  });

  window.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    view.x += event.clientX - lastX;
    view.y += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    applyTransform();
  });

  window.addEventListener("pointerup", () => {
    dragging = false;
    svg.classList.remove("is-dragging");
  });
}

function renderSvgGraph(graph) {
  const { positions, width, height } = computeLayout(graph);
  const svg = createSvgElement("svg", {
    viewBox: `0 0 ${graphCanvas.clientWidth || 1200} ${graphCanvas.clientHeight || 680}`,
    class: "idea-svg",
    preserveAspectRatio: "xMidYMid meet",
  });

  const defs = createSvgElement("defs");
  const marker = createSvgElement("marker", {
    id: "arrowhead", markerWidth: 10, markerHeight: 7, refX: 9, refY: 3.5, orient: "auto",
  });
  marker.appendChild(createSvgElement("polygon", {
    points: "0 0, 10 3.5, 0 7", fill: "rgba(31, 41, 51, 0.68)",
  }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  const viewport = createSvgElement("g");
  const edgeLayer = createSvgElement("g");
  const nodeLayer = createSvgElement("g");

  for (const edge of graph.edges) {
    const source = positions.get(edge.source_id);
    const target = positions.get(edge.target_id);
    if (!source || !target) continue;
    const { path, labelX, labelY } = edgeGeometry(source, target);

    const edgeGroup = createSvgElement("g", { class: "svg-edge-group", "data-edge-id": edge.edge_id, tabindex: 0 });
    edgeGroup.appendChild(createSvgElement("path", {
      d: path, fill: "none", stroke: "rgba(31, 41, 51, 0.42)", "stroke-width": 2.4, "marker-end": "url(#arrowhead)", class: "svg-edge-path",
    }));
    edgeGroup.appendChild(createSvgElement("path", {
      d: path, fill: "none", stroke: "transparent", "stroke-width": 18, class: "svg-edge-hit",
    }));

    const bgWidth = Math.max(42, edge.edge_type.length * 6.7);
    edgeGroup.appendChild(createSvgElement("rect", {
      x: labelX - bgWidth / 2, y: labelY - 13, width: bgWidth, height: 20, rx: 10, ry: 10, class: "svg-edge-label-bg",
    }));
    const edgeLabel = createSvgElement("text", {
      x: labelX, y: labelY + 1, class: "svg-edge-label", "text-anchor": "middle",
    });
    edgeLabel.textContent = edge.edge_type;
    edgeGroup.appendChild(edgeLabel);

    edgeGroup.addEventListener("click", () => showEdgeDetails(edge.edge_id));
    edgeGroup.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showEdgeDetails(edge.edge_id);
      }
    });
    edgeLayer.appendChild(edgeGroup);
  }

  for (const node of graph.nodes) {
    const position = positions.get(node.node_id);
    if (!position) continue;
    const colors = nodeColor(node.node_type);

    const group = createSvgElement("g", {
      class: "svg-node-group",
      transform: `translate(${position.x}, ${position.y})`,
      "data-node-id": node.node_id,
      tabindex: 0,
    });
    group.appendChild(createSvgElement("rect", {
      x: 0, y: 0, rx: 20, ry: 20, width: position.width, height: position.height,
      fill: colors.fill, stroke: colors.stroke, "stroke-width": 2.5, class: "svg-node-rect",
    }));

    const title = createSvgElement("text", { x: 16, y: 27, fill: "#ffffff", class: "svg-node-title" });
    wrapText(nodeDisplayText(node), 28).forEach((line, index) => {
      const tspan = createSvgElement("tspan", { x: 16, dy: index === 0 ? 0 : 17 });
      tspan.textContent = line;
      title.appendChild(tspan);
    });
    const typeText = createSvgElement("text", {
      x: 16, y: 92, fill: "rgba(255,255,255,0.86)", class: "svg-node-type",
    });
    typeText.textContent = node.node_type;
    group.appendChild(title);
    group.appendChild(typeText);

    group.addEventListener("click", () => showNodeDetails(node.node_id));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showNodeDetails(node.node_id);
      }
    });
    nodeLayer.appendChild(group);
  }

  viewport.appendChild(edgeLayer);
  viewport.appendChild(nodeLayer);
  svg.appendChild(viewport);
  attachPanZoom(svg, viewport, width, height);
  return svg;
}

function renderArtifact(artifact) {
  state.currentGraphArtifact = artifact;
  renderArtifactSummary(artifact);
  renderPaperSummary(artifact, getSelectedPaperMeta());
  graphCanvas.innerHTML = "";

  if (!artifact) {
    detailsContent.innerHTML = '<div class="details-empty">Select a paper to view its graph.</div>';
    return;
  }
  if (artifact.error) {
    detailsContent.innerHTML = `<div class="error-box">This paper does not currently have a usable graph artifact.<br /><br />${escapeHtml(artifact.error)}</div>`;
    return;
  }

  graphCanvas.appendChild(renderSvgGraph(artifact.graph));
  detailsContent.innerHTML = '<div class="details-empty">Click a node or edge in the graph to inspect its details here. Use scroll to zoom and drag empty space to pan.</div>';
}

function showNodeDetails(nodeId) {
  const artifact = state.currentGraphArtifact;
  const node = artifact?.graph?.nodes?.find((item) => item.node_id === nodeId);
  if (!node) return;

  detailsContent.innerHTML = `
    <div class="detail-block">
      <span class="detail-chip">Node</span>
      <h3>${escapeHtml(node.label || node.node_id)}</h3>
      <div class="detail-grid">
        ${detailCard("Node type", node.node_type)}
        ${detailCard("Node id", node.node_id, "mono")}
        ${detailCard("Latent", String(Boolean(node.latent)))}
        ${detailCard("Confidence", node.confidence == null ? "" : String(node.confidence))}
      </div>
    </div>
    <div class="detail-block">
      <h3>Text</h3>
      ${detailCard("Graph display text", nodeDisplayText(node))}
      ${detailCard("Label", node.label)}
      ${detailCard("Concept text", node.text)}
      ${detailCard("Domain-agnostic text", node.domain_agnostic_text)}
      ${detailCard("Evidence / justification", node.evidence)}
    </div>
  `;
}

function showEdgeDetails(edgeId) {
  const artifact = state.currentGraphArtifact;
  const edge = artifact?.graph?.edges?.find((item) => item.edge_id === edgeId);
  if (!edge) return;
  const source = artifact.graph.nodes.find((item) => item.node_id === edge.source_id);
  const target = artifact.graph.nodes.find((item) => item.node_id === edge.target_id);

  detailsContent.innerHTML = `
    <div class="detail-block">
      <span class="detail-chip">Edge</span>
      <h3>${escapeHtml(edge.edge_type)}</h3>
      <div class="detail-grid">
        ${detailCard("Edge id", edge.edge_id, "mono")}
        ${detailCard("Confidence", edge.confidence == null ? "" : String(edge.confidence))}
      </div>
    </div>
    <div class="detail-block">
      <h3>Connection</h3>
      ${detailCard("Source", source ? nodeDisplayText(source) : edge.source_id)}
      ${detailCard("Target", target ? nodeDisplayText(target) : edge.target_id)}
      ${detailCard("Evidence", edge.evidence)}
    </div>
  `;
}

async function loadSummary() {
  const requestedRoot = dataRootInput.value.trim() || DEFAULT_DATA_ROOT;
  setStatus(`Loading summary from ${requestedRoot}...`);
  const summary = await loadJsonResource("summary.json", `${requestedRoot}/summary.json`);
  state.dataRoot = requestedRoot;
  state.summary = summary;
  state.selectedPoolKey = "";
  state.selectedPaperIndex = null;
  state.currentGraphArtifact = null;
  renderPoolOptions();
  renderPoolSummary(null);
  renderPaperSelect(null);
  renderPaperSummary(null);
  renderArtifact(null);
  setStatus(`Loaded ${Object.keys(getPools()).length} pools from ${requestedRoot}`);
}

function selectPool(poolKey) {
  state.selectedPoolKey = poolKey;
  state.selectedPaperIndex = null;
  state.currentGraphArtifact = null;
  renderPoolSummary(poolKey);
  renderPaperSelect(poolKey);
  renderPaperSummary(null);
  renderArtifact(null);
  detailsContent.innerHTML = '<div class="details-empty">Select a paper to load its graph.</div>';
}

async function loadSelectedPaper() {
  const paperMeta = getSelectedPaperMeta();
  if (!state.selectedPoolKey || !paperMeta) {
    renderArtifact(null);
    return;
  }

  setStatus(`Loading paper ${paperMeta.paper_index + 1} from ${state.selectedPoolKey}...`);
  const artifact = await loadJsonResource(
    `${state.selectedPoolKey}/${paperMeta.file}`,
    paperFilePath(state.selectedPoolKey, paperMeta.file),
  );
  renderArtifact(artifact);
  setStatus(`Loaded ${paperMeta.paper?.title || "paper"}`);
}

pickDirectoryButton?.addEventListener("click", async () => {
  if (!window.showDirectoryPicker) {
    setStatus("Directory picker is not available in this browser. Use the path field instead.", true);
    return;
  }
  try {
    const directoryHandle = await window.showDirectoryPicker();
    state.directoryHandle = directoryHandle;
    dataRootInput.value = directoryHandle.name;
    await loadSummary();
  } catch (error) {
    if (error?.name !== "AbortError") {
      setStatus("Failed to open directory picker", true);
    }
  }
});

loadDataButton.addEventListener("click", async () => {
  try {
    state.directoryHandle = null;
    await loadSummary();
  } catch (error) {
    setStatus("Failed to load summary", true);
    poolSummary.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
  }
});

poolSelect.addEventListener("change", () => {
  const poolKey = poolSelect.value;
  if (!poolKey) {
    renderPoolSummary(null);
    renderPaperSelect(null);
    renderPaperSummary(null);
    renderArtifact(null);
    return;
  }
  selectPool(poolKey);
});

paperSelect.addEventListener("change", async () => {
  const selectedValue = paperSelect.value;
  if (selectedValue === "") {
    state.selectedPaperIndex = null;
    renderArtifact(null);
    return;
  }
  state.selectedPaperIndex = Number(selectedValue);
  try {
    await loadSelectedPaper();
  } catch (error) {
    setStatus("Failed to load paper", true);
    renderArtifact({
      paper: getSelectedPaperMeta()?.paper || {},
      error: error.message,
    });
  }
});

graphTextModeSelect.addEventListener("change", () => {
  state.graphTextMode = graphTextModeSelect.value;
  if (state.currentGraphArtifact?.graph) {
    renderArtifact(state.currentGraphArtifact);
  }
});

async function initialize() {
  dataRootInput.value = DEFAULT_DATA_ROOT;
  try {
    await loadSummary();
  } catch (error) {
    setStatus("Failed to load summary", true);
    poolSummary.innerHTML = `
      <div class="error-box">
        Could not load viewer data.<br /><br />
        ${escapeHtml(error.message)}<br /><br />
        Point the viewer at an output directory that contains <span class="mono">summary.json</span>.
      </div>
    `;
  }
}

initialize();
