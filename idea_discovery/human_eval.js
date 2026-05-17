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
  "problem",
  "background",
  "assumption",
  "idea",
  "method",
  "evidence",
  "limitation",
  "implication",
  "resource",
  "other",
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

const EVAL_SECTIONS = {
  problem: {
    label: "Problem Nodes",
    types: ["problem"],
    question:
      "Based on the abstract only (not the full paper), how well do the problem nodes capture the research problem or motivation mentioned or implied in the abstract?",
  },
  background_resources: {
    label: "Background + Resources",
    types: ["background", "resource"],
    question:
      "Based on the abstract only (not the full paper), how well do the background/resource nodes capture relevant context, prior work, datasets, tools, baselines, or resources that are mentioned or implied in the abstract?",
  },
  idea_method: {
    label: "Idea + Method Subgraph",
    types: ["idea", "method"],
    question:
      "Based on the abstract only (not the full paper), how well do the idea/method nodes capture the main contribution and technical approach as described in the abstract?",
  },
  assumption: {
    label: "Assumption Subgraph",
    types: ["assumption"],
    question:
      "Based on the abstract only (not the full paper), are the inferred assumptions reasonable and supported by what is stated or implied in the abstract?",
  },
  limitation: {
    label: "Limitation Subgraph",
    types: ["limitation"],
    question:
      "Based on the abstract only (not the full paper), are the inferred limitations reasonable and relevant given what is mentioned or implied in the abstract?",
  },
  evidence_implication: {
    label: "Evidence + Implication Subgraph",
    types: ["evidence", "implication"],
    question:
      "Based on the abstract only (not the full paper), how well do the evidence/implication nodes capture the results, claims, conclusions, and broader significance described in the abstract?",
  },
};

const ABSTRACT_REMINDER_TEXT =
  "Reminder: please evaluate alignment using the abstract only as your reference, not the full paper.";

const evalWizardState = {
  sectionKeys: [...Object.keys(EVAL_SECTIONS), "overall"],
  currentIndex: 0,
  currentPaperId: null,
  sourceFileBaseName: "",
  ratings: {},
  overall: {
    score: "",
    confidence: "",
    comment: "",
    use_anonymous_eval: false,
    use_graph_output: false,
    include_acknowledgement: false,
    acknowledgement_name: "",
  },
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
  if (!loadStatus) return;
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
  if (!poolSelect) return;

  poolSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a pool";
  poolSelect.appendChild(placeholder);

  Object.keys(getPools())
    .sort()
    .forEach((poolKey) => {
      const option = document.createElement("option");
      option.value = poolKey;
      option.textContent = poolKey;
      poolSelect.appendChild(option);
    });

  poolSelect.disabled = Object.keys(getPools()).length === 0;
}

function renderPoolSummary(poolKey) {
  if (!poolSummary) return;

  const poolMeta = getPoolMeta(poolKey);
  if (!poolMeta) {
    poolSummary.innerHTML = '<div class="summary-empty">Upload a paper graph JSON to view its paper information.</div>';
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
  if (!paperSelect) return;

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
  if (!paperSummary) return;

  if (!artifact && !paperMeta) {
    paperSummary.innerHTML = '<div class="summary-empty">Upload a paper graph JSON to view its title and abstract.</div>';
    return;
  }

  const paper = artifact?.paper || paperMeta?.paper || {};
  const abstractText = artifact?.source_text || artifact?.graph?.source_text || artifact?.paper?.abstract || "";

  paperSummary.innerHTML = `
    <div>
      <p class="eyebrow">Selected Paper</p>
      <h2 style="margin: 4px 0 10px;">${escapeHtml(paper.title || artifact?.title || "Untitled paper")}</h2>
      <div class="detail-grid" style="margin-bottom: 14px;">
        ${detailCard("Domain", paper.domain || artifact?.domain)}
        ${detailCard("Fine-grained domain", paper.fine_grained_domain || artifact?.fine_grained_domain)}
        ${detailCard("Paper id", paper.paper_id || artifact?.paper_id, "mono")}
        ${detailCard("Paper link", paper.paper_link)}
      </div>
      <p class="detail-value">${escapeHtml(abstractText || "Load the paper to view its abstract and graph.")}</p>
    </div>
  `;
}

function renderArtifactSummary(artifact) {
  if (!graphTitle || !graphStats) return;

  if (!artifact) {
    graphTitle.textContent = "No paper selected";
    graphStats.textContent = "";
    return;
  }

  graphTitle.textContent = artifact.paper?.title || artifact.title || "Untitled paper";

  if (artifact.error) {
    graphStats.textContent = "Graph construction failed for this paper.";
    return;
  }

  const nodeCount = artifact.graph?.nodes?.length || 0;
  const edgeCount = artifact.graph?.edges?.length || 0;
  const domain = artifact.paper?.domain || artifact.domain || artifact.paper?.field || "Unknown domain";
  graphStats.textContent = `${nodeCount} nodes • ${edgeCount} edges • ${domain}`;
}

function wrapText(text, maxChars) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines.slice(0, 4);
}

function computeLevels(graph) {
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];

  const nodeMap = new Map(nodes.map((node) => [node.node_id, node]));
  const incomingCount = new Map(nodes.map((node) => [node.node_id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.node_id, []]));

  for (const edge of edges) {
    if (!nodeMap.has(edge.source_id) || !nodeMap.has(edge.target_id)) continue;
    incomingCount.set(edge.target_id, (incomingCount.get(edge.target_id) || 0) + 1);
    outgoing.get(edge.source_id).push(edge.target_id);
  }

  const queue = [];
  const levels = new Map();

  for (const node of nodes) {
    if ((incomingCount.get(node.node_id) || 0) === 0) {
      queue.push(node.node_id);
      levels.set(node.node_id, 0);
    }
  }

  if (queue.length === 0) {
    const sorted = [...nodes].sort((a, b) => typeRank(a.node_type) - typeRank(b.node_type));
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
      if (!levels.has(next) || candidateLevel > levels.get(next)) {
        levels.set(next, candidateLevel);
      }

      incomingCount.set(next, (incomingCount.get(next) || 0) - 1);
      if ((incomingCount.get(next) || 0) <= 0) {
        queue.push(next);
      }
    }
  }

  for (const node of nodes) {
    if (!levels.has(node.node_id)) {
      levels.set(node.node_id, Math.max(0, typeRank(node.node_type) - 2));
    }
  }

  return levels;
}

function computeLayout(graph) {
  const nodes = graph?.nodes || [];
  const levels = computeLevels(graph);
  const columns = new Map();

  for (const node of nodes) {
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
  const width =
    leftPadding * 2 +
    Math.max(1, orderedLevels.length) * nodeWidth +
    Math.max(0, orderedLevels.length - 1) * horizontalGap;
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

  const path = `M ${startX} ${startY} C ${midX - 42} ${startY}, ${midX - 18} ${startY} ${midX} ${
    startY + (endY > startY ? bend : -bend)
  } S ${endX - 44} ${endY}, ${endX} ${endY}`;

  const labelX = midX;
  const labelY = Math.min(startY, endY) - 10 + Math.abs(endY - startY) * 0.18;

  return { path, labelX, labelY };
}

function createSvgElement(tag, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function attachPanZoom(svg, viewport, width, height) {
  if (!graphCanvas) return;

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

  svg.addEventListener(
    "wheel",
    (event) => {
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
    },
    { passive: false },
  );

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
    viewBox: `0 0 ${graphCanvas?.clientWidth || 1200} ${graphCanvas?.clientHeight || 680}`,
    class: "idea-svg",
    preserveAspectRatio: "xMidYMid meet",
  });

  const defs = createSvgElement("defs");
  const marker = createSvgElement("marker", {
    id: "arrowhead",
    markerWidth: 10,
    markerHeight: 7,
    refX: 9,
    refY: 3.5,
    orient: "auto",
  });

  marker.appendChild(
    createSvgElement("polygon", {
      points: "0 0, 10 3.5, 0 7",
      fill: "rgba(31, 41, 51, 0.68)",
    }),
  );

  defs.appendChild(marker);
  svg.appendChild(defs);

  const viewport = createSvgElement("g");
  const edgeLayer = createSvgElement("g");
  const nodeLayer = createSvgElement("g");

  for (const edge of graph.edges || []) {
    const source = positions.get(edge.source_id);
    const target = positions.get(edge.target_id);
    if (!source || !target) continue;

    const { path, labelX, labelY } = edgeGeometry(source, target);

    const edgeGroup = createSvgElement("g", {
      class: "svg-edge-group",
      "data-edge-id": edge.edge_id,
      tabindex: 0,
    });

    edgeGroup.appendChild(
      createSvgElement("path", {
        d: path,
        fill: "none",
        stroke: "rgba(31, 41, 51, 0.42)",
        "stroke-width": 2.4,
        "marker-end": "url(#arrowhead)",
        class: "svg-edge-path",
      }),
    );

    edgeGroup.appendChild(
      createSvgElement("path", {
        d: path,
        fill: "none",
        stroke: "transparent",
        "stroke-width": 18,
        class: "svg-edge-hit",
      }),
    );

    const bgWidth = Math.max(42, String(edge.edge_type || "").length * 6.7);

    edgeGroup.appendChild(
      createSvgElement("rect", {
        x: labelX - bgWidth / 2,
        y: labelY - 13,
        width: bgWidth,
        height: 20,
        rx: 10,
        ry: 10,
        class: "svg-edge-label-bg",
      }),
    );

    const edgeLabel = createSvgElement("text", {
      x: labelX,
      y: labelY + 1,
      class: "svg-edge-label",
      "text-anchor": "middle",
    });

    edgeLabel.textContent = edge.edge_type || "relatedTo";
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

  for (const node of graph.nodes || []) {
    const position = positions.get(node.node_id);
    if (!position) continue;

    const colors = nodeColor(node.node_type);

    const group = createSvgElement("g", {
      class: "svg-node-group",
      transform: `translate(${position.x}, ${position.y})`,
      "data-node-id": node.node_id,
      tabindex: 0,
    });

    group.appendChild(
      createSvgElement("rect", {
        x: 0,
        y: 0,
        rx: 20,
        ry: 20,
        width: position.width,
        height: position.height,
        fill: colors.fill,
        stroke: colors.stroke,
        "stroke-width": 2.5,
        class: "svg-node-rect",
      }),
    );

    const title = createSvgElement("text", {
      x: 16,
      y: 27,
      fill: "#ffffff",
      class: "svg-node-title",
    });

    wrapText(nodeDisplayText(node), 28).forEach((line, index) => {
      const tspan = createSvgElement("tspan", {
        x: 16,
        dy: index === 0 ? 0 : 17,
      });
      tspan.textContent = line;
      title.appendChild(tspan);
    });

    const typeText = createSvgElement("text", {
      x: 16,
      y: 92,
      fill: "rgba(255,255,255,0.86)",
      class: "svg-node-type",
    });

    typeText.textContent = node.node_type || "other";

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

  if (graphCanvas) graphCanvas.innerHTML = "";

  if (!artifact) {
    if (detailsContent) {
      detailsContent.innerHTML = '<div class="details-empty">Upload a paper graph JSON to view its graph.</div>';
    }
    return;
  }

  if (artifact.error) {
    if (detailsContent) {
      detailsContent.innerHTML = `<div class="error-box">This paper does not currently have a usable graph artifact.<br /><br />${escapeHtml(
        artifact.error,
      )}</div>`;
    }
    return;
  }

  if (!artifact.graph) {
    if (detailsContent) {
      detailsContent.innerHTML = '<div class="error-box">No graph found in this artifact.</div>';
    }
    return;
  }

  graphCanvas?.appendChild(renderSvgGraph(artifact.graph));

  if (detailsContent) {
    detailsContent.innerHTML =
      '<div class="details-empty">Click a node or edge in the graph to inspect its details here. Use scroll to zoom and drag empty space to pan.</div>';
  }
}

function showNodeDetails(nodeId) {
  const artifact = state.currentGraphArtifact;
  const node = artifact?.graph?.nodes?.find((item) => item.node_id === nodeId);
  if (!node || !detailsContent) return;

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
  if (!edge || !detailsContent) return;

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
  if (!dataRootInput) return;

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

  if (detailsContent) {
    detailsContent.innerHTML = '<div class="details-empty">Select a paper to load its graph.</div>';
  }
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
  renderEvalForm(artifact);
  setStatus(`Loaded ${paperMeta.paper?.title || "paper"}`);
}

pickDirectoryButton?.addEventListener("click", async () => {
  if (!window.showDirectoryPicker) {
    setStatus("Directory picker is not available in this browser. Use the JSON upload field instead.", true);
    return;
  }

  try {
    const directoryHandle = await window.showDirectoryPicker();
    state.directoryHandle = directoryHandle;
    if (dataRootInput) dataRootInput.value = directoryHandle.name;
    await loadSummary();
  } catch (error) {
    if (error?.name !== "AbortError") {
      setStatus("Failed to open directory picker", true);
    }
  }
});

loadDataButton?.addEventListener("click", async () => {
  try {
    state.directoryHandle = null;
    await loadSummary();
  } catch (error) {
    setStatus("Failed to load summary", true);
    if (poolSummary) {
      poolSummary.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
    }
  }
});

poolSelect?.addEventListener("change", () => {
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

paperSelect?.addEventListener("change", async () => {
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

graphTextModeSelect?.addEventListener("change", () => {
  state.graphTextMode = graphTextModeSelect.value;

  if (state.currentGraphArtifact?.graph) {
    renderArtifact(state.currentGraphArtifact);
    renderEvalForm(state.currentGraphArtifact);
  }
});

async function initialize() {
  if (!dataRootInput || !poolSummary) return;

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

function getParsedStage(section, stageName) {
  const records = section?.conditional_records || section?.extraction_records || [];
  const record = records.find((item) => item?.stage === stageName);
  return record?.parsed || null;
}

function buildGraphFromConditionalRecords(section) {
  const explicitConcepts = getParsedStage(section, "initial_concepts")?.concepts || [];
  const latentConcepts = getParsedStage(section, "initial_latent_concepts")?.concepts || [];
  const concepts = [...explicitConcepts, ...latentConcepts];

  const typeAssignments = getParsedStage(section, "initial_node_types")?.node_type_assignments || [];
  const rawEdges = getParsedStage(section, "initial_edge_types")?.edges || [];

  if (!concepts.length) return null;

  const nodes = concepts.map((concept, index) => {
    const assignment = typeAssignments[index] || {};

    return {
      node_id: concept.node_id || assignment.node_id || `node_${String(index + 1).padStart(3, "0")}`,
      label: concept.label || assignment.label || `Node ${index + 1}`,
      text: concept.text || "",
      domain_agnostic_text: concept.domain_agnostic_text || "",
      node_type: assignment.node_type || concept.node_type || "other",
      latent: Boolean(concept.latent),
      confidence: concept.confidence ?? assignment.confidence ?? null,
      evidence: concept.evidence || assignment.rationale || "",
      metadata: concept.metadata || {},
    };
  });

  const nodeIds = new Set(nodes.map((node) => node.node_id));

  const edges = rawEdges
    .map((edge, index) => ({
      edge_id: edge.edge_id || `edge_${String(index + 1).padStart(3, "0")}`,
      source_id: edge.source_id,
      target_id: edge.target_id,
      edge_type: edge.edge_type || "relatedTo",
      confidence: edge.confidence ?? null,
      evidence: edge.evidence || "",
    }))
    .filter((edge) => edge.source_id && edge.target_id && nodeIds.has(edge.source_id) && nodeIds.has(edge.target_id));

  return {
    source_text: section?.source_text || "",
    nodes,
    edges,
  };
}

function normalizeHumanStudyArtifact(raw) {
  const section = raw.abstract || raw.proposal || {};
  const graph = section.graph || raw.graph || buildGraphFromConditionalRecords(section);

  return {
    paper: raw.paper || {
      title: raw.title || raw.paper_id || "Untitled paper",
      paper_id: raw.paper_id,
      domain: raw.domain || section.domain,
      fine_grained_domain: raw.fine_grained_domain || section.fine_grained_domain,
      paper_link: section.metadata?.paper_link || null,
      abstract: section.source_text || "",
    },
    paper_id: raw.paper_id,
    title: raw.title || raw.paper_id,
    domain: raw.domain || section.domain,
    fine_grained_domain: raw.fine_grained_domain || section.fine_grained_domain,
    graph,
    source_text: section.source_text || raw.paper?.abstract || graph?.source_text || "",
  };
}

function getNodesForEvalSection(graph, sectionKey) {
  const config = EVAL_SECTIONS[sectionKey];
  if (!config || !graph?.nodes) return [];
  return graph.nodes.filter((node) => config.types.includes(node.node_type));
}

function getCurrentSectionKey() {
  return evalWizardState.sectionKeys[evalWizardState.currentIndex];
}

function isOverallSection(sectionKey) {
  return sectionKey === "overall";
}

function getCurrentPaperId(artifact) {
  return artifact?.paper?.paper_id || artifact?.paper_id || artifact?.title || "unknown_paper";
}

function parseAssignmentFromFileName(fileName) {
  const match = fileName.match(/^([A-Za-z0-9-]+)_(own|overlap)_(human_study_\d+)\.json$/i);

  if (!match) {
    return {
      evaluator_id: "",
      assignment_type: "",
      paper_id_from_filename: "",
    };
  }

  return {
    evaluator_id: match[1],
    assignment_type: match[2].toLowerCase(),
    paper_id_from_filename: match[3],
  };
}

function ensureRatingState() {
  for (const sectionKey of Object.keys(EVAL_SECTIONS)) {
    if (!evalWizardState.ratings[sectionKey]) {
      evalWizardState.ratings[sectionKey] = {
        score: "",
        confidence: "",
        comment: "",
      };
    }
  }
}

function saveCurrentSectionInputs() {
  const sectionKey = getCurrentSectionKey();
  if (!sectionKey || isOverallSection(sectionKey)) return;

  const score = document.getElementById("current-section-score")?.value || "";
  const confidence = document.getElementById("current-section-confidence")?.value || "";
  const comment = document.getElementById("current-section-comment")?.value || "";

  evalWizardState.ratings[sectionKey] = {
    score,
    confidence,
    comment,
  };
}

function updateEvalProgress() {
  const progressEl = document.getElementById("eval-progress");
  if (!progressEl) return;

  const subgraphKeys = Object.keys(EVAL_SECTIONS);
  const total = subgraphKeys.length;
  let completed = 0;

  for (const sectionKey of subgraphKeys) {
    const rating = evalWizardState.ratings[sectionKey] || {};
    if (rating.score && rating.confidence) completed += 1;
  }

  const currentSectionKey = getCurrentSectionKey();
  const currentLabel = isOverallSection(currentSectionKey)
    ? "Overall Evaluation"
    : EVAL_SECTIONS[currentSectionKey]?.label || "No section selected";

  progressEl.textContent =
    `Progress: ${completed}/${total} subgraph sections completed. ` +
    `Current section: ${currentLabel}. ` +
    `You must complete every score and confidence field before exporting. ` +
    `Please evaluate based on the abstract only, not the full paper.`;
}

function setOverallSectionVisibility() {
  const overallSection = document.getElementById("overall-eval-section");
  if (!overallSection) return;
  overallSection.style.display = "none";
}

function updateSubmitButtonState() {
  const nextButton = document.getElementById("next-section-button");
  if (!nextButton || !isOverallSection(getCurrentSectionKey())) return;

  const missing = validateEvalComplete();
  const isComplete = missing.length === 0;

  nextButton.disabled = !isComplete;
  nextButton.textContent = "Submit & Download Evaluation JSON";
  nextButton.title = isComplete
    ? "Submit and download your completed evaluation JSON."
    : `Complete these required fields first: ${missing.join(", ")}`;
}

function buildWizardShell() {
  const evalForm = document.getElementById("eval-form");
  if (!evalForm) return;

  evalForm.innerHTML = `
    <div class="abstract-reminder-banner" style="border:1px solid rgba(217,123,41,0.35); background:rgba(217,123,41,0.10); color:#7a4a0e; border-radius:14px; padding:12px 16px; margin-bottom:12px; font-size:0.92rem; font-weight:600;">
      📄 Evaluate based on the abstract only, not the full paper. The abstract is shown in the paper summary panel above for reference.
    </div>

    <div id="eval-progress" class="eval-scale-note">
      Progress: 0/${Object.keys(EVAL_SECTIONS).length} subgraph sections completed. Please evaluate based on the abstract only, not the full paper.
    </div>

    <div class="subgraph-eval-workspace" style="display:grid; grid-template-columns:minmax(0, 1.25fr) minmax(340px, 0.75fr); gap:18px; align-items:start;">
      <section class="subgraph-view-panel" style="border:1px solid var(--line); border-radius:18px; background:rgba(255,255,255,0.45); padding:18px; max-height:720px; overflow:auto;">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Current Step (evaluate against the abstract only)</p>
            <h3 id="current-section-title">No section selected</h3>
          </div>
        </div>
        <div id="eval-section-view">
          <div class="summary-empty">Upload a paper graph JSON to begin evaluation.</div>
        </div>
      </section>

      <aside class="subgraph-form-panel" style="border:1px solid var(--line); border-radius:18px; background:rgba(255,255,255,0.45); padding:18px; position:sticky; top:18px;">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Evaluation Form (rate against the abstract only)</p>
            <h3 id="current-section-form-title">Rating</h3>
          </div>
        </div>

        <div id="eval-section-form">
          <div class="summary-empty">Upload a paper graph JSON to begin evaluation.</div>
        </div>

        <div class="wizard-actions" style="display:flex; justify-content:space-between; gap:12px; margin-top:16px;">
          <button id="prev-section-button" type="button" class="ghost-button">Previous</button>
          <button id="next-section-button" type="button">Next</button>
        </div>
      </aside>
    </div>
  `;

  document.getElementById("prev-section-button")?.addEventListener("click", () => {
    saveCurrentSectionInputs();
    if (evalWizardState.currentIndex > 0) {
      evalWizardState.currentIndex -= 1;
      renderCurrentEvalSection();
    }
  });

  document.getElementById("next-section-button")?.addEventListener("click", () => {
    saveCurrentSectionInputs();

    if (isOverallSection(getCurrentSectionKey())) {
        exportEvalResults();
        return;
    }

    if (evalWizardState.currentIndex < evalWizardState.sectionKeys.length - 1) {
        evalWizardState.currentIndex += 1;
        renderCurrentEvalSection();
    }
  });
}

function renderOverallSection(viewEl, formEl, titleEl, formTitleEl, prevButton, nextButton) {
  if (titleEl) titleEl.textContent = "Overall Evaluation";
  if (formTitleEl) formTitleEl.textContent = "Overall Rating";

  viewEl.innerHTML = `
    <div class="detail-card" style="border-left:5px solid var(--accent-2);">
      <p class="detail-value">
        <b>${escapeHtml(ABSTRACT_REMINDER_TEXT)}</b>
      </p>
    </div>
    <div class="detail-card">
      <p class="detail-value">
        You have completed all subgraph sections. Now provide an overall rating for how well the full graph captures the original abstract (not the full paper).
      </p>
      <p class="detail-value">
        You can click Previous to review earlier sections before exporting.
      </p>
    </div>
  `;

  formEl.innerHTML = `
    <div style="margin-bottom:18px;">
      <label style="display:block; font-size:0.9rem; color:var(--muted); font-weight:600; margin-bottom:8px;">
        Based on the abstract only (not the full paper), how well does the graph as a whole capture the abstract?
      </label>
      <select id="overall-alignment-score">
        <option value="">Select</option>
        <option value="1" ${evalWizardState.overall.score === "1" ? "selected" : ""}>1 - Very poor</option>
        <option value="2" ${evalWizardState.overall.score === "2" ? "selected" : ""}>2 - Poor</option>
        <option value="3" ${evalWizardState.overall.score === "3" ? "selected" : ""}>3 - Moderate</option>
        <option value="4" ${evalWizardState.overall.score === "4" ? "selected" : ""}>4 - Good</option>
        <option value="5" ${evalWizardState.overall.score === "5" ? "selected" : ""}>5 - Excellent</option>
      </select>
    </div>

    <div style="margin-bottom:18px;">
      <label style="display:block; font-size:0.9rem; color:var(--muted); font-weight:600; margin-bottom:8px;">
        Overall, how confident are you in your ability to evaluate this paper (based on its abstract)?
      </label>
      <select id="overall-confidence">
        <option value="">Select</option>
        <option value="1" ${evalWizardState.overall.confidence === "1" ? "selected" : ""}>1 - Not confident</option>
        <option value="2" ${evalWizardState.overall.confidence === "2" ? "selected" : ""}>2 - Slightly confident</option>
        <option value="3" ${evalWizardState.overall.confidence === "3" ? "selected" : ""}>3 - Moderately confident</option>
        <option value="4" ${evalWizardState.overall.confidence === "4" ? "selected" : ""}>4 - Confident</option>
        <option value="5" ${evalWizardState.overall.confidence === "5" ? "selected" : ""}>5 - Very confident</option>
      </select>
    </div>

    <div style="margin-bottom:18px;">
      <label style="display:block; font-size:0.9rem; color:var(--muted); font-weight:600; margin-bottom:8px;">
        Overall comments (with respect to the abstract)
      </label>
      <textarea id="overall-comment" rows="5" style="width:100%; resize:vertical; border-radius:14px; border:1px solid rgba(31,41,51,0.12); font:inherit; padding:13px 14px; background:var(--panel-strong); color:var(--text);">${escapeHtml(
        evalWizardState.overall.comment || "",
      )}</textarea>
    </div>

    <h3>Consent / Acknowledgement</h3>

    <div class="consent-block">
      <label>
        <input type="checkbox" id="consent-eval" ${evalWizardState.overall.use_anonymous_eval ? "checked" : ""} />
        I consent to my anonymized evaluation responses being used for research.
      </label>

      <label>
        <input type="checkbox" id="consent-graph" ${evalWizardState.overall.use_graph_output ? "checked" : ""} />
        I consent to the generated graph output being used for research.
      </label>

      <label>
        <input type="checkbox" id="ack-consent" ${evalWizardState.overall.include_acknowledgement ? "checked" : ""} />
        I would like to be acknowledged in the paper.
      </label>
    </div>

    <div style="margin-bottom:18px;">
      <label style="display:block; font-size:0.9rem; color:var(--muted); font-weight:600; margin-bottom:8px;">
        Acknowledgement name, optional
      </label>
      <input id="ack-name" placeholder="Name to include in acknowledgements" value="${escapeHtml(
        evalWizardState.overall.acknowledgement_name || "",
      )}" />
    </div>
  `;

  document.getElementById("overall-alignment-score")?.addEventListener("change", () => {
    evalWizardState.overall.score = document.getElementById("overall-alignment-score")?.value || "";
    updateEvalProgress();
    updateSubmitButtonState();
  });

  document.getElementById("overall-confidence")?.addEventListener("change", () => {
    evalWizardState.overall.confidence = document.getElementById("overall-confidence")?.value || "";
    updateEvalProgress();
    updateSubmitButtonState();
  });

  document.getElementById("overall-comment")?.addEventListener("input", () => {
    evalWizardState.overall.comment = document.getElementById("overall-comment")?.value || "";
  });

  document.getElementById("consent-eval")?.addEventListener("change", () => {
    evalWizardState.overall.use_anonymous_eval = Boolean(document.getElementById("consent-eval")?.checked);
  });

  document.getElementById("consent-graph")?.addEventListener("change", () => {
    evalWizardState.overall.use_graph_output = Boolean(document.getElementById("consent-graph")?.checked);
  });

  document.getElementById("ack-consent")?.addEventListener("change", () => {
    evalWizardState.overall.include_acknowledgement = Boolean(document.getElementById("ack-consent")?.checked);
  });

  document.getElementById("ack-name")?.addEventListener("input", () => {
    evalWizardState.overall.acknowledgement_name = document.getElementById("ack-name")?.value || "";
  });

    if (prevButton) prevButton.disabled = false;
    if (nextButton) {
        nextButton.textContent = "Submit & Download Evaluation JSON";
        nextButton.disabled = true;
        nextButton.title = "Complete all required fields before submitting.";
    }

    updateEvalProgress();
    updateSubmitButtonState();
    setOverallSectionVisibility();
}

function renderCurrentEvalSection() {
  const artifact = state.currentGraphArtifact;
  const viewEl = document.getElementById("eval-section-view");
  const formEl = document.getElementById("eval-section-form");
  const titleEl = document.getElementById("current-section-title");
  const formTitleEl = document.getElementById("current-section-form-title");
  const prevButton = document.getElementById("prev-section-button");
  const nextButton = document.getElementById("next-section-button");

  if (!viewEl || !formEl) return;

  if (!artifact || artifact.error || !artifact.graph) {
    viewEl.innerHTML = '<div class="summary-empty">Upload a paper graph JSON to begin evaluation.</div>';
    formEl.innerHTML = '<div class="summary-empty">Upload a paper graph JSON to begin evaluation.</div>';
    if (titleEl) titleEl.textContent = "No section selected";
    if (formTitleEl) formTitleEl.textContent = "Rating";
    updateEvalProgress();
    setOverallSectionVisibility();
    return;
  }

  ensureRatingState();

  const sectionKey = getCurrentSectionKey();

  if (isOverallSection(sectionKey)) {
    renderOverallSection(viewEl, formEl, titleEl, formTitleEl, prevButton, nextButton);
    return;
  }

  const config = EVAL_SECTIONS[sectionKey];
  const nodes = getNodesForEvalSection(artifact.graph, sectionKey);
  const rating = evalWizardState.ratings[sectionKey] || {};

  if (titleEl) titleEl.textContent = config.label;
  if (formTitleEl) formTitleEl.textContent = `${config.label} Rating`;

  viewEl.innerHTML = `
    <div class="abstract-reminder-inline" style="border-left:4px solid var(--accent-2); background:rgba(217,123,41,0.08); padding:10px 14px; border-radius:10px; margin-bottom:14px; font-size:0.88rem; color:#7a4a0e;">
      ${escapeHtml(ABSTRACT_REMINDER_TEXT)}
    </div>

    <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
      <span class="detail-chip">${escapeHtml(config.label)}</span>
      <span class="detail-chip">${nodes.length} node${nodes.length === 1 ? "" : "s"}</span>
    </div>

    ${
      nodes.length
        ? nodes
            .map(
              (node) => `
        <div class="detail-card" style="margin-bottom:12px; ${node.latent ? "border-left:5px solid var(--accent-2);" : ""}">
          <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
            <span class="detail-chip">${escapeHtml(node.node_type || "other")}</span>
            ${node.latent ? `<span class="detail-chip" style="background:rgba(217,123,41,0.12); color:#a35614;">latent</span>` : ""}
            ${
              node.confidence != null
                ? `<span class="detail-chip">model confidence: ${escapeHtml(node.confidence)}</span>`
                : ""
            }
          </div>
          <p class="detail-value"><b>${escapeHtml(node.label || node.node_id)}</b></p>
          <p class="detail-value">${escapeHtml(node.text || "")}</p>
          ${
            node.domain_agnostic_text
              ? `<p class="detail-value"><b>Domain-agnostic:</b> ${escapeHtml(node.domain_agnostic_text)}</p>`
              : ""
          }
          ${
            node.evidence
              ? `<p class="detail-value"><b>Evidence / justification:</b> ${escapeHtml(node.evidence)}</p>`
              : ""
          }
        </div>
      `,
            )
            .join("")
        : `<p class="detail-value"><i>No nodes extracted for this section.</i></p>`
    }
  `;

  formEl.innerHTML = `
    <div style="margin-bottom:18px;">
      <label style="display:block; font-size:0.9rem; color:var(--muted); font-weight:600; margin-bottom:8px;">
        ${escapeHtml(config.question)}
      </label>
      <select id="current-section-score">
        <option value="">Select</option>
        <option value="1" ${rating.score === "1" ? "selected" : ""}>1 - Very poor</option>
        <option value="2" ${rating.score === "2" ? "selected" : ""}>2 - Poor</option>
        <option value="3" ${rating.score === "3" ? "selected" : ""}>3 - Moderate</option>
        <option value="4" ${rating.score === "4" ? "selected" : ""}>4 - Good</option>
        <option value="5" ${rating.score === "5" ? "selected" : ""}>5 - Excellent</option>
      </select>
    </div>

    <div style="margin-bottom:18px;">
      <label style="display:block; font-size:0.9rem; color:var(--muted); font-weight:600; margin-bottom:8px;">
        How confident are you in your rating for this section (based on the abstract)?
      </label>
      <select id="current-section-confidence">
        <option value="">Select</option>
        <option value="1" ${rating.confidence === "1" ? "selected" : ""}>1 - Not confident</option>
        <option value="2" ${rating.confidence === "2" ? "selected" : ""}>2 - Slightly confident</option>
        <option value="3" ${rating.confidence === "3" ? "selected" : ""}>3 - Moderately confident</option>
        <option value="4" ${rating.confidence === "4" ? "selected" : ""}>4 - Confident</option>
        <option value="5" ${rating.confidence === "5" ? "selected" : ""}>5 - Very confident</option>
      </select>
    </div>

    <div style="margin-bottom:18px;">
      <label style="display:block; font-size:0.9rem; color:var(--muted); font-weight:600; margin-bottom:8px;">
        Comments: With respect to the abstract, what is missing, incorrect, unsupported, or confusing?
      </label>
      <textarea id="current-section-comment" rows="5" style="width:100%; resize:vertical; border-radius:14px; border:1px solid rgba(31,41,51,0.12); font:inherit; padding:13px 14px; background:var(--panel-strong); color:var(--text);">${escapeHtml(
        rating.comment || "",
      )}</textarea>
    </div>
  `;

  document.getElementById("current-section-score")?.addEventListener("change", () => {
    saveCurrentSectionInputs();
    updateEvalProgress();
  });

  document.getElementById("current-section-confidence")?.addEventListener("change", () => {
    saveCurrentSectionInputs();
    updateEvalProgress();
  });

  document.getElementById("current-section-comment")?.addEventListener("input", () => {
    saveCurrentSectionInputs();
  });

  if (prevButton) {
    prevButton.disabled = evalWizardState.currentIndex === 0;
  }

  if (nextButton) {
    const isFinalStep =
      evalWizardState.currentIndex === evalWizardState.sectionKeys.length - 1;

    const isBeforeOverall =
      evalWizardState.currentIndex === evalWizardState.sectionKeys.length - 2;

    nextButton.textContent = isFinalStep
      ? "Final Step"
      : isBeforeOverall
        ? "Go to Overall Evaluation"
        : "Next";

    nextButton.disabled = isFinalStep;
  }

  updateEvalProgress();
  setOverallSectionVisibility();
}

function renderEvalForm(artifact) {
  const evalForm = document.getElementById("eval-form");
  if (!evalForm) return;

  const paperId = getCurrentPaperId(artifact);

  if (evalWizardState.currentPaperId !== paperId) {
    evalWizardState.currentPaperId = paperId;
    evalWizardState.currentIndex = 0;
    evalWizardState.ratings = {};
    evalWizardState.overall = {
      score: "",
      confidence: "",
      comment: "",
      use_anonymous_eval: false,
      use_graph_output: false,
      include_acknowledgement: false,
      acknowledgement_name: "",
    };
  }

  ensureRatingState();
  buildWizardShell();
  renderCurrentEvalSection();
}

function validateEvalComplete() {
  saveCurrentSectionInputs();

  const missing = [];
  const evaluatorId = document.getElementById("evaluator-id")?.value || "";
  const assignmentType = document.getElementById("assignment-type")?.value || "";
  const overallScore = evalWizardState.overall.score || "";
  const overallConfidence = evalWizardState.overall.confidence || "";

  if (!evaluatorId.trim()) {
    missing.push("Evaluator ID");
  }

  if (!assignmentType.trim()) {
    missing.push("Assignment type");
  }

  for (const sectionKey of Object.keys(EVAL_SECTIONS)) {
    const config = EVAL_SECTIONS[sectionKey];
    const rating = evalWizardState.ratings[sectionKey] || {};

    if (!rating.score) {
      missing.push(`${config.label} score`);
    }

    if (!rating.confidence) {
      missing.push(`${config.label} confidence`);
    }
  }

  if (!overallScore) {
    missing.push("Overall alignment score");
  }

  if (!overallConfidence) {
    missing.push("Overall confidence");
  }

  return missing;
}

function collectEvalResults() {
  const artifact = state.currentGraphArtifact;

  if (!artifact || !artifact.graph) {
    alert("Please upload and load a graph before exporting.");
    return null;
  }

  saveCurrentSectionInputs();

  const paper = artifact.paper || {};
  const evaluatorId = document.getElementById("evaluator-id")?.value || "";
  const assignmentType = document.getElementById("assignment-type")?.value || "";

  const ratings = {};

  for (const sectionKey of Object.keys(EVAL_SECTIONS)) {
    ratings[sectionKey] = {
      score: evalWizardState.ratings[sectionKey]?.score || "",
      confidence: evalWizardState.ratings[sectionKey]?.confidence || "",
      comment: evalWizardState.ratings[sectionKey]?.comment || "",
      node_count: getNodesForEvalSection(artifact.graph, sectionKey).length,
    };
  }

  return {
    evaluator_id: evaluatorId,
    assignment_type: assignmentType,
    submitted_by_evaluator: assignmentType === "own",
    paper_id: paper.paper_id || artifact.paper_id || artifact.title || "unknown_paper",
    paper_title: paper.title || artifact.title || "",
    paper_domain: paper.domain || artifact.domain || "",
    fine_grained_domain: paper.fine_grained_domain || artifact.fine_grained_domain || "",
    paper_link: paper.paper_link || artifact.abstract?.metadata?.paper_link || "",
    evaluation_reference: "abstract_only",
    ratings,
    overall_alignment_score: evalWizardState.overall.score || "",
    overall_confidence: evalWizardState.overall.confidence || "",
    overall_comment: evalWizardState.overall.comment || "",
    consent: {
      use_anonymous_eval: Boolean(evalWizardState.overall.use_anonymous_eval),
      use_graph_output: Boolean(evalWizardState.overall.use_graph_output),
      include_acknowledgement: Boolean(evalWizardState.overall.include_acknowledgement),
      acknowledgement_name: evalWizardState.overall.acknowledgement_name || "",
    },
    timestamp: new Date().toISOString(),
  };
}

function exportEvalResults() {
  const missing = validateEvalComplete();

  if (missing.length > 0) {
    alert(
      "Please complete the following before exporting:\n\n" +
        missing.map((item) => `- ${item}`).join("\n"),
    );
    return;
  }

  const result = collectEvalResults();
  if (!result) return;

  const evaluator = result.evaluator_id || "unknown";
  const paperId = result.paper_id || "unknown_paper";
  const baseName = evalWizardState.sourceFileBaseName || `${evaluator}_${paperId}`;
  const fileName = `${baseName}_eval.json`;

  const blob = new Blob([JSON.stringify(result, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

document.getElementById("json-file-input")?.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const assignment = parseAssignmentFromFileName(file.name);

  if (!assignment.evaluator_id || !assignment.assignment_type) {
    alert(
      "Please upload an assigned JSON file named like E05_overlap_human_study_0001.json or E01_own_human_study_0001.json. Do not rename the assigned file.",
    );
    return;
  }

  const evaluatorInput = document.getElementById("evaluator-id");
  const assignmentInput = document.getElementById("assignment-type");

  if (evaluatorInput) {
    evaluatorInput.value = assignment.evaluator_id;
  }

  if (assignmentInput) {
    assignmentInput.value = assignment.assignment_type;
  }

  evalWizardState.sourceFileBaseName = file.name.replace(/\.json$/i, "");

  try {
    const text = await file.text();
    const raw = JSON.parse(text);
    const artifact = normalizeHumanStudyArtifact(raw);

    if (!artifact.graph) {
      alert("Loaded the file, but could not find the graph inside this JSON.");
      return;
    }

    renderArtifact(artifact);
    renderEvalForm(artifact);
    setStatus(
      `Loaded ${artifact.paper?.title || artifact.paper_id || file.name}. ` +
        `Evaluator: ${assignment.evaluator_id}. Assignment: ${assignment.assignment_type}.`,
    );
  } catch (error) {
    console.error(error);
    alert(`Failed to load JSON: ${error.message}`);
  }
});

setStatus("Upload an assigned JSON file, e.g., E05_overlap_human_study_0001.json.");
renderArtifact(null);
renderEvalForm(null);