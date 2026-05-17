const CONFIG = window.TRANSITION_VIEWER_CONFIG || {};
const DEFAULT_DATA_ROOT = CONFIG.defaultDataRoot || "../traj_modeling/trajectory_graphs/out/deep_graphs";

const NODE_COLORS = {
  problem: { fill: "#d1495b", stroke: "#a52842" },
  background: { fill: "#6b7280", stroke: "#48505d" },
  assumption: { fill: "#d97b29", stroke: "#a35614" },
  idea: { fill: "#7a4cc4", stroke: "#573592" },
  method: { fill: "#1d7874", stroke: "#125853" },
  evidence: { fill: "#2a6fdb", stroke: "#1b4d9a" },
  limitation: { fill: "#ef476f", stroke: "#ae2448" },
  implication: { fill: "#8d99ae", stroke: "#616b7d" },
  resource: { fill: "#c0841a", stroke: "#8c5e0f" },
  other: { fill: "#3c7a89", stroke: "#1f5560" },
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

const CONDITIONAL_PREVIOUS_STATUS_ORDER = ["keep", "update", "delete", "other"];
const CONDITIONAL_CURRENT_STATUS_ORDER = ["keep", "update", "new", "other"];

const state = {
  dataRoot: DEFAULT_DATA_ROOT,
  directoryHandle: null,
  manifest: null,
  selectedTrajectoryName: "",
  selectedTransitionIndex: null,
  graphTextMode: "label",
  currentArtifact: null,
};

const loadStatus = document.getElementById("load-status");
const dataRootInput = document.getElementById("data-root-input");
const pickDirectoryButton = document.getElementById("pick-directory-button");
const loadDataButton = document.getElementById("load-data-button");
const questionSelect = document.getElementById("question-select");
const transitionSelect = document.getElementById("transition-select");
const graphTextModeSelect = document.getElementById("graph-text-mode");
const questionSummary = document.getElementById("question-summary");
const transitionSummary = document.getElementById("transition-summary");
const conditionalDiffSummary = document.getElementById("conditional-diff-summary");
const detailsContent = document.getElementById("details-content");

const previousGraphTitle = document.getElementById("previous-graph-title");
const previousGraphStats = document.getElementById("previous-graph-stats");
const previousGraphCanvas = document.getElementById("previous-graph-canvas");
const previousGraphLegend = document.getElementById("previous-graph-legend");
const previousProposalContent = document.getElementById("previous-proposal-content");
const previousGraphPanel = document.getElementById("previous-graph-panel");
const previousFullscreenButton = document.getElementById("previous-fullscreen-button");

const currentGraphTitle = document.getElementById("current-graph-title");
const currentGraphStats = document.getElementById("current-graph-stats");
const currentGraphCanvas = document.getElementById("current-graph-canvas");
const currentGraphLegend = document.getElementById("current-graph-legend");
const currentProposalContent = document.getElementById("current-proposal-content");
const currentGraphPanel = document.getElementById("current-graph-panel");
const currentFullscreenButton = document.getElementById("current-fullscreen-button");

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
  const parts = String(relativePath).split(/[\\/]/).filter(Boolean);
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

function shortText(text, maxLength = 900) {
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

function basename(path) {
  return String(path || "").split(/[\\/]/).pop();
}

function artifactRelativePath(entry) {
  return basename(entry.path || "");
}

function artifactFetchPath(entry) {
  return `${state.dataRoot}/${encodeURIComponent(artifactRelativePath(entry))}`;
}

function trajectoryEntries() {
  return Array.isArray(state.manifest?.trajectories) ? state.manifest.trajectories : [];
}

function parseQuestionNumber(trajectoryName) {
  const match = String(trajectoryName || "").match(/research_q_(\d+)/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function trajectoryLabel(entry) {
  const name = entry.trajectory_name || "";
  const questionMatch = name.match(/(research_q_\d+)/);
  const runMatch = name.match(/(run_\d+)/);
  if (questionMatch && runMatch) return `${questionMatch[1]} (${runMatch[1]})`;
  return name || "Unknown trajectory";
}

function getSelectedTrajectoryEntry() {
  return trajectoryEntries().find((entry) => entry.trajectory_name === state.selectedTrajectoryName) || null;
}

function transitionOptionsForArtifact(artifact) {
  const graphs = artifact?.graphs || [];
  const options = [];
  for (let index = 1; index < graphs.length; index += 1) {
    const previous = graphs[index - 1];
    const current = graphs[index];
    options.push({
      index,
      label: `${previous.revision_id} -> ${current.revision_id} (${current.section || "revision"})`,
    });
  }
  return options;
}

function currentTransition() {
  const graphs = state.currentArtifact?.graphs || [];
  if (!graphs.length || state.selectedTransitionIndex == null) return null;
  const current = graphs[state.selectedTransitionIndex];
  const previous = graphs[state.selectedTransitionIndex - 1];
  if (!current || !previous) return null;
  return { previous, current };
}

function nodeDisplayText(node) {
  if (state.graphTextMode === "domain-agnostic") {
    return node.domain_agnostic_text || node.text || node.label || node.node_id;
  }
  return node.label || node.text || node.node_id;
}

function latestStageError(entry) {
  const records = entry?.conditional_records || entry?.extraction_records || [];
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record?.parsed?.error) {
      return { stage: record.stage, message: record.parsed.error };
    }
  }
  return null;
}

function buildConditionalAnnotations(transition) {
  if (!transition || CONFIG.pageKind !== "conditional") {
    return null;
  }
  const previousNodes = transition.previous?.graph?.nodes || [];
  const currentNodes = transition.current?.graph?.nodes || [];
  const previousIds = new Set(previousNodes.map((node) => node.node_id));
  const currentIds = new Set(currentNodes.map((node) => node.node_id));
  const previousStatus = new Map();
  const currentStatus = new Map();

  for (const record of transition.current?.conditional_records || []) {
    if (!String(record?.stage || "").startsWith("node_update:")) continue;
    const parsed = record?.parsed || {};
    if (!Array.isArray(parsed.updates)) continue;
    for (const update of parsed.updates) {
      const nodeId = update?.prior_node_id;
      const action = update?.action;
      if (!nodeId || !action) continue;
      if (action === "delete") {
        previousStatus.set(nodeId, "delete");
      } else if (action === "update") {
        previousStatus.set(nodeId, "update");
        currentStatus.set(nodeId, "update");
      } else if (action === "keep") {
        previousStatus.set(nodeId, "keep");
        currentStatus.set(nodeId, "keep");
      }
    }
  }

  previousIds.forEach((nodeId) => {
    if (!previousStatus.has(nodeId)) {
      previousStatus.set(nodeId, currentIds.has(nodeId) ? "keep" : "delete");
    }
  });

  currentIds.forEach((nodeId) => {
    if (!currentStatus.has(nodeId)) {
      currentStatus.set(nodeId, previousIds.has(nodeId) ? "keep" : "new");
    }
  });

  return { previousStatus, currentStatus };
}

function uniqueNodeKey(node) {
  return `${node?.node_type || "other"}::${node?.label || ""}::${node?.text || ""}::${node?.domain_agnostic_text || ""}`;
}

function summarizeConditionalDiff(transition, annotations) {
  if (!transition || CONFIG.pageKind !== "conditional") {
    return null;
  }

  const previousNodes = transition.previous?.graph?.nodes || [];
  const currentNodes = transition.current?.graph?.nodes || [];
  const deleted = [];
  const updated = [];
  const added = [];

  previousNodes.forEach((node) => {
    if ((annotations?.previousStatus?.get(node.node_id) || "other") === "delete") {
      deleted.push(node);
    }
  });

  currentNodes.forEach((node) => {
    const status = annotations?.currentStatus?.get(node.node_id) || "other";
    if (status === "update") updated.push(node);
    if (status === "new") added.push(node);
  });

  const dedupe = (nodes) => {
    const seen = new Set();
    return nodes.filter((node) => {
      const key = uniqueNodeKey(node);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  return {
    deleted: dedupe(deleted),
    updated: dedupe(updated),
    added: dedupe(added),
  };
}

function diffNodeChip(node, statusClass) {
  return `
    <span class="diff-node-chip is-${statusClass}" title="${escapeHtml(nodeDisplayText(node))}">
      <span class="diff-node-type-dot" style="background:${nodeColor(node.node_type).fill};"></span>
      <span class="diff-node-text">${escapeHtml(nodeDisplayText(node))}</span>
    </span>
  `;
}

function renderConditionalDiffSummary() {
  if (!conditionalDiffSummary) return;
  const transition = currentTransition();
  const annotations = buildConditionalAnnotations(transition);
  const diff = summarizeConditionalDiff(transition, annotations);

  if (!diff) {
    conditionalDiffSummary.innerHTML = '<div class="summary-empty">Select a transition to see which nodes were deleted, updated, or added.</div>';
    return;
  }

  const renderSection = (title, nodes, statusClass, emptyText) => `
    <section class="diff-status-card is-${statusClass}">
      <div class="diff-status-heading">
        <h3 class="diff-status-title">${escapeHtml(title)}</h3>
        <span class="diff-count">${nodes.length}</span>
      </div>
      ${nodes.length
        ? `<div class="diff-node-list">${nodes.map((node) => diffNodeChip(node, statusClass)).join("")}</div>`
        : `<div class="summary-empty">${escapeHtml(emptyText)}</div>`}
    </section>
  `;

  conditionalDiffSummary.innerHTML = `
    <div>
      <p class="eyebrow">Node Transition Summary</p>
      <h2 style="margin: 4px 0 8px;">${escapeHtml(`${transition.previous.revision_id} -> ${transition.current.revision_id}`)}</h2>
      <p class="subtitle" style="margin: 0; max-width: none;">
        Deleted nodes are pulled from the prior graph, updated nodes reflect carried-forward nodes with changed content or metadata, and added nodes are newly introduced in the current graph.
      </p>
      <div class="diff-summary-grid">
        ${renderSection("Deleted", diff.deleted, "delete", "No deleted nodes in this transition.")}
        ${renderSection("Updated", diff.updated, "update", "No updated nodes in this transition.")}
        ${renderSection("Added", diff.added, "new", "No new nodes in this transition.")}
      </div>
    </div>
  `;
}

function renderTrajectoryOptions() {
  questionSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a research question";
  questionSelect.appendChild(placeholder);

  trajectoryEntries()
    .slice()
    .sort((a, b) => {
      const questionDelta = parseQuestionNumber(a.trajectory_name) - parseQuestionNumber(b.trajectory_name);
      if (questionDelta !== 0) return questionDelta;
      return String(a.trajectory_name).localeCompare(String(b.trajectory_name));
    })
    .forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.trajectory_name;
      option.textContent = trajectoryLabel(entry);
      questionSelect.appendChild(option);
    });

  questionSelect.disabled = trajectoryEntries().length === 0;
  questionSelect.value = state.selectedTrajectoryName || "";
}

function renderTransitionOptions() {
  transitionSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a transition";
  transitionSelect.appendChild(placeholder);

  const options = transitionOptionsForArtifact(state.currentArtifact);
  options.forEach((item) => {
    const option = document.createElement("option");
    option.value = String(item.index);
    option.textContent = item.label;
    transitionSelect.appendChild(option);
  });

  transitionSelect.disabled = options.length === 0;
  transitionSelect.value = state.selectedTransitionIndex == null ? "" : String(state.selectedTransitionIndex);
}

function renderQuestionSummary() {
  const entry = getSelectedTrajectoryEntry();
  if (!entry) {
    questionSummary.innerHTML = '<div class="summary-empty">Select a research question to view its problem statement.</div>';
    return;
  }

  questionSummary.innerHTML = `
    <div>
      <p class="eyebrow">Research Question</p>
      <h2 style="margin: 4px 0 10px;">${escapeHtml(trajectoryLabel(entry))}</h2>
      <p class="detail-value">${escapeHtml(entry.research_problem || "No research problem text available.")}</p>
      <div class="detail-grid" style="margin-top: 16px;">
        ${detailCard("Trajectory", entry.trajectory_name, "mono")}
        ${detailCard("Saved graphs", String(entry.graph_count ?? 0))}
      </div>
    </div>
  `;
}

function renderTransitionSummary() {
  const transition = currentTransition();
  if (!transition) {
    transitionSummary.innerHTML = '<div class="summary-empty">Select a transition to view its revision notes.</div>';
    return;
  }

  const currentError = latestStageError(transition.current);
  transitionSummary.innerHTML = `
    <div>
      <p class="eyebrow">Selected Transition</p>
      <h2 style="margin: 4px 0 10px;">${escapeHtml(`${transition.previous.revision_id} -> ${transition.current.revision_id}`)}</h2>
      <div class="detail-grid" style="margin-bottom: 14px;">
        ${detailCard("Section updated", transition.current.section)}
        ${detailCard("Pass id", transition.current.pass_id == null ? "" : String(transition.current.pass_id))}
      </div>
      ${detailCard("Improvement goal", transition.current.improvement_goal)}
      ${detailCard("Change summary", transition.current.change_summary)}
      ${currentError ? detailCard("Last failed stage", `${currentError.stage}: ${shortText(currentError.message, 260)}`) : ""}
    </div>
  `;
}

function graphStatsText(entry) {
  if (!entry?.graph) return "";
  const nodes = entry.graph.nodes?.length || 0;
  const edges = entry.graph.edges?.length || 0;
  const suffix = entry?.error ? " • partial" : "";
  return `${nodes} nodes • ${edges} edges • revision ${entry.revision_id}${suffix}`;
}

function renderLegend(container, graph) {
  const types = new Set((graph?.nodes || []).map((node) => node.node_type || "other"));
  const orderedTypes = TYPE_ORDER.filter((type) => types.has(type));
  container.innerHTML = orderedTypes.length
    ? orderedTypes.map((type) => `<span class="legend-item"><span class="legend-dot" style="background:${nodeColor(type).fill};"></span>${escapeHtml(type)}</span>`).join("")
    : '<span class="summary-empty">No node types to show.</span>';
}

function renderGraphError(canvas, legend, entry) {
  const stageError = latestStageError(entry);
  const message = stageError
    ? `${stageError.stage}: ${stageError.message}`
    : (entry?.error || "Graph unavailable for this revision.");
  canvas.innerHTML = `<div class="error-box" style="margin: 18px;">${escapeHtml(message)}</div>`;
  legend.innerHTML = '<span class="summary-empty">Graph unavailable for this revision.</span>';
}

function setGraphPanel(panel) {
  const transition = currentTransition();
  const annotations = buildConditionalAnnotations(transition);
  if (panel === "previous") {
    previousGraphTitle.textContent = transition ? `Revision ${transition.previous.revision_id}` : "No transition selected";
    previousGraphStats.textContent = transition ? graphStatsText(transition.previous) : "";
    previousProposalContent.textContent = JSON.stringify(transition?.current?.previous_proposal || {}, null, 2);
    previousGraphCanvas.innerHTML = "";
    if (transition?.previous?.error && !transition?.previous?.graph) {
      renderGraphError(previousGraphCanvas, previousGraphLegend, transition.previous);
      return;
    }
    renderLegend(previousGraphLegend, transition?.previous?.graph);
    if (transition?.previous?.graph) {
      previousGraphCanvas.appendChild(
        renderSvgGraph(
          transition.previous.graph,
          "previous",
          previousGraphCanvas,
          annotations?.previousStatus || null,
        ),
      );
    }
    return;
  }

  currentGraphTitle.textContent = transition ? `Revision ${transition.current.revision_id}` : "No transition selected";
  currentGraphStats.textContent = transition ? graphStatsText(transition.current) : "";
  currentProposalContent.textContent = JSON.stringify(transition?.current?.current_proposal || {}, null, 2);
  currentGraphCanvas.innerHTML = "";
  if (transition?.current?.error && !transition?.current?.graph) {
    renderGraphError(currentGraphCanvas, currentGraphLegend, transition.current);
    return;
  }
  renderLegend(currentGraphLegend, transition?.current?.graph);
  if (transition?.current?.graph) {
    currentGraphCanvas.appendChild(
      renderSvgGraph(
        transition.current.graph,
        "current",
        currentGraphCanvas,
        annotations?.currentStatus || null,
      ),
    );
  }
}

function renderPanels() {
  renderConditionalDiffSummary();
  setGraphPanel("previous");
  setGraphPanel("current");
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

function computeConditionalLayout(graph, annotationMap, side) {
  const statusOrder = side === "previous"
    ? CONDITIONAL_PREVIOUS_STATUS_ORDER
    : CONDITIONAL_CURRENT_STATUS_ORDER;
  const rows = TYPE_ORDER.filter((type) => graph.nodes.some((node) => node.node_type === type));
  const positions = new Map();
  const nodeHeight = 108;
  const nodeWidth = 250;
  const rowGap = 40;
  const groupGap = 52;
  const horizontalGap = 18;
  const topPadding = 44;
  const leftPadding = 140;
  const rowAnchors = [];
  let maxRight = leftPadding;

  rows.forEach((type, rowIndex) => {
    const byStatus = new Map(statusOrder.map((status) => [status, []]));
    graph.nodes
      .filter((node) => node.node_type === type)
      .forEach((node) => {
        const status = annotationMap?.get(node.node_id) || "other";
        if (!byStatus.has(status)) byStatus.set(status, []);
        byStatus.get(status).push(node);
      });

    let x = leftPadding;
    const y = topPadding + rowIndex * (nodeHeight + rowGap);
    rowAnchors.push({ type, y: y + nodeHeight / 2 });

    statusOrder.forEach((status) => {
      const nodes = (byStatus.get(status) || []).slice().sort((a, b) => nodeDisplayText(a).localeCompare(nodeDisplayText(b)));
      nodes.forEach((node, columnIndex) => {
        const nodeX = x + columnIndex * (nodeWidth + horizontalGap);
        positions.set(node.node_id, {
          x: nodeX,
          y,
          width: nodeWidth,
          height: nodeHeight,
        });
        maxRight = Math.max(maxRight, nodeX + nodeWidth);
      });
      if (nodes.length) {
        x += nodes.length * (nodeWidth + horizontalGap) - horizontalGap + groupGap;
      }
    });
  });

  const width = maxRight + leftPadding * 0.5;
  const height = topPadding * 2 + rows.length * nodeHeight + Math.max(0, rows.length - 1) * rowGap;
  return { positions, width, height, rowAnchors };
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

function attachPanZoom(svg, viewport, width, height, canvas) {
  const canvasWidth = canvas.clientWidth || 900;
  const canvasHeight = canvas.clientHeight || 560;
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
  let activePointerId = null;

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
    activePointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    svg.classList.add("is-dragging");
    svg.setPointerCapture(event.pointerId);
  });

  svg.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== activePointerId) return;
    view.x += event.clientX - lastX;
    view.y += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    applyTransform();
  });

  svg.addEventListener("pointerup", (event) => {
    if (event.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    svg.classList.remove("is-dragging");
    if (svg.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
  });

  svg.addEventListener("pointercancel", (event) => {
    if (event.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    svg.classList.remove("is-dragging");
  });
}

function nodeFilterId(side, status) {
  if (side === "previous" && status === "delete") return `deleted-shadow-${side}`;
  if (side === "current" && status === "update") return `updated-shadow-${side}`;
  if (side === "current" && status === "new") return `new-shadow-${side}`;
  return null;
}

function renderSvgGraph(graph, side, canvas, annotationMap = null) {
  const useConditionalLayout = CONFIG.pageKind === "conditional";
  const { positions, width, height, rowAnchors = [] } = useConditionalLayout
    ? computeConditionalLayout(graph, annotationMap, side)
    : computeLayout(graph);
  const svg = createSvgElement("svg", {
    viewBox: `0 0 ${canvas.clientWidth || 1200} ${canvas.clientHeight || 680}`,
    class: "idea-svg",
    preserveAspectRatio: "xMidYMid meet",
  });

  const defs = createSvgElement("defs");
  const markerId = `arrowhead-${side}`;
  const marker = createSvgElement("marker", {
    id: markerId, markerWidth: 10, markerHeight: 7, refX: 9, refY: 3.5, orient: "auto",
  });
  marker.appendChild(createSvgElement("polygon", {
    points: "0 0, 10 3.5, 0 7", fill: "rgba(31, 41, 51, 0.68)",
  }));
  defs.appendChild(marker);

  ["deleted-shadow", "updated-shadow", "new-shadow"].forEach((prefix) => {
    const filter = createSvgElement("filter", {
      id: `${prefix}-${side}`,
      x: "-28%",
      y: "-28%",
      width: "170%",
      height: "190%",
    });
    const color = prefix === "deleted-shadow"
      ? "rgba(209, 73, 91, 0.88)"
      : prefix === "updated-shadow"
        ? "rgba(217, 123, 41, 0.9)"
        : "rgba(58, 153, 84, 0.88)";
    filter.appendChild(createSvgElement("feDropShadow", {
      dx: 0,
      dy: 5,
      stdDeviation: 5,
      "flood-color": color,
      "flood-opacity": 1,
    }));
    filter.appendChild(createSvgElement("feDropShadow", {
      dx: 0,
      dy: 0,
      stdDeviation: 2.4,
      "flood-color": color,
      "flood-opacity": 0.95,
    }));
    defs.appendChild(filter);
  });
  svg.appendChild(defs);

  const viewport = createSvgElement("g");
  const edgeLayer = createSvgElement("g");
  const nodeLayer = createSvgElement("g");
  const guideLayer = createSvgElement("g");

  if (useConditionalLayout) {
    rowAnchors.forEach((row) => {
      const guide = createSvgElement("text", {
        x: 24,
        y: row.y + 4,
        class: "svg-row-label",
      });
      guide.textContent = row.type;
      guideLayer.appendChild(guide);

      const line = createSvgElement("line", {
        x1: 98,
        y1: row.y,
        x2: width - 18,
        y2: row.y,
        class: "svg-row-guide",
      });
      guideLayer.appendChild(line);
    });
  }

  for (const edge of graph.edges) {
    const source = positions.get(edge.source_id);
    const target = positions.get(edge.target_id);
    if (!source || !target) continue;
    const { path, labelX, labelY } = edgeGeometry(source, target);

    const edgeGroup = createSvgElement("g", { class: "svg-edge-group", tabindex: 0 });
    edgeGroup.appendChild(createSvgElement("path", {
      d: path, fill: "none", stroke: "rgba(31, 41, 51, 0.42)", "stroke-width": 2.4, "marker-end": `url(#${markerId})`, class: "svg-edge-path",
    }));
    edgeGroup.appendChild(createSvgElement("path", {
      d: path, fill: "none", stroke: "transparent", "stroke-width": 18,
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

    edgeGroup.addEventListener("click", () => showEdgeDetails(side, graph, edge.edge_id));
    edgeGroup.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showEdgeDetails(side, graph, edge.edge_id);
      }
    });
    edgeLayer.appendChild(edgeGroup);
  }

  for (const node of graph.nodes) {
    const position = positions.get(node.node_id);
    if (!position) continue;
    const colors = nodeColor(node.node_type);
    const status = annotationMap?.get(node.node_id) || "other";
    const filterId = nodeFilterId(side, status);

    const group = createSvgElement("g", {
      class: "svg-node-group",
      transform: `translate(${position.x}, ${position.y})`,
      tabindex: 0,
    });
    group.appendChild(createSvgElement("rect", {
      x: 0, y: 0, rx: 20, ry: 20, width: position.width, height: position.height,
      fill: colors.fill,
      stroke: colors.stroke,
      "stroke-width": 2.5,
      class: "svg-node-rect",
      ...(filterId ? { filter: `url(#${filterId})` } : {}),
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

    group.addEventListener("click", () => showNodeDetails(side, graph, node.node_id));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showNodeDetails(side, graph, node.node_id);
      }
    });
    nodeLayer.appendChild(group);
  }

  viewport.appendChild(guideLayer);
  viewport.appendChild(edgeLayer);
  viewport.appendChild(nodeLayer);
  svg.appendChild(viewport);
  attachPanZoom(svg, viewport, width, height, canvas);
  return svg;
}

function showNodeDetails(side, graph, nodeId) {
  const node = graph?.nodes?.find((item) => item.node_id === nodeId);
  if (!node) return;

  detailsContent.innerHTML = `
    <div class="detail-block">
      <span class="detail-chip">${escapeHtml(side === "previous" ? "Previous graph node" : "Current graph node")}</span>
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

function showEdgeDetails(side, graph, edgeId) {
  const edge = graph?.edges?.find((item) => item.edge_id === edgeId);
  if (!edge) return;
  const source = graph.nodes.find((item) => item.node_id === edge.source_id);
  const target = graph.nodes.find((item) => item.node_id === edge.target_id);

  detailsContent.innerHTML = `
    <div class="detail-block">
      <span class="detail-chip">${escapeHtml(side === "previous" ? "Previous graph edge" : "Current graph edge")}</span>
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

async function loadManifest() {
  const requestedRoot = dataRootInput.value.trim() || DEFAULT_DATA_ROOT;
  setStatus(`Loading manifest from ${requestedRoot}...`);
  const manifest = await loadJsonResource("manifest.json", `${requestedRoot}/manifest.json`);
  state.dataRoot = requestedRoot;
  state.manifest = manifest;
  state.selectedTrajectoryName = "";
  state.selectedTransitionIndex = null;
  state.currentArtifact = null;
  renderTrajectoryOptions();
  renderQuestionSummary();
  renderTransitionOptions();
  renderTransitionSummary();
  renderPanels();
  detailsContent.innerHTML = '<div class="details-empty">Select a transition, then click a node or edge in either graph to inspect it here.</div>';
  setStatus(`Loaded ${trajectoryEntries().length} trajectories from ${requestedRoot}`);

  const firstEntry = trajectoryEntries()
    .slice()
    .sort((a, b) => {
      const questionDelta = parseQuestionNumber(a.trajectory_name) - parseQuestionNumber(b.trajectory_name);
      if (questionDelta !== 0) return questionDelta;
      return String(a.trajectory_name).localeCompare(String(b.trajectory_name));
    })[0];
  if (firstEntry) {
    state.selectedTrajectoryName = firstEntry.trajectory_name;
    renderTrajectoryOptions();
    renderQuestionSummary();
    await loadSelectedTrajectory();
  }
}

async function loadSelectedTrajectory() {
  const entry = getSelectedTrajectoryEntry();
  if (!entry) {
    state.currentArtifact = null;
    state.selectedTransitionIndex = null;
    renderTransitionOptions();
    renderTransitionSummary();
    renderPanels();
    return;
  }

  setStatus(`Loading ${trajectoryLabel(entry)}...`);
  const artifact = await loadJsonResource(artifactRelativePath(entry), artifactFetchPath(entry));
  state.currentArtifact = artifact;
  const options = transitionOptionsForArtifact(artifact);
  state.selectedTransitionIndex = options.length ? options[0].index : null;
  renderTransitionOptions();
  renderTransitionSummary();
  renderPanels();
  detailsContent.innerHTML = '<div class="details-empty">Click a node or edge in either graph to inspect it here. Use scroll to zoom and drag empty space to pan.</div>';
  setStatus(`Loaded ${trajectoryLabel(entry)}`);
}

function toggleFullscreen(element) {
  if (document.fullscreenElement === element) {
    document.exitFullscreen();
    return;
  }
  element.requestFullscreen?.();
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
    await loadManifest();
  } catch (error) {
    if (error?.name !== "AbortError") {
      setStatus("Failed to open directory picker", true);
    }
  }
});

loadDataButton.addEventListener("click", async () => {
  try {
    state.directoryHandle = null;
    await loadManifest();
  } catch (error) {
    setStatus("Failed to load manifest", true);
    questionSummary.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
  }
});

questionSelect.addEventListener("change", async () => {
  state.selectedTrajectoryName = questionSelect.value;
  renderQuestionSummary();
  try {
    await loadSelectedTrajectory();
  } catch (error) {
    setStatus("Failed to load trajectory", true);
    transitionSummary.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
    state.currentArtifact = null;
    renderTransitionOptions();
    renderPanels();
  }
});

transitionSelect.addEventListener("change", () => {
  state.selectedTransitionIndex = transitionSelect.value === "" ? null : Number(transitionSelect.value);
  renderTransitionSummary();
  renderPanels();
  detailsContent.innerHTML = '<div class="details-empty">Click a node or edge in either graph to inspect it here.</div>';
});

graphTextModeSelect.addEventListener("change", () => {
  state.graphTextMode = graphTextModeSelect.value;
  renderPanels();
});

previousFullscreenButton.addEventListener("click", () => toggleFullscreen(previousGraphPanel));
currentFullscreenButton.addEventListener("click", () => toggleFullscreen(currentGraphPanel));
window.addEventListener("resize", () => renderPanels());
document.addEventListener("fullscreenchange", () => renderPanels());

async function initialize() {
  dataRootInput.value = DEFAULT_DATA_ROOT;
  try {
    await loadManifest();
  } catch (error) {
    setStatus("Failed to load manifest", true);
    questionSummary.innerHTML = `
      <div class="error-box">
        Could not load viewer data.<br /><br />
        ${escapeHtml(error.message)}<br /><br />
        Point the viewer at an output directory that contains <span class="mono">manifest.json</span>.
      </div>
    `;
  }
}

initialize();
