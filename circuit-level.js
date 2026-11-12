const canvas = document.getElementById("demCanvas");
const ctx = canvas.getContext("2d");
const ui = {
  schedules: [...document.querySelectorAll('input[name="demSchedule"]')], degreeFilters: [...document.querySelectorAll('input[name="degreeFilter"]')], sceneFilters: [...document.querySelectorAll('input[name="sceneFilter"]')], inspectionRadii: [...document.querySelectorAll('input[name="inspectionRadius"]')],
  distance: document.getElementById("codeDistance"), physicalErrorRate: document.getElementById("physicalErrorRate"), modelSummary: document.getElementById("modelSummary"), focusDetector: document.getElementById("focusDetector"), focusDetectorValue: document.getElementById("focusDetectorValue"), matrixTable: document.getElementById("matrixTable"), matrixScope: document.getElementById("matrixScope"), tooltip: document.getElementById("nodeTooltip"), bpScopeDescription: document.getElementById("bpScopeDescription"), dataProvenance: document.getElementById("dataProvenance"), allVariablesLabel: document.getElementById("allVariablesLabel"),
  runSpeed: document.getElementById("runSpeed"), speedDescription: document.getElementById("speedDescription"), randomErrorCount: document.getElementById("randomErrorCount"), randomErrorCountValue: document.getElementById("randomErrorCountValue"),
  alpha: document.getElementById("demAlpha"), alphaValue: document.getElementById("demAlphaValue"), mechanismIndex: document.getElementById("mechanismIndex"), mechanismIndexValue: document.getElementById("mechanismIndexValue"),
  randomMechanism: document.getElementById("randomMechanism"), nextDegreeOne: document.getElementById("nextDegreeOne"), step: document.getElementById("demStep"), run: document.getElementById("demRun"), reset: document.getElementById("demReset"), clearErrors: document.getElementById("clearErrors"), topView: document.getElementById("topView"), resetView: document.getElementById("resetView"), viewModeLabel: document.getElementById("viewModeLabel"), copy: document.getElementById("copyDemImage"),
  iteration: document.getElementById("demIteration"), unsat: document.getElementById("demUnsat"), status: document.getElementById("demStatus"), selectedVariable: document.getElementById("selectedVariable"), selectedErrorState: document.getElementById("selectedErrorState"), selectedDegree: document.getElementById("selectedDegree"), selectedDetectors: document.getElementById("selectedDetectors"), selectedProbability: document.getElementById("selectedProbability"), selectedPrior: document.getElementById("selectedPrior"), selectedPosterior: document.getElementById("selectedPosterior"), selectedObservable: document.getElementById("selectedObservable"),
  inspectionTitle: document.getElementById("inspectionTitle"), inspectionSummary: document.getElementById("inspectionSummary"), clearInspection: document.getElementById("clearInspection"), contributionTotal: document.getElementById("contributionTotal"), selectedContributions: document.getElementById("selectedContributions"),
};
let model, bp, running = false, runTimer = null, selectedId = 0, focusDetectorId = 0, inspectionDetectorId = null, serialOrder = [], serialCursor = 0, projectedVariables = [], projectedNodes = [];
let activeErrors = new Set();
let viewMode = "angled";
let modelBounds = { minX: 0, maxX: 1, minY: 0, maxY: 1, minT: 0, maxT: 1 };
const camera = { yaw: -0.62, pitch: -0.38, zoom: 1, panX: 0, panY: 5 };
const gesture = { moved: false, x: 0, y: 0, pointers: new Map(), pinchDistance: 0 };
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
function shuffled(items) { const a = [...items]; for (let i = a.length - 1; i; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const schedule = () => ui.schedules.find((input) => input.checked).value;
const sceneFilter = () => ui.sceneFilters.find((input) => input.checked).value;
const inspectionRadius = () => Number(ui.inspectionRadii.find((input) => input.checked).value);
const alpha = () => Number(ui.alpha.value) / 1000;
const edgeKey = (v, d) => `${v}:${d}`;
const reverseEdgeKey = (d, v) => `${d}:${v}`;
const selectedVariable = () => model.variables[selectedId];
function variableProbability(variable) { return variable.probabilities?.[ui.physicalErrorRate.value] ?? variable.probability; }
function variablePriorLlr(variable) { const p = variableProbability(variable); return Math.log((1 - p) / p); }

function currentSyndrome() {
  const syndrome = new Array(model.detectors.length).fill(0);
  for (const variableId of activeErrors) for (const detectorId of model.variables[variableId].detectors) syndrome[detectorId] ^= 1;
  return syndrome;
}
function resetBp() {
  stopRun();
  const vToC = new Map(), cToV = new Map();
  for (const variable of model.variables) for (const detectorId of variable.detectors) { vToC.set(edgeKey(variable.id, detectorId), variablePriorLlr(variable)); cToV.set(reverseEdgeKey(detectorId, variable.id), 0); }
  bp = { iteration: 0, vToC, cToV, posterior: model.variables.map(variablePriorLlr), llrHistory: [] };
  bp.llrHistory.push(bp.posterior.slice());
  serialOrder = shuffled(model.variables.map((v) => v.id)); serialCursor = 0; render();
}
const hardDecision = () => bp.posterior.map((value) => Number(value <= 0));
function estimatedSyndrome(decision = hardDecision()) { return model.detectors.map((detector) => detector.variables.reduce((parity, id) => parity ^ decision[id], 0)); }
function residualSyndrome() { const observed = currentSyndrome(), estimated = estimatedSyndrome(); return observed.map((value, id) => value ^ estimated[id]); }
function checkMessage(detector, targetId) {
  const syndrome = currentSyndrome(); let sign = syndrome[detector.id] ? -1 : 1, magnitude = Infinity;
  for (const id of detector.variables) if (id !== targetId) { const message = bp.vToC.get(edgeKey(id, detector.id)); sign *= message < 0 ? -1 : 1; magnitude = Math.min(magnitude, Math.abs(message)); }
  return alpha() * sign * (Number.isFinite(magnitude) ? magnitude : 0);
}
function refreshPosterior(ids = null) {
  for (const id of ids || model.variables.map((v) => v.id)) { const variable = model.variables[id]; bp.posterior[id] = variable.detectors.reduce((value, d) => value + bp.cToV.get(reverseEdgeKey(d, id)), variablePriorLlr(variable)); }
}
function updateVariableMessages(variable) {
  for (const target of variable.detectors) { let value = variablePriorLlr(variable); for (const d of variable.detectors) if (d !== target) value += bp.cToV.get(reverseEdgeKey(d, variable.id)); bp.vToC.set(edgeKey(variable.id, target), value); }
}
function floodingIteration() {
  const next = new Map(bp.cToV);
  for (const detector of model.detectors) for (const id of detector.variables) next.set(reverseEdgeKey(detector.id, id), checkMessage(detector, id));
  bp.cToV = next; refreshPosterior(); for (const variable of model.variables) updateVariableMessages(variable);
}
function serialIteration() {
  for (const id of serialOrder) { const variable = model.variables[id]; for (const d of variable.detectors) bp.cToV.set(reverseEdgeKey(d, id), checkMessage(model.detectors[d], id)); refreshPosterior([id]); updateVariableMessages(variable); }
  serialOrder = shuffled(model.variables.map((v) => v.id)); serialCursor = 0;
}
function pushHistory() { bp.llrHistory.push(bp.posterior.slice()); if (bp.llrHistory.length > 300) bp.llrHistory.shift(); }
function recordIteration() { bp.iteration += 1; pushHistory(); }
function stepBp() { schedule() === "serial" ? serialIteration() : floodingIteration(); recordIteration(); render(); }
function serialVariableStep() {
  const id = serialOrder[serialCursor], variable = model.variables[id];
  for (const d of variable.detectors) bp.cToV.set(reverseEdgeKey(d, id), checkMessage(model.detectors[d], id));
  refreshPosterior([id]); updateVariableMessages(variable); serialCursor += 1;
  if (serialCursor >= serialOrder.length) { serialOrder = shuffled(model.variables.map((v) => v.id)); serialCursor = 0; recordIteration(); }
}
function stopRun() {
  if (runTimer !== null) window.clearInterval(runTimer);
  runTimer = null; running = false;
  if (ui.run) ui.run.textContent = "連続更新を開始";
}
function runTiming() {
  if (schedule() === "flooding") return { delay: ui.runSpeed.value === "slow" ? 500 : 1, batch: 1 };
  return { delay: 1, batch: ui.runSpeed.value === "slow" ? 1 : 10 };
}
function toggleRun() {
  if (running) { stopRun(); return; }
  running = true; ui.run.textContent = "連続更新を停止";
  const timing = runTiming();
  runTimer = window.setInterval(() => {
    if (schedule() === "flooding") { floodingIteration(); recordIteration(); }
    else { for (let i = 0; i < timing.batch; i += 1) serialVariableStep(); pushHistory(); }
    render();
    if (residualSyndrome().every((v) => v === 0)) stopRun();
  }, timing.delay);
}
function filteredCandidates() { return ui.degreeFilters.find((input) => input.checked).value === "1" ? model.variables.filter((v) => v.degree === 1) : model.variables; }
function weightedRandomVariable() { const candidates = filteredCandidates(), total = candidates.reduce((s, v) => s + variableProbability(v), 0); let cursor = Math.random() * total; for (const v of candidates) { cursor -= variableProbability(v); if (cursor <= 0) return v.id; } return candidates.at(-1).id; }
function selectMechanism(id, reset = true) { selectedId = clamp(Number(id), 0, model.variables.length - 1); ui.mechanismIndex.value = String(selectedId); reset ? resetBp() : render(); }
function setRandomErrors() {
  const count = Math.min(Number(ui.randomErrorCount.value), filteredCandidates().length), ids = new Set();
  while (ids.size < count) ids.add(weightedRandomVariable());
  activeErrors = ids; selectedId = [...ids][0]; ui.mechanismIndex.value = String(selectedId); resetBp();
}
function nextDegreeOne() {
  const ids = model.variables.filter((v) => v.degree === 1).map((v) => v.id), id = ids.find((candidate) => candidate > selectedId) ?? ids[0];
  if (id === undefined) return;
  selectedId = id; activeErrors = new Set([id]); ui.mechanismIndex.value = String(id); resetBp();
}
function toggleError(id) { selectedId = id; ui.mechanismIndex.value = String(id); activeErrors.has(id) ? activeErrors.delete(id) : activeErrors.add(id); resetBp(); }

function focusColumnDetectorIds() {
  const [focusX = 0, focusY = 0] = model.detectors[focusDetectorId].coordinates;
  return model.detectors.filter((detector) => {
    const [x = 0, y = 0] = detector.coordinates;
    return x === focusX && y === focusY;
  }).map((detector) => detector.id);
}
function localVariableIds() {
  if (inspectionDetectorId !== null) {
    const directVariables = new Set(model.detectors[inspectionDetectorId].variables), ids = new Set(directVariables);
    if (inspectionRadius() >= 3) {
      const neighboringChecks = new Set();
      for (const variableId of directVariables) for (const detectorId of model.variables[variableId].detectors) neighboringChecks.add(detectorId);
      for (const detectorId of neighboringChecks) for (const variableId of model.detectors[detectorId].variables) ids.add(variableId);
    }
    ids.add(selectedId); for (const id of activeErrors) ids.add(id);
    return [...ids];
  }
  const ids = new Set();
  for (const detectorId of focusColumnDetectorIds()) {
    for (const variableId of model.detectors[detectorId].variables) ids.add(variableId);
  }
  ids.add(selectedId); for (const id of activeErrors) ids.add(id);
  return [...ids];
}
function visibleVariableIds() {
  if (sceneFilter() === "all") return model.variables.map((v) => v.id);
  if (sceneFilter() === "degree1") return [...new Set([...model.variables.filter((v) => v.degree === 1).map((v) => v.id), selectedId, ...activeErrors])];
  return localVariableIds();
}
function visibleDetectorIds(variableIds) {
  if (sceneFilter() === "all") return model.detectors.map((d) => d.id);
  const ids = new Set([inspectionDetectorId ?? focusDetectorId]);
  if (inspectionDetectorId !== null && inspectionRadius() === 1) return [...ids];
  for (const variableId of variableIds) for (const detectorId of model.variables[variableId].detectors) ids.add(detectorId);
  return [...ids];
}
function detectorWorldPoint(detector) {
  const [x = 0, y = 0, t = 0] = detector.coordinates;
  const nx = (x - modelBounds.minX) / Math.max(1, modelBounds.maxX - modelBounds.minX) - .5;
  const ny = (y - modelBounds.minY) / Math.max(1, modelBounds.maxY - modelBounds.minY) - .5;
  const nt = (t - modelBounds.minT) / Math.max(1, modelBounds.maxT - modelBounds.minT) - .5;
  return { x: nx * 470, y: nt * 430, z: ny * 470 };
}
function variableWorldPoint(variable) {
  const points = variable.detectors.map((id) => detectorWorldPoint(model.detectors[id]));
  const base = points.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y, z: sum.z + p.z }), { x: 0, y: 0, z: 0 }), count = Math.max(1, points.length);
  const center = { x: base.x / count, y: base.y / count, z: base.z / count };
  if (points.length === 1) {
    const length = Math.hypot(center.x, center.z) || 1;
    const offset = 38;
    return { x: center.x + center.x / length * offset, y: center.y, z: center.z + center.z / length * offset };
  }
  // Spatially equivalent mechanisms must share x/z across measurement rounds.
  // Only y carries time; ID-based lane offsets would make vertical worldlines look bent.
  return center;
}
function rotatePoint(point) {
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  const x = point.x * cy - point.z * sy, z = point.x * sy + point.z * cy;
  return { x, y: point.y * cp - z * sp, z: point.y * sp + z * cp };
}
// Orthographic projection keeps the same spatial check position aligned across rounds.
// Perspective made later rounds appear smaller and shifted toward the canvas center.
function project(point, width, height) {
  const p = rotatePoint(point);
  const scale = camera.zoom * Math.min(width / 820, height / 650);
  return { x: width / 2 + camera.panX + p.x * scale, y: height / 2 + camera.panY + p.y * scale, z: p.z, scale };
}
function resizeCanvas() { const rect = canvas.getBoundingClientRect(), ratio = devicePixelRatio || 1, width = Math.max(760, rect.width), height = Math.max(640, rect.height); canvas.width = width * ratio; canvas.height = height * ratio; ctx.setTransform(ratio, 0, 0, ratio, 0, 0); return { width, height }; }
function drawLine(a, b, color, width = 1) { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
function drawTimePlanes(width, height) {
  if (viewMode === "top") {
    const corners = [{ x: -250, y: 0, z: -250 }, { x: 250, y: 0, z: -250 }, { x: 250, y: 0, z: 250 }, { x: -250, y: 0, z: 250 }].map((p) => project(p, width, height));
    ctx.fillStyle = "rgba(41,115,177,.02)"; ctx.strokeStyle = "rgba(47,105,157,.22)"; ctx.beginPath(); corners.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#567087"; ctx.font = "700 13px Inter,system-ui"; ctx.textAlign = "left"; ctx.fillText(`真上：時間座標 ${modelBounds.minT}–${modelBounds.maxT} を重ねて表示`, 34, 92);
    return;
  }
  for (let t = modelBounds.minT; t <= modelBounds.maxT; t += 1) {
    const planeY = ((t - modelBounds.minT) / Math.max(1, modelBounds.maxT - modelBounds.minT) - .5) * 430;
    const corners = [{ x: -250, y: planeY, z: -250 }, { x: 250, y: planeY, z: -250 }, { x: 250, y: planeY, z: 250 }, { x: -250, y: planeY, z: 250 }].map((p) => project(p, width, height));
    ctx.fillStyle = `rgba(41,115,177,${t % 2 ? 0.025 : 0.012})`; ctx.strokeStyle = "rgba(47,105,157,.17)"; ctx.beginPath(); corners.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill(); ctx.stroke();
    const label = project({ x: -270, y: planeY, z: -250 }, width, height); ctx.fillStyle = "#567087"; ctx.font = "700 13px Inter,system-ui"; ctx.textAlign = "left"; ctx.fillText(t === modelBounds.minT ? `初期境界 t=${t}` : `round ${t}`, label.x, label.y);
  }
}

function llrFill(llr) {
  const opacity = Math.min(1, Math.abs(llr) / 8);
  if (Math.abs(llr) < 1e-9) return "rgba(0,0,0,0)";
  return llr < 0 ? `rgba(224,47,67,${opacity})` : `rgba(20,111,209,${opacity})`;
}
function llrStroke(llr, minimumOpacity = .22) {
  const strength = Math.min(1, Math.abs(llr) / 8), base = llr < 0 ? [224, 47, 67] : [20, 111, 209];
  const mix = Math.max(minimumOpacity, strength);
  return `rgb(${Math.round(255 + (base[0] - 255) * mix)},${Math.round(255 + (base[1] - 255) * mix)},${Math.round(255 + (base[2] - 255) * mix)})`;
}
function drawHistory(width, height) {
  const ids = visibleVariableIds(), histories = ids.map((id) => bp.llrHistory.map((state) => state[id]));
  const allValues = histories.flat(), x = 78, y = height - 220, w = width - 132, h = 145, min = Math.min(-1, ...allValues), max = Math.max(1, ...allValues);
  ctx.fillStyle = "rgba(255,255,255,.96)"; ctx.strokeStyle = "#ccd7e2"; ctx.beginPath(); ctx.roundRect(x - 45, y - 34, w + 58, h + 77, 9); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#203246"; ctx.font = "700 13px Inter,system-ui"; ctx.textAlign = "left"; ctx.fillText(`表示中 ${ids.length}変数の事後LLR（選択中 v${selectedId} は太線）`, x - 30, y - 14);
  ctx.font = "600 10px Inter,system-ui"; ctx.fillStyle = "#64758a";
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = max - (max - min) * tick / 4, py = y + h * tick / 4;
    drawLine({ x, y: py }, { x: x + w, y: py }, Math.abs(value) < (max - min) / 8 ? "#9babb9" : "#e1e7ed");
    ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(value.toFixed(1), x - 8, py);
  }
  const finalStep = Math.max(0, bp.llrHistory.length - 1);
  const horizontalTickCount = Math.max(1, Math.min(4, finalStep)), horizontalTickEnd = finalStep ? horizontalTickCount : 0;
  for (let tick = 0; tick <= horizontalTickEnd; tick += 1) {
    const step = finalStep ? Math.round(finalStep * tick / horizontalTickCount) : 0, px = x + w * tick / horizontalTickCount;
    ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(String(step), px, y + h + 7);
  }
  ctx.strokeStyle = "#8293a5"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke();
  ctx.fillStyle = "#526579"; ctx.font = "700 11px Inter,system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillText("更新ステップ", x + w / 2, y + h + 31);
  ctx.save(); ctx.translate(x - 42, y + h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText("事後LLR", 0, 0); ctx.restore();
  ids.forEach((id, seriesIndex) => {
    const values = histories[seriesIndex]; ctx.strokeStyle = llrStroke(values.at(-1), id === selectedId ? .6 : .28); ctx.globalAlpha = id === selectedId ? 1 : .38; ctx.lineWidth = id === selectedId ? 3.2 : 1.1; ctx.beginPath();
    values.forEach((value, i) => { const px = x + i / Math.max(1, values.length - 1) * w, py = y + (max - value) / (max - min) * h; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function draw() {
  const { width, height } = resizeCanvas(), graphHeight = height - 235, observed = currentSyndrome(), residual = residualSyndrome(), decision = hardDecision(), visibleIds = visibleVariableIds(), visibleDetectorIdList = visibleDetectorIds(visibleIds);
  const detectors = new Map(), variables = new Map(); projectedVariables = [];
  projectedNodes = [];
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height); drawTimePlanes(width, graphHeight);
  visibleDetectorIdList.forEach((id) => detectors.set(id, project(detectorWorldPoint(model.detectors[id]), width, graphHeight))); visibleIds.forEach((id) => variables.set(id, project(variableWorldPoint(model.variables[id]), width, graphHeight)));
  const detectorColumns = new Map();
  for (const id of visibleDetectorIdList) {
    const coordinates = model.detectors[id].coordinates;
    const key = `${coordinates[0] ?? 0}:${coordinates[1] ?? 0}`;
    if (!detectorColumns.has(key)) detectorColumns.set(key, []);
    detectorColumns.get(key).push(id);
  }
  ctx.save();
  ctx.setLineDash([5, 7]);
  for (const ids of detectorColumns.values()) {
    ids.sort((a, b) => (model.detectors[a].coordinates[2] ?? 0) - (model.detectors[b].coordinates[2] ?? 0));
    if (ids.length > 1) drawLine(detectors.get(ids[0]), detectors.get(ids.at(-1)), "rgba(42,112,174,.26)", 2);
  }
  ctx.restore();
  const edges = []; for (const id of visibleIds) for (const d of model.variables[id].detectors) if (detectors.has(d)) edges.push({ id, d, depth: (variables.get(id).z + detectors.get(d).z) / 2 }); edges.sort((a, b) => a.depth - b.depth);
  for (const edge of edges) {
    const inspecting = inspectionDetectorId !== null, value = inspecting ? bp.cToV.get(reverseEdgeKey(edge.d, edge.id)) : bp.posterior[edge.id], hot = edge.d === inspectionDetectorId || edge.id === selectedId || activeErrors.has(edge.id);
    drawLine(variables.get(edge.id), detectors.get(edge.d), llrStroke(value), hot ? 5.8 : 2.2 + Math.min(2, Math.abs(value) / 8));
  }
  const nodes = []; visibleDetectorIdList.forEach((id) => nodes.push({ type: "d", id, p: detectors.get(id) })); visibleIds.forEach((id) => nodes.push({ type: "v", id, p: variables.get(id) })); nodes.sort((a, b) => a.p.z - b.p.z);
  for (const node of nodes) {
    const s = clamp(node.p.scale, .6, 1.55);
    if (node.type === "d") {
      const fired = Boolean(observed[node.id]), unsat = Boolean(residual[node.id]), focused = node.id === focusDetectorId;
      const roundCoordinate = model.detectors[node.id].coordinates[2] ?? 0;
      const ringOffset = viewMode === "top" ? (modelBounds.maxT - roundCoordinate) * 2.5 : 0;
      const r = (fired || unsat || focused ? 12 : 9) * s + ringOffset;
      ctx.fillStyle = fired ? "#05070a" : "#ffffff"; ctx.strokeStyle = unsat ? "#e02f43" : focused ? "#e0a82e" : "#8ea2b5"; ctx.lineWidth = unsat ? 5 : focused ? 4 : 3; ctx.beginPath(); ctx.arc(node.p.x, node.p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (node.id === inspectionDetectorId) { ctx.strokeStyle = "#e0a82e"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(node.p.x, node.p.y, r + 6, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = fired ? "#ffffff" : "#33485c"; ctx.font = "800 11px Inter,system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(fired ? "1" : "0", node.p.x, node.p.y);
      projectedNodes.push({ type: "detector", id: node.id, x: node.p.x, y: node.p.y, radius: Math.max(11, r + 3), z: node.p.z });
    } else {
      const variable = model.variables[node.id], selected = node.id === selectedId, error = activeErrors.has(node.id), estimatedError = Boolean(decision[node.id]), uncertain = Math.abs(bp.posterior[node.id]) < .5, r = (selected ? 12 : error ? 10 : 7) * s;
      ctx.fillStyle = error ? "#e02f43" : estimatedError ? "#8a55b5" : "#4d9bd3"; ctx.strokeStyle = selected ? "#e0a82e" : error && !estimatedError ? "#146fd1" : error ? "#ad2638" : variable.degree === 1 ? "#218b69" : "#365b7c"; ctx.lineWidth = selected || (error && !estimatedError) ? 4 : variable.degree === 1 ? 2.5 : 2; ctx.beginPath(); ctx.arc(node.p.x, node.p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (uncertain) { ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = "#e0a82e"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(node.p.x, node.p.y, r + 5, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
      if (selected || error) { ctx.fillStyle = "#203246"; ctx.font = "800 11px Inter,system-ui"; ctx.textAlign = "left"; ctx.fillText(`v${node.id}${error ? "  error" : ""}`, node.p.x + r + 6, node.p.y); }
      projectedVariables.push({ id: node.id, x: node.p.x, y: node.p.y, radius: Math.max(10, r + 4), z: node.p.z });
      projectedNodes.push({ type: "variable", id: node.id, x: node.p.x, y: node.p.y, radius: Math.max(10, r + 4), z: node.p.z });
    }
  }
  drawHistory(width, height);
}
function updateLabels() {
  const variable = selectedVariable(), residualWeight = residualSyndrome().reduce((s, v) => s + v, 0), isError = activeErrors.has(selectedId);
  ui.alphaValue.value = alpha().toFixed(3); ui.mechanismIndexValue.value = `v${selectedId}`; ui.focusDetectorValue.value = `D${focusDetectorId}`; ui.randomErrorCountValue.value = ui.randomErrorCount.value; ui.iteration.textContent = `iteration ${bp.iteration}`; ui.unsat.textContent = `残差 ${residualWeight}`; ui.status.textContent = activeErrors.size ? `誤り ${activeErrors.size}個` : "誤りなし"; ui.selectedVariable.textContent = `v${selectedId}`; ui.selectedErrorState.textContent = isError ? "ON" : "OFF"; ui.selectedErrorState.classList.toggle("errorOn", isError); ui.selectedDegree.textContent = variable.degree; ui.selectedDetectors.textContent = variable.detectors.map((id) => `D${id}`).join(", "); ui.selectedProbability.textContent = variableProbability(variable).toExponential(3); ui.selectedPrior.textContent = variablePriorLlr(variable).toFixed(3); ui.selectedPosterior.textContent = bp.posterior[selectedId].toFixed(3); ui.selectedObservable.textContent = variable.observables.length ? variable.observables.map((id) => `L${id}`).join(", ") : "なし";
  ui.speedDescription.textContent = schedule() === "flooding" ? `Flooding: ${ui.runSpeed.value === "slow" ? "500 ms" : "1 ms"} / 反復` : `Serial random: ${ui.runSpeed.value === "slow" ? "1 ms" : "0.1 ms相当"} / 変数更新`;
  ui.modelSummary.textContent = `d=${model.metadata.distance} · ${model.metadata.rounds} rounds · SI1000 p=${ui.physicalErrorRate.value} · H: ${model.metadata.numDetectors} × ${model.metadata.numVariables}`;
  ui.bpScopeDescription.textContent = `${model.metadata.numVariables}候補と${model.metadata.numDetectors}制約を全H行列で更新`;
  ui.allVariablesLabel.textContent = `全${model.metadata.numVariables}変数`;
  ui.dataProvenance.textContent = `Chromobius/Clorcoでd=${model.metadata.distance}、${model.metadata.rounds}ラウンドのSuperdense回路へSI1000を適用し、Stim DEMを非分解・重複統合して生成しています。`;
  if (inspectionDetectorId === null) {
    ui.inspectionTitle.textContent = "検査ノードをクリックして原因追跡"; ui.inspectionSummary.textContent = "赤枠の未充足検査をクリックすると、その検査を起点に周辺構造を表示します。"; ui.clearInspection.disabled = true;
  } else {
    const detector = model.detectors[inspectionDetectorId], observed = currentSyndrome()[inspectionDetectorId], residual = residualSyndrome()[inspectionDetectorId];
    ui.inspectionTitle.textContent = `D${inspectionDetectorId} から半径${inspectionRadius()}を表示`; ui.inspectionSummary.textContent = `syndrome ${observed}・BP残差 ${residual}・直接隣接 ${detector.variables.length}変数。エッジ色と太さは検査→変数メッセージを表します。`; ui.clearInspection.disabled = false;
  }
}
function renderContributions() {
  const variable = selectedVariable(), prior = variablePriorLlr(variable), messages = variable.detectors.map((detectorId) => ({ detectorId, value: bp.cToV.get(reverseEdgeKey(detectorId, selectedId)) ?? 0 })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  ui.contributionTotal.textContent = `合計 ${bp.posterior[selectedId].toFixed(3)}`;
  ui.selectedContributions.innerHTML = `<div class="contributionItem"><span>事前LLR</span><strong>${prior >= 0 ? "+" : ""}${prior.toFixed(3)}</strong></div>${messages.map(({ detectorId, value }) => `<div class="contributionItem ${value < 0 ? "negative" : "positive"}"><span>D${detectorId} → v${selectedId}</span><strong>${value >= 0 ? "+" : ""}${value.toFixed(3)}</strong></div>`).join("")}`;
}
function renderMatrix() {
  const visibleVariables = visibleVariableIds();
  const columnIds = [selectedId, ...visibleVariables.filter((id) => id !== selectedId)].slice(0, 12);
  const rowIds = [focusDetectorId, ...visibleDetectorIds(columnIds).filter((id) => id !== focusDetectorId)].slice(0, 9);
  ui.matrixTable.style.setProperty("--matrix-cols", columnIds.length);
  const header = `<div class="matrixRow"><span class="matrixCell">H</span>${columnIds.map((id) => `<span class="matrixCell ${id === selectedId ? "selected" : ""}">v${id}</span>`).join("")}</div>`;
  const rows = rowIds.map((detectorId) => {
    const connected = new Set(model.detectors[detectorId].variables);
    return `<div class="matrixRow"><span class="matrixCell">D${detectorId}</span>${columnIds.map((id) => `<span class="matrixCell ${connected.has(id) ? "one" : ""} ${id === selectedId ? "selected" : ""}">${connected.has(id) ? 1 : 0}</span>`).join("")}</div>`;
  }).join("");
  ui.matrixTable.innerHTML = header + rows;
  ui.matrixScope.textContent = `表示 ${rowIds.length}/${visibleDetectorIds(visibleVariables).length}行 × ${columnIds.length}/${visibleVariables.length}列`;
}
function render() { updateLabels(); draw(); renderMatrix(); renderContributions(); }
function resetCamera() { viewMode = "angled"; Object.assign(camera, { yaw: -.62, pitch: -.38, zoom: 1, panX: 0, panY: 5 }); ui.viewModeLabel.textContent = "斜め3D表示"; render(); }
function setTopView() { viewMode = "top"; Object.assign(camera, { yaw: 0, pitch: Math.PI / 2, zoom: 1, panX: 0, panY: 5 }); ui.viewModeLabel.textContent = `真上表示：時間座標 ${modelBounds.minT}–${modelBounds.maxT} を重ね合わせ`; render(); }
function canvasPoint(event) { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
function hitVariable(x, y) { return [...projectedVariables].sort((a, b) => a.z - b.z).find((p) => Math.hypot(x - p.x, y - p.y) <= p.radius)?.id; }
function hitNode(x, y) { return [...projectedNodes].sort((a, b) => a.z - b.z).find((p) => Math.hypot(x - p.x, y - p.y) <= p.radius); }
function pointerDistance() { const p = [...gesture.pointers.values()]; return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
function showTooltip(event) {
  if (gesture.pointers.size) return;
  const p = canvasPoint(event);
  const node = [...projectedNodes].sort((a, b) => a.z - b.z).find((item) => Math.hypot(p.x - item.x, p.y - item.y) <= item.radius);
  if (!node) { ui.tooltip.style.display = "none"; return; }
  if (node.type === "variable") {
    const variable = model.variables[node.id];
    ui.tooltip.innerHTML = `<strong>DEM変数 v${node.id}</strong><br>次数 ${variable.degree} · LLR ${bp.posterior[node.id].toFixed(3)}<br>接続 ${variable.detectors.map((id) => `D${id}`).join(", ")}<br>クリックで誤りをON/OFF`;
  } else {
    const detector = model.detectors[node.id], syndrome = currentSyndrome()[node.id], residual = residualSyndrome()[node.id];
    ui.tooltip.innerHTML = `<strong>検査ノード D${node.id}</strong><br>次数 ${detector.degree} · syndrome ${syndrome}<br>BP残差 ${residual} · 座標 (${detector.coordinates.join(", ")})`;
  }
  ui.tooltip.style.display = "block";
  ui.tooltip.style.left = `${clamp(p.x + 15, 8, canvas.clientWidth - 270)}px`;
  ui.tooltip.style.top = `${clamp(p.y + 15, 52, canvas.clientHeight - 110)}px`;
}
canvas.addEventListener("pointerdown", (event) => { canvas.setPointerCapture(event.pointerId); const p = canvasPoint(event); gesture.pointers.set(event.pointerId, p); gesture.moved = false; gesture.x = p.x; gesture.y = p.y; gesture.pinchDistance = pointerDistance(); canvas.classList.add("dragging"); });
canvas.addEventListener("pointermove", (event) => { if (!gesture.pointers.has(event.pointerId)) return; const p = canvasPoint(event); gesture.pointers.set(event.pointerId, p); if (gesture.pointers.size >= 2) { const d = pointerDistance(); if (gesture.pinchDistance) camera.zoom = clamp(camera.zoom * d / gesture.pinchDistance, .48, 2.6); gesture.pinchDistance = d; gesture.moved = true; render(); return; } const dx = p.x - gesture.x, dy = p.y - gesture.y; if (Math.hypot(dx, dy) > 2) gesture.moved = true; camera.yaw += dx * .008; camera.pitch = clamp(camera.pitch + dy * .008, -1.35, 1.35); gesture.x = p.x; gesture.y = p.y; render(); });
function endPointer(event) { const p = canvasPoint(event); if (!gesture.moved && gesture.pointers.size === 1) { const node = hitNode(p.x, p.y); if (node?.type === "variable") toggleError(node.id); else if (node?.type === "detector") { inspectionDetectorId = node.id; ui.sceneFilters.find((input) => input.value === "local").checked = true; render(); } } gesture.pointers.delete(event.pointerId); gesture.pinchDistance = pointerDistance(); if (!gesture.pointers.size) canvas.classList.remove("dragging"); }
canvas.addEventListener("pointerup", endPointer); canvas.addEventListener("pointercancel", endPointer); canvas.addEventListener("wheel", (event) => { event.preventDefault(); camera.zoom = clamp(camera.zoom * Math.exp(-event.deltaY * .0012), .48, 2.6); render(); }, { passive: false });
canvas.addEventListener("mousemove", showTooltip);
canvas.addEventListener("mouseleave", () => { ui.tooltip.style.display = "none"; });
async function copyImage() { render(); try { const blob = await new Promise((resolve, reject) => canvas.toBlob((v) => v ? resolve(v) : reject(new Error("PNG生成失敗")), "image/png")); await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); ui.copy.textContent = "コピーしました"; } catch (error) { console.error(error); ui.copy.textContent = "コピーできませんでした"; } setTimeout(() => { ui.copy.textContent = "図とLLRをコピー"; }, 1500); }
async function loadModel(distance) {
  stopRun();
  ui.status.textContent = "読込中";
  const response = await fetch(`circuit-level-data-d${distance}.json`); if (!response.ok) throw new Error(`DEMデータを読み込めませんでした: ${response.status}`); model = await response.json();
  const coordinates = model.detectors.map((d) => d.coordinates);
  modelBounds = { minX: Math.min(...coordinates.map((c) => c[0] ?? 0)), maxX: Math.max(...coordinates.map((c) => c[0] ?? 0)), minY: Math.min(...coordinates.map((c) => c[1] ?? 0)), maxY: Math.max(...coordinates.map((c) => c[1] ?? 0)), minT: Math.min(...coordinates.map((c) => c[2] ?? 0)), maxT: Math.max(...coordinates.map((c) => c[2] ?? 0)) };
  focusDetectorId = 0; inspectionDetectorId = null; ui.focusDetector.max = String(model.detectors.length - 1); ui.focusDetector.value = "0";
  selectedId = model.detectors[0].variables[0] ?? 0; activeErrors = new Set([selectedId]); ui.mechanismIndex.max = String(model.variables.length - 1); ui.mechanismIndex.value = String(selectedId); viewMode = "angled"; ui.viewModeLabel.textContent = "斜め3D表示"; Object.assign(camera, { yaw: -.62, pitch: -.38, zoom: 1, panX: 0, panY: 5 }); resetBp();
}
async function start() {
  await loadModel(ui.distance.value);
  ui.distance.addEventListener("change", () => loadModel(ui.distance.value)); ui.physicalErrorRate.addEventListener("change", resetBp); ui.focusDetector.addEventListener("input", () => { focusDetectorId = Number(ui.focusDetector.value); inspectionDetectorId = null; const candidate = model.detectors[focusDetectorId].variables[0]; if (candidate !== undefined) selectedId = candidate; ui.mechanismIndex.value = String(selectedId); resetBp(); });
  ui.mechanismIndex.addEventListener("input", () => selectMechanism(ui.mechanismIndex.value)); ui.randomMechanism.addEventListener("click", setRandomErrors); ui.randomErrorCount.addEventListener("input", render); ui.nextDegreeOne.addEventListener("click", nextDegreeOne); ui.step.addEventListener("click", stepBp); ui.run.addEventListener("click", toggleRun); ui.runSpeed.addEventListener("change", () => { const wasRunning = running; stopRun(); render(); if (wasRunning) toggleRun(); }); ui.reset.addEventListener("click", resetBp); ui.clearErrors.addEventListener("click", () => { activeErrors.clear(); resetBp(); }); ui.clearInspection.addEventListener("click", () => { inspectionDetectorId = null; render(); }); ui.topView.addEventListener("click", setTopView); ui.resetView.addEventListener("click", resetCamera); ui.copy.addEventListener("click", copyImage); ui.alpha.addEventListener("input", resetBp); for (const input of ui.schedules) input.addEventListener("change", resetBp); for (const input of ui.sceneFilters) input.addEventListener("change", render); for (const input of ui.inspectionRadii) input.addEventListener("change", render); for (const input of ui.degreeFilters) input.addEventListener("change", () => { if (input.checked && input.value === "1" && selectedVariable().degree !== 1) nextDegreeOne(); }); window.addEventListener("resize", render);
}
start().catch((error) => { console.error(error); ui.status.textContent = "読込エラー"; });
