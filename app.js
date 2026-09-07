const canvas = document.getElementById("bpCanvas");
const ctx = canvas.getContext("2d");

const ui = {
  scheduleModes: [...document.querySelectorAll('input[name="scheduleMode"]')],
  serialOrderModes: [...document.querySelectorAll('input[name="serialOrderMode"]')],
  serialSpeedModes: [...document.querySelectorAll('input[name="serialSpeed"]')],
  serialOrderGroup: document.getElementById("serialOrderGroup"),
  serialOrderValue: document.getElementById("serialOrderValue"),
  codeModes: [...document.querySelectorAll('input[name="codeMode"]')],
  modeDescription: document.getElementById("modeDescription"),
  sizeLabel: document.getElementById("sizeLabel"),
  distance: document.getElementById("distance"),
  distanceValue: document.getElementById("distanceValue"),
  errorRate: document.getElementById("errorRate"),
  errorRateValue: document.getElementById("errorRateValue"),
  damping: document.getElementById("damping"),
  dampingValue: document.getElementById("dampingValue"),
  boundaryGroup: document.getElementById("boundaryGroup"),
  boundaryModes: [...document.querySelectorAll('input[name="boundaryMode"]')],
  stepButton: document.getElementById("stepButton"),
  runButton: document.getElementById("runButton"),
  resetButton: document.getElementById("resetButton"),
  newButton: document.getElementById("newButton"),
  truthToggle: document.getElementById("truthToggle"),
  phaseLabel: document.getElementById("phaseLabel"),
  iterationLabel: document.getElementById("iterationLabel"),
  unsatLabel: document.getElementById("unsatLabel"),
  estimateCount: document.getElementById("estimateCount"),
  truthCount: document.getElementById("truthCount"),
  matchLabel: document.getElementById("matchLabel"),
  colorLegend: document.getElementById("colorLegend"),
};

let code;
let bp;
let layout;
let hoveredVariable = null;
let running = false;
let timer = 0;

const COLOR_CHECKS = ["#d94b55", "#2fa66c", "#2b7bd8"];
const SQRT3_OVER_2 = Math.sqrt(3) / 2;

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function logisticColor(llr) {
  const x = clamp(llr / 6, -1, 1);
  const white = [247, 247, 247];
  const red = [202, 0, 32];
  const blue = [5, 113, 176];
  const target = x < 0 ? red : blue;
  const t = Math.abs(x) ** 0.55;
  const rgb = white.map((n, i) => Math.round(n + (target[i] - n) * t));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function currentMode() {
  return ui.codeModes.find((input) => input.checked).value;
}

function currentSchedule() {
  return ui.scheduleModes.find((input) => input.checked).value;
}

function currentSerialOrderMode() {
  return ui.serialOrderModes.find((input) => input.checked).value;
}

function currentSerialDelay() {
  return Number(ui.serialSpeedModes.find((input) => input.checked).value);
}

function createSerialOrder(variableCount) {
  const order = Array.from({ length: variableCount }, (_, id) => id);
  const mode = currentSerialOrderMode();
  if (mode === "reverse") return order.reverse();
  if (mode === "random") return shuffled(order);
  return order;
}

function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createSurfaceCode(size, p) {
  const checks = [];
  const variables = [];
  const boundaryMode = ui.boundaryModes.find((input) => input.checked).value;

  function checkAt(x, y) {
    return checks[y * size + x];
  }

  function addBond(kind, x, y, endpointA, endpointB) {
    const variable = {
      id: variables.length,
      kind,
      x,
      y,
      checks: [endpointA, endpointB],
      error: Math.random() < p ? 1 : 0,
    };
    variables.push(variable);
    endpointA.variables.push(variable);
    endpointB.variables.push(variable);
    return variable;
  }

  function addBoundaryBond(kind, x, y, endpoint) {
    const variable = {
      id: variables.length,
      kind,
      x,
      y,
      checks: [endpoint],
      boundary: true,
      error: Math.random() < p ? 1 : 0,
    };
    variables.push(variable);
    endpoint.variables.push(variable);
    return variable;
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      checks.push({ id: checks.length, x, y, variables: [], syndrome: 0 });
    }
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      addBond("h", x, y, checkAt(x, y), checkAt(x + 1, y));
    }
  }
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size; x += 1) {
      addBond("v", x, y, checkAt(x, y), checkAt(x, y + 1));
    }
  }

  if (boundaryMode === "vertical") {
    for (let y = 0; y < size; y += 1) {
      addBoundaryBond("left", 0, y, checkAt(0, y));
      addBoundaryBond("right", size - 1, y, checkAt(size - 1, y));
    }
  } else {
    for (let x = 0; x < size; x += 1) {
      addBoundaryBond("top", x, 0, checkAt(x, 0));
      addBoundaryBond("bottom", x, size - 1, checkAt(x, size - 1));
    }
  }

  for (const check of checks) {
    check.syndrome = check.variables.reduce((sum, variable) => sum ^ variable.error, 0);
  }

  return { type: "surface", size, checks, variables };
}

function colorPoint(row, column) {
  return { x: column - row / 2, y: row * SQRT3_OVER_2 };
}

function isColorPlaquette(row, column) {
  return ((column % 3) + 3) % 3 === (2 - (row % 3) + 3) % 3;
}

function createColorCode(requestedDistance, p) {
  const distance = requestedDistance % 2 === 0 ? requestedDistance - 1 : requestedDistance;
  const bound = (3 * (distance - 1)) / 2;
  const variables = [];
  const variableMap = new Map();
  const checks = [];
  const idFor = (row, column) => `${row},${column}`;

  for (let row = 0; row <= bound; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      if (isColorPlaquette(row, column)) continue;
      const variable = {
        id: variables.length,
        row,
        column,
        raw: colorPoint(row, column),
        checks: [],
        error: Math.random() < p ? 1 : 0,
      };
      variables.push(variable);
      variableMap.set(idFor(row, column), variable);
    }
  }

  const neighbors = [
    [-1, -1], [-1, 0], [0, -1], [0, 1], [1, 0], [1, 1],
  ];
  for (let row = 0; row <= bound; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      if (!isColorPlaquette(row, column)) continue;
      const check = {
        id: checks.length,
        row,
        column,
        raw: colorPoint(row, column),
        colorIndex: row % 3,
        variables: neighbors
          .map(([dr, dc]) => variableMap.get(idFor(row + dr, column + dc)))
          .filter(Boolean),
        syndrome: 0,
      };
      checks.push(check);
      for (const variable of check.variables) variable.checks.push(check);
    }
  }

  for (const check of checks) {
    check.syndrome = check.variables.reduce((sum, variable) => sum ^ variable.error, 0);
  }

  return { type: "color", size: distance, distance, bound, checks, variables };
}

function createLdpcCode(scale, p) {
  const variableCount = scale * 8;
  const variableDegree = 3;
  const checkDegree = 6;
  const checkCount = Math.floor((variableCount * variableDegree) / checkDegree);
  const checks = Array.from({ length: checkCount }, (_, id) => ({
    id,
    variables: [],
    syndrome: 0,
  }));
  const variables = Array.from({ length: variableCount }, (_, id) => ({
    id,
    checks: [],
    error: Math.random() < p ? 1 : 0,
  }));

  for (const variable of variables) {
    const candidates = shuffled(checks)
      .sort((a, b) => a.variables.length - b.variables.length)
      .slice(0, variableDegree);
    for (const check of candidates) {
      variable.checks.push(check);
      check.variables.push(variable);
    }
  }

  for (const check of checks) {
    check.syndrome = check.variables.reduce((sum, variable) => sum ^ variable.error, 0);
  }

  return {
    type: "ldpc",
    size: scale,
    variableDegree,
    checkDegree,
    checks,
    variables,
  };
}

function createBb144Code(p) {
  const lx = 12;
  const ly = 6;
  const block = lx * ly;
  const checks = Array.from({ length: block }, (_, id) => ({
    id,
    x: id % lx,
    y: Math.floor(id / lx),
    variables: [],
    syndrome: 0,
  }));
  const variables = Array.from({ length: block * 2 }, (_, id) => ({
    id,
    x: id % block % lx,
    y: Math.floor((id % block) / lx),
    checks: [],
    error: Math.random() < p ? 1 : 0,
    block: id < block ? "A" : "B",
  }));

  function index(x, y) {
    return ((y + ly) % ly) * lx + ((x + lx) % lx);
  }

  function connect(check, variable) {
    if (check.variables.includes(variable)) return;
    check.variables.push(variable);
    variable.checks.push(check);
  }

  const aShifts = [
    [3, 0],
    [0, 1],
    [0, 2],
  ];
  const bShifts = [
    [0, 3],
    [1, 0],
    [2, 0],
  ];

  for (let y = 0; y < ly; y += 1) {
    for (let x = 0; x < lx; x += 1) {
      const check = checks[index(x, y)];
      for (const [dx, dy] of aShifts) {
        connect(check, variables[index(x + dx, y + dy)]);
      }
      for (const [dx, dy] of bShifts) {
        connect(check, variables[block + index(x + dx, y + dy)]);
      }
    }
  }

  for (const check of checks) {
    check.syndrome = check.variables.reduce((sum, variable) => sum ^ variable.error, 0);
  }

  return {
    type: "bb144",
    size: 144,
    label: "BB [[144,12,12]]",
    lx,
    ly,
    variableDegree: 3,
    checkDegree: 6,
    checks,
    variables,
  };
}

function createBpState(surfaceCode, p) {
  const prior = Math.log((1 - p) / p);
  const vToC = new Map();
  const cToV = new Map();
  for (const variable of surfaceCode.variables) {
    for (const check of variable.checks) {
      vToC.set(`${variable.id}:${check.id}`, prior);
      cToV.set(`${check.id}:${variable.id}`, 0);
    }
  }
  return {
    prior,
    vToC,
    cToV,
    posterior: new Array(surfaceCode.variables.length).fill(prior),
    history: [new Array(surfaceCode.variables.length).fill(prior)],
    iteration: 0,
    stepCount: 0,
    halfStep: 0,
    active: null,
    serialIndex: 0,
    serialOrder: createSerialOrder(surfaceCode.variables.length),
    activeVariableId: null,
  };
}

function atanhSafe(x) {
  return 0.5 * Math.log((1 + clamp(x, -0.999999, 0.999999)) / (1 - clamp(x, -0.999999, 0.999999)));
}

function updatePosterior() {
  for (const variable of code.variables) {
    let value = bp.prior;
    for (const check of variable.checks) {
      value += bp.cToV.get(`${check.id}:${variable.id}`);
    }
    bp.posterior[variable.id] = value;
  }
}

function stepChecks() {
  const damping = Number(ui.damping.value) / 100;
  for (const check of code.checks) {
    for (const target of check.variables) {
      let product = check.syndrome ? -1 : 1;
      for (const variable of check.variables) {
        if (variable.id === target.id) continue;
        product *= Math.tanh(bp.vToC.get(`${variable.id}:${check.id}`) / 2);
      }
      const key = `${check.id}:${target.id}`;
      const previous = bp.cToV.get(key);
      const next = 2 * atanhSafe(product);
      bp.cToV.set(key, previous * damping + next * (1 - damping));
    }
  }
  bp.halfStep = 1;
  bp.active = "checks";
  updatePosterior();
}

function stepVariables() {
  const damping = Number(ui.damping.value) / 100;
  for (const variable of code.variables) {
    for (const target of variable.checks) {
      let value = bp.prior;
      for (const check of variable.checks) {
        if (check.id === target.id) continue;
        value += bp.cToV.get(`${check.id}:${variable.id}`);
      }
      const key = `${variable.id}:${target.id}`;
      const previous = bp.vToC.get(key);
      bp.vToC.set(key, previous * damping + value * (1 - damping));
    }
  }
  bp.halfStep = 0;
  bp.iteration += 1;
  bp.active = "variables";
  updatePosterior();
}

function checkMessage(check, target) {
  let product = check.syndrome ? -1 : 1;
  for (const variable of check.variables) {
    if (variable.id === target.id) continue;
    product *= Math.tanh(bp.vToC.get(`${variable.id}:${check.id}`) / 2);
  }
  return 2 * atanhSafe(product);
}

function variableMessage(variable, target) {
  let value = bp.prior;
  for (const check of variable.checks) {
    if (check.id === target.id) continue;
    value += bp.cToV.get(`${check.id}:${variable.id}`);
  }
  return value;
}

function stepSerialVariable() {
  const damping = Number(ui.damping.value) / 100;
  const variableId = bp.serialOrder[bp.serialIndex];
  const variable = code.variables[variableId];

  // Gauss-Seidel型のVN逐次更新。先に処理したVNの新しいv->cを、
  // 同じスイープ内で後続VNのc->v計算にそのまま利用する。
  for (const check of variable.checks) {
    const key = `${check.id}:${variable.id}`;
    const previous = bp.cToV.get(key);
    const next = checkMessage(check, variable);
    bp.cToV.set(key, previous * damping + next * (1 - damping));
  }

  let posterior = bp.prior;
  for (const check of variable.checks) {
    posterior += bp.cToV.get(`${check.id}:${variable.id}`);
  }
  bp.posterior[variable.id] = posterior;

  for (const check of variable.checks) {
    const key = `${variable.id}:${check.id}`;
    const previous = bp.vToC.get(key);
    const next = variableMessage(variable, check);
    bp.vToC.set(key, previous * damping + next * (1 - damping));
  }

  bp.active = "serial";
  bp.activeVariableId = variable.id;
  bp.serialIndex += 1;
  if (bp.serialIndex >= code.variables.length) {
    bp.serialIndex = 0;
    bp.iteration += 1;
  }
}

function bpStep() {
  if (currentSchedule() === "serial") {
    stepSerialVariable();
  } else if (bp.halfStep === 0) {
    bp.activeVariableId = null;
    stepChecks();
  } else {
    stepVariables();
  }
  bp.stepCount += 1;
  bp.history.push([...bp.posterior]);
  if (bp.history.length > 80) bp.history.shift();
  render();
}

function estimateErrors() {
  return code.variables.map((variable) => (bp.posterior[variable.id] < 0 ? 1 : 0));
}

function estimateSyndrome(estimate) {
  return code.checks.map((check) =>
    check.variables.reduce((sum, variable) => sum ^ estimate[variable.id], 0),
  );
}

function updateLabels() {
  const p = Number(ui.errorRate.value) / 100;
  const schedule = currentSchedule();
  ui.serialOrderGroup.hidden = schedule !== "serial";
  ui.colorLegend.hidden = code.type !== "color";
  ui.colorLegend.style.display = code.type === "color" ? "flex" : "none";
  ui.serialOrderValue.value = bp.serialOrder.map((id) => `v${id}`).join(" → ");
  if (code.type === "surface") {
    ui.sizeLabel.textContent = "格子サイズ";
    ui.distanceValue.value = `${ui.distance.value} x ${ui.distance.value}`;
    ui.modeDescription.textContent = `planar surface code: Zエラー / Xシンドローム · ${schedule === "serial" ? "serial" : "flooding"} schedule`;
    ui.boundaryGroup.hidden = false;
    ui.boundaryGroup.style.display = "grid";
  } else if (code.type === "color") {
    ui.sizeLabel.textContent = "符号距離";
    ui.distanceValue.value = `d=${code.distance} · n=${code.variables.length}`;
    ui.modeDescription.textContent = `triangular 6.6.6 color code: Zエラー / X面シンドローム · ${schedule} schedule`;
    ui.boundaryGroup.hidden = true;
    ui.boundaryGroup.style.display = "none";
  } else if (code.type === "ldpc") {
    ui.sizeLabel.textContent = "LDPCサイズ";
    ui.distanceValue.value = `n=${code.variables.length}, m=${code.checks.length}`;
    ui.modeDescription.textContent = `classical LDPC: (${code.variableDegree},${code.checkDegree})-regular style Tanner graph · ${schedule} schedule`;
    ui.boundaryGroup.hidden = true;
    ui.boundaryGroup.style.display = "none";
  } else {
    ui.sizeLabel.textContent = "BB code";
    ui.distanceValue.value = `n=${code.variables.length}, m=${code.checks.length}`;
    ui.modeDescription.textContent = `BB [[144,12,12]]: Hx=[A B], A=x^3+y+y^2, B=y^3+x+x^2 · ${schedule} schedule`;
    ui.boundaryGroup.hidden = true;
    ui.boundaryGroup.style.display = "none";
  }
  ui.errorRateValue.value = p.toFixed(2);
  ui.dampingValue.value = (Number(ui.damping.value) / 100).toFixed(2);

  const estimate = estimateErrors();
  const estimatedSyndrome = estimateSyndrome(estimate);
  const matched = estimatedSyndrome.filter((s, i) => s === code.checks[i].syndrome).length;
  const unsat = code.checks.length - matched;

  ui.phaseLabel.textContent =
    bp.active === "checks"
      ? "全checkを同時更新"
      : bp.active === "variables"
        ? "全variableを同時更新"
        : bp.active === "serial"
          ? `variable v${bp.activeVariableId}を逐次更新`
          : "初期状態";
  ui.iterationLabel.textContent =
    schedule === "serial"
      ? `step ${bp.stepCount} / sweep ${bp.iteration} · ${bp.serialIndex}/${code.variables.length}`
      : `step ${bp.stepCount} / iteration ${bp.iteration}`;
  ui.unsatLabel.textContent = `unsatisfied ${unsat}`;
  ui.estimateCount.textContent = String(estimate.reduce((sum, bit) => sum + bit, 0));
  ui.truthCount.textContent = String(code.variables.reduce((sum, variable) => sum + variable.error, 0));
  ui.matchLabel.textContent = `${Math.round((matched / code.checks.length) * 100)}%`;
}

function computeLayout() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(900, Math.round(rect.width * ratio));
  canvas.height = Math.max(620, Math.round(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  const chartHeight = clamp(height * 0.28, 170, 230);
  const graphHeight = height - chartHeight - 20;
  const margin = Math.min(width, graphHeight) < 680 ? 54 : 76;
  const usable = Math.min(width - margin * 2, graphHeight - margin * 2);
  const colorXs = code.type === "color" ? [...code.variables, ...code.checks].map((node) => node.raw.x) : [0];
  const colorYs = code.type === "color" ? [...code.variables, ...code.checks].map((node) => node.raw.y) : [0];
  const colorMinX = Math.min(...colorXs);
  const colorMaxX = Math.max(...colorXs);
  const colorMinY = Math.min(...colorYs);
  const colorMaxY = Math.max(...colorYs);
  const colorScale =
    code.type === "color"
      ? Math.min(
          (width - margin * 2) / Math.max(1, colorMaxX - colorMinX),
          (graphHeight - margin * 2) / Math.max(1, colorMaxY - colorMinY),
        ) * 0.7
      : 0;
  const bbStep = code.type === "bb144" ? Math.min((width - margin * 2) / code.lx, (graphHeight - margin * 2) / code.ly) : 0;
  const step =
      code.type === "surface"
      ? usable / (code.size - 1) * 0.6
      : code.type === "bb144"
        ? bbStep
        : usable / Math.max(1, code.variables.length - 1);
  const left =
    code.type === "surface"
      ? (width - step * (code.size - 1)) / 2
      : code.type === "bb144"
        ? (width - step * (code.lx - 1)) / 2
        : margin + 42;
  const right = width - margin - 42;
  const top =
    code.type === "surface"
      ? (graphHeight - step * (code.size - 1)) / 2 + 20
      : code.type === "bb144"
        ? (graphHeight - step * (code.ly - 1)) / 2 + 20
        : margin;
  const bottom = graphHeight - margin;
  const chart = {
    x: 58,
    y: graphHeight + 8,
    width: width - 86,
    height: chartHeight - 36,
  };
  const colorWidth = (colorMaxX - colorMinX) * colorScale;
  const colorHeight = (colorMaxY - colorMinY) * colorScale;
  const colorLeft = (width - colorWidth) / 2 - colorMinX * colorScale;
  const colorTop = (graphHeight - colorHeight) / 2 + 20 - colorMinY * colorScale;
  return { width, height, graphHeight, margin, step, left, right, top, bottom, chart, colorScale, colorLeft, colorTop };
}

function pointForCheck(check) {
  if (code.type === "color") {
    return { x: layout.colorLeft + check.raw.x * layout.colorScale, y: layout.colorTop + check.raw.y * layout.colorScale };
  }
  if (code.type === "bb144") {
    return { x: layout.left + check.x * layout.step, y: layout.top + check.y * layout.step };
  }
  if (code.type !== "surface") {
    const gap = code.checks.length <= 1 ? 0 : (layout.bottom - layout.top) / (code.checks.length - 1);
    return { x: layout.right, y: layout.top + check.id * gap };
  }
  return { x: layout.left + check.x * layout.step, y: layout.top + check.y * layout.step };
}

function pointForVariable(variable) {
  if (code.type === "color") {
    const x = layout.colorLeft + variable.raw.x * layout.colorScale;
    const y = layout.colorTop + variable.raw.y * layout.colorScale;
    return { x1: x, y1: y, x2: x, y2: y, mx: x, my: y };
  }
  if (code.type === "bb144") return pointForBbVariable(variable);
  if (code.type !== "surface") return pointForLdpcVariable(variable);
  if (variable.boundary) return boundaryPointForVariable(variable);

  const { left, top, step } = layout;
  if (variable.kind === "h") {
    return {
      x1: left + variable.x * step,
      y1: top + variable.y * step,
      x2: left + (variable.x + 1) * step,
      y2: top + variable.y * step,
      mx: left + (variable.x + 0.5) * step,
      my: top + variable.y * step,
    };
  }
  return {
    x1: left + variable.x * step,
    y1: top + variable.y * step,
    x2: left + variable.x * step,
    y2: top + (variable.y + 1) * step,
    mx: left + variable.x * step,
    my: top + (variable.y + 0.5) * step,
  };
}

function pointForLdpcVariable(variable) {
  const gap = code.variables.length <= 1 ? 0 : (layout.bottom - layout.top) / (code.variables.length - 1);
  const x = layout.left;
  const y = layout.top + variable.id * gap;
  return { x1: x, y1: y, x2: x, y2: y, mx: x, my: y };
}

function pointForBbVariable(variable) {
  const offset = layout.step * 0.18;
  const x = layout.left + variable.x * layout.step + (variable.block === "A" ? -offset : offset);
  const y = layout.top + variable.y * layout.step + (variable.block === "A" ? offset : -offset);
  return { x1: x, y1: y, x2: x, y2: y, mx: x, my: y };
}

function nearestPeriodicCheckPoint(check, variablePoint) {
  const base = pointForCheck(check);
  if (code.type !== "bb144") return { ...base, wrapped: false };
  const periodX = code.lx * layout.step;
  const periodY = code.ly * layout.step;
  let best = { ...base, wrapped: false };
  let bestDistance = Math.hypot(base.x - variablePoint.mx, base.y - variablePoint.my);
  for (const ix of [-1, 0, 1]) {
    for (const iy of [-1, 0, 1]) {
      const candidate = {
        x: base.x + ix * periodX,
        y: base.y + iy * periodY,
        wrapped: ix !== 0 || iy !== 0,
      };
      const distance = Math.hypot(candidate.x - variablePoint.mx, candidate.y - variablePoint.my);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function boundaryPointForVariable(variable) {
  const { left, top, step } = layout;
  const escape = step * 0.48;
  const x = left + variable.x * step;
  const y = top + variable.y * step;
  if (variable.kind === "left") return { x1: x, y1: y, x2: x - escape, y2: y, mx: x - escape / 2, my: y };
  if (variable.kind === "right") return { x1: x, y1: y, x2: x + escape, y2: y, mx: x + escape / 2, my: y };
  if (variable.kind === "top") return { x1: x, y1: y, x2: x, y2: y - escape, mx: x, my: y - escape / 2 };
  return { x1: x, y1: y, x2: x, y2: y + escape, mx: x, my: y + escape / 2 };
}

function drawRoundedRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBackground() {
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = "#fbfcfe";
  ctx.fillRect(0, 0, layout.width, layout.height);

  if (code.type === "bb144") {
    ctx.strokeStyle = "rgba(99, 112, 131, 0.18)";
    ctx.lineWidth = 1;
    for (let y = 0; y < code.ly; y += 1) {
      ctx.beginPath();
      ctx.moveTo(layout.left, layout.top + y * layout.step);
      ctx.lineTo(layout.left + (code.lx - 1) * layout.step, layout.top + y * layout.step);
      ctx.stroke();
    }
    for (let x = 0; x < code.lx; x += 1) {
      ctx.beginPath();
      ctx.moveTo(layout.left + x * layout.step, layout.top);
      ctx.lineTo(layout.left + x * layout.step, layout.top + (code.ly - 1) * layout.step);
      ctx.stroke();
    }
  }

  const panelX = 18;
  const panelY = 18;
  const panelW = Math.min(390, layout.width - 36);
  drawRoundedRect(panelX, panelY, panelW, 70, 8);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#d6dde7";
  ctx.stroke();

  ctx.fillStyle = "#17212b";
  ctx.font = "700 15px Inter, system-ui, sans-serif";
  ctx.fillText(
    code.type === "surface"
      ? "Surface code Tanner graph"
      : code.type === "color"
        ? "Triangular 6.6.6 color code Tanner graph"
        : code.type === "bb144"
          ? "BB [[144,12,12]] Tanner graph"
          : "Classical LDPC Tanner graph",
    panelX + 16,
    panelY + 25,
  );
  ctx.fillStyle = "#637083";
  ctx.font = "13px Inter, system-ui, sans-serif";
  ctx.fillText(
    code.type === "surface"
      ? "syndrome vertices are connected by colored variable bonds"
      : code.type === "color"
        ? "data qubits sit on vertices; red, green and blue faces are parity checks"
      : code.type === "bb144"
        ? "12 x 6 periodic grid with A/B qubits offset at each site"
        : "colored bit nodes connect to parity checks",
    panelX + 16,
    panelY + 48,
  );
}

function drawColorFaces() {
  if (code.type !== "color") return;
  for (const check of code.checks) {
    const center = pointForCheck(check);
    const points = check.variables
      .map((variable) => pointForVariable(variable))
      .sort(
        (a, b) =>
          Math.atan2(a.my - center.y, a.mx - center.x) -
          Math.atan2(b.my - center.y, b.mx - center.x),
      );
    if (points.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(points[0].mx, points[0].my);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].mx, points[i].my);
    ctx.closePath();
    ctx.fillStyle = `${COLOR_CHECKS[check.colorIndex]}18`;
    ctx.strokeStyle = `${COLOR_CHECKS[check.colorIndex]}55`;
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
  }
}

function drawTannerLinks() {
  ctx.lineCap = "round";
  ctx.strokeStyle = code.type === "surface" ? "rgba(23, 33, 43, 0.12)" : code.type === "color" ? "#4a9bc8" : "rgba(99, 112, 131, 0.22)";
  ctx.lineWidth = code.type === "surface" ? 12 : code.type === "color" ? 5.5 : code.type === "bb144" ? 1.15 : 1.5;
  for (const variable of code.variables) {
    const p = pointForVariable(variable);
    if (code.type === "bb144") {
      for (const check of variable.checks) {
        const c = nearestPeriodicCheckPoint(check, p);
        ctx.globalAlpha = c.wrapped ? 0.18 : 0.62;
        ctx.beginPath();
        ctx.moveTo(p.mx, p.my);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (code.type !== "surface") {
      for (const check of variable.checks) {
        const c = pointForCheck(check);
        ctx.beginPath();
        ctx.moveTo(p.mx, p.my);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(p.x1, p.y1);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
      if (code.type === "color") {
        ctx.strokeStyle = "rgba(23, 33, 43, 0.22)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.strokeStyle = "#4a9bc8";
        ctx.lineWidth = 5.5;
      }
    }
  }
}

function drawVariables() {
  ctx.lineCap = "round";
  for (const variable of code.variables) {
    const p = pointForVariable(variable);
    const llr = bp.posterior[variable.id];
    const isHovered = hoveredVariable && hoveredVariable.id === variable.id;
    const isActiveSerial = bp.active === "serial" && bp.activeVariableId === variable.id;

    if (code.type === "bb144") {
      ctx.fillStyle = logisticColor(llr);
      ctx.strokeStyle = isHovered ? "#17212b" : variable.block === "A" ? "#5d6b7a" : "#3a4d63";
      ctx.lineWidth = isHovered ? 3 : 1.4;
      ctx.beginPath();
      if (variable.block === "A") {
        ctx.arc(p.mx, p.my, 6.5, 0, Math.PI * 2);
      } else {
        ctx.rect(p.mx - 6.2, p.my - 6.2, 12.4, 12.4);
      }
      ctx.fill();
      ctx.stroke();

      if (ui.truthToggle.checked && variable.error) {
        ctx.strokeStyle = "#e0a82e";
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(p.mx, p.my, 10.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      continue;
    }

    if (code.type === "color") {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = isActiveSerial ? "#e0a82e" : isHovered ? "#17212b" : "#536579";
      ctx.lineWidth = isActiveSerial ? 4 : 2;
      ctx.beginPath();
      ctx.arc(p.mx, p.my, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#536579";
      ctx.font = "700 10px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`V${variable.id}`, p.mx, p.my + 17);
      if (ui.truthToggle.checked && variable.error) {
        ctx.strokeStyle = "#e0a82e";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.mx, p.my, 11, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (bp.posterior[variable.id] < 0) {
        ctx.fillStyle = "#17212b";
        ctx.font = "800 10px Inter, system-ui, sans-serif";
        ctx.fillText("1", p.mx, p.my);
      } else if (Math.abs(bp.posterior[variable.id]) < 0.8) {
        ctx.fillStyle = "#637083";
        ctx.font = "800 10px Inter, system-ui, sans-serif";
        ctx.fillText("?", p.mx, p.my);
      }
      continue;
    }

    if (code.type !== "surface") {
      ctx.fillStyle = logisticColor(llr);
      ctx.strokeStyle = isHovered ? "#17212b" : "rgba(23, 33, 43, 0.55)";
      ctx.lineWidth = isHovered ? 3 : 1.5;
      ctx.beginPath();
      ctx.arc(p.mx, p.my, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (ui.truthToggle.checked && variable.error) {
        ctx.strokeStyle = "#e0a82e";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(p.mx, p.my, 12, 0, Math.PI * 2);
        ctx.stroke();
      }
      continue;
    }

    ctx.strokeStyle = logisticColor(llr);
    ctx.lineWidth = isHovered ? 18 : 13;
    ctx.beginPath();
    ctx.moveTo(p.x1, p.y1);
    ctx.lineTo(p.x2, p.y2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(23, 33, 43, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x1, p.y1);
    ctx.lineTo(p.x2, p.y2);
    ctx.stroke();

    ctx.fillStyle = logisticColor(llr);
    ctx.strokeStyle = isActiveSerial ? "#e0a82e" : isHovered ? "#17212b" : "rgba(23, 33, 43, 0.55)";
    ctx.lineWidth = isActiveSerial ? 4 : isHovered ? 3 : 1.5;
    ctx.beginPath();
    ctx.arc(p.mx, p.my, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (ui.truthToggle.checked && variable.error) {
      ctx.fillStyle = "#e0a82e";
      ctx.strokeStyle = "#3a2b09";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.mx, p.my, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (bp.posterior[variable.id] < 0) {
      ctx.fillStyle = "#17212b";
      ctx.font = "700 12px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("1", p.mx, p.my);
    } else if (Math.abs(bp.posterior[variable.id]) < 0.8) {
      ctx.fillStyle = "#17212b";
      ctx.font = "700 11px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", p.mx, p.my);
    }
  }
}

function drawTooltip() {
  if (!hoveredVariable) return;
  const p = pointForVariable(hoveredVariable);
  const llr = bp.posterior[hoveredVariable.id];
  const bit = llr < 0 ? 1 : 0;
  const prefix = code.type === "bb144" ? `${hoveredVariable.block}${hoveredVariable.id % 72}` : `v${hoveredVariable.id}`;
  const lines = [prefix, `LLR ${llr.toFixed(3)}`, `estimate ${bit}`];
  ctx.font = "700 12px Inter, system-ui, sans-serif";
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 22;
  const height = 62;
  const x = clamp(p.mx + 16, 10, layout.width - width - 10);
  const y = clamp(p.my - 76, 10, layout.graphHeight - height - 10);

  drawRoundedRect(x, y, width, height, 8);
  ctx.fillStyle = "rgba(23, 33, 43, 0.94)";
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i += 1) {
    ctx.fillText(lines[i], x + 11, y + 10 + i * 16);
  }
}

function drawChecks() {
  for (const check of code.checks) {
    const { x, y } = pointForCheck(check);
    ctx.beginPath();
    if (code.type === "color") {
      ctx.arc(x, y, 14, 0, Math.PI * 2);
    } else if (code.type === "bb144") {
      ctx.arc(x, y, 7.5, 0, Math.PI * 2);
    } else if (code.type !== "surface") {
      ctx.rect(x - 9, y - 9, 18, 18);
    } else {
      ctx.arc(x, y, 13, 0, Math.PI * 2);
    }
    ctx.fillStyle = check.syndrome ? "#000000" : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = code.type === "color" ? COLOR_CHECKS[check.colorIndex] : check.syndrome ? "#24303d" : "#95a3b5";
    ctx.lineWidth = code.type === "color" ? 3 : 2.5;
    ctx.stroke();

    ctx.fillStyle = check.syndrome ? "#ffffff" : "#637083";
    ctx.font = "800 12px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(check.syndrome), x, y + 0.5);
  }
}

function drawNodes() {
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#c2ccd8";
  ctx.lineWidth = 1.5;
}

function drawMessagePulse() {
  if (!bp.active) return;
  const alpha = bp.active === "checks" ? 0.18 : bp.active === "serial" ? 0.28 : 0.12;
  ctx.strokeStyle = bp.active === "checks" ? `rgba(29, 154, 122, ${alpha})` : `rgba(224, 168, 46, ${alpha})`;
  ctx.lineWidth = code.type !== "surface" ? 4 : bp.active === "checks" ? 20 : 16;
  ctx.lineCap = "round";
  for (const check of code.checks) {
    const c = pointForCheck(check);
    for (const variable of check.variables) {
      if (bp.active === "serial" && variable.id !== bp.activeVariableId) continue;
      const p = pointForVariable(variable);
      const target = code.type === "bb144" ? nearestPeriodicCheckPoint(check, p) : c;
      ctx.beginPath();
      ctx.moveTo(target.x, target.y);
      ctx.lineTo(p.mx, p.my);
      ctx.stroke();
    }
  }
}

function variableColor(id) {
  const hue = (id * 47) % 360;
  return `hsl(${hue} 70% 42%)`;
}

function drawLlrChart() {
  const { x, y, width, height } = layout.chart;
  const minLlr = -8;
  const maxLlr = 8;
  const history = bp.history;
  const steps = Math.max(1, history.length - 1);

  drawRoundedRect(x - 14, y - 12, width + 26, height + 32, 8);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#d6dde7";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.strokeStyle = "#d6dde7";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.stroke();

  for (const tick of [-8, -4, 0, 4, 8]) {
    const yy = y + ((maxLlr - tick) / (maxLlr - minLlr)) * height;
    ctx.strokeStyle = tick === 0 ? "#9aa8b9" : "#e5eaf1";
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + width, yy);
    ctx.stroke();
    ctx.fillStyle = "#637083";
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(String(tick), x - 7, yy);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  for (const variable of code.variables) {
    const isHovered = hoveredVariable && hoveredVariable.id === variable.id;
    ctx.strokeStyle = isHovered ? "#17212b" : variableColor(variable.id);
    ctx.globalAlpha = isHovered || !hoveredVariable ? 0.42 : 0.12;
    ctx.lineWidth = isHovered ? 3 : 1.35;
    ctx.beginPath();
    for (let step = 0; step < history.length; step += 1) {
      const value = clamp(history[step][variable.id], minLlr, maxLlr);
      const px = x + (step / steps) * width;
      const py = y + ((maxLlr - value) / (maxLlr - minLlr)) * height;
      if (step === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  const latestX = x + ((history.length - 1) / steps) * width;
  ctx.strokeStyle = "#1d9a7a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(latestX, y);
  ctx.lineTo(latestX, y + height);
  ctx.stroke();

  ctx.fillStyle = "#17212b";
  ctx.font = "700 13px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("LLR history", x, y - 16);
  ctx.fillStyle = "#637083";
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("step", x + width / 2, y + height + 11);

  ctx.save();
  ctx.translate(x - 43, y + height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("LLR", 0, 0);
  ctx.restore();

  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText(String(bp.stepCount), x + width, y + height + 11);
}

function render() {
  layout = computeLayout();
  updateLabels();
  drawBackground();
  drawColorFaces();
  drawTannerLinks();
  drawMessagePulse();
  drawVariables();
  drawNodes();
  drawChecks();
  drawTooltip();
  drawLlrChart();
}

function variableAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  let best = null;
  let bestDistance = Infinity;
  for (const variable of code.variables) {
    const p = pointForVariable(variable);
    const distance = Math.hypot(x - p.mx, y - p.my);
    if (distance < bestDistance) {
      best = variable;
      bestDistance = distance;
    }
  }
  return bestDistance <= 22 ? best : null;
}

function rebuild(newErrors = true) {
  const size = Number(ui.distance.value);
  const p = Number(ui.errorRate.value) / 100;
  const mode = currentMode();
  const codeSize = mode === "bb144" ? 144 : size;
  if (newErrors || !code || code.size !== codeSize || code.type !== mode) {
    if (mode === "surface") code = createSurfaceCode(size, p);
    else if (mode === "color") code = createColorCode(size, p);
    else if (mode === "bb144") code = createBb144Code(p);
    else code = createLdpcCode(size, p);
  }
  bp = createBpState(code, p);
  render();
}

function setRunning(value) {
  running = value;
  ui.runButton.textContent = running ? "Pause" : "Run";
  if (timer) window.clearInterval(timer);
  timer = 0;
  if (running) {
    const delay = currentSchedule() === "serial" ? currentSerialDelay() : 520;
    timer = window.setInterval(() => {
      bpStep();
      const estimate = estimateErrors();
      const estimatedSyndrome = estimateSyndrome(estimate);
      const unsat = estimatedSyndrome.filter((s, i) => s !== code.checks[i].syndrome).length;
      const atIterationBoundary =
        currentSchedule() === "serial" ? bp.serialIndex === 0 : bp.halfStep === 0;
      if (unsat === 0 && bp.iteration > 0 && atIterationBoundary) setRunning(false);
    }, delay);
  }
}

ui.stepButton.addEventListener("click", bpStep);
canvas.addEventListener("click", bpStep);
canvas.addEventListener("mousemove", (event) => {
  const next = variableAt(event.clientX, event.clientY);
  if ((next && !hoveredVariable) || (!next && hoveredVariable) || (next && hoveredVariable && next.id !== hoveredVariable.id)) {
    hoveredVariable = next;
    render();
  }
});
canvas.addEventListener("mouseleave", () => {
  hoveredVariable = null;
  render();
});
ui.runButton.addEventListener("click", () => setRunning(!running));
ui.resetButton.addEventListener("click", () => {
  setRunning(false);
  rebuild(false);
});
ui.newButton.addEventListener("click", () => {
  setRunning(false);
  rebuild(true);
});
ui.truthToggle.addEventListener("change", render);
for (const scheduleMode of ui.scheduleModes) {
  scheduleMode.addEventListener("change", () => {
    setRunning(false);
    rebuild(false);
  });
}
for (const serialOrderMode of ui.serialOrderModes) {
  serialOrderMode.addEventListener("change", () => {
    setRunning(false);
    rebuild(false);
  });
}
for (const serialSpeedMode of ui.serialSpeedModes) {
  serialSpeedMode.addEventListener("change", () => {
    if (running) setRunning(true);
  });
}
for (const codeMode of ui.codeModes) {
  codeMode.addEventListener("change", () => {
    setRunning(false);
    hoveredVariable = null;
    const mode = currentMode();
    ui.distance.min = "3";
    ui.distance.max = mode === "color" ? "7" : "8";
    ui.distance.step = mode === "color" ? "2" : "1";
    if (mode === "color" && Number(ui.distance.value) % 2 === 0) ui.distance.value = "5";
    rebuild(true);
  });
}
ui.distance.addEventListener("input", () => {
  setRunning(false);
  rebuild(true);
});
ui.errorRate.addEventListener("input", () => {
  setRunning(false);
  rebuild(true);
});
for (const boundaryMode of ui.boundaryModes) {
  boundaryMode.addEventListener("change", () => {
    setRunning(false);
    rebuild(true);
  });
}
ui.damping.addEventListener("input", () => {
  updateLabels();
});
window.addEventListener("resize", render);

rebuild(true);
