function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
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
function createBpState(surfaceCode, p) {
  llrFollowLatest = true;
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
    traceMeta: [{ step: 0, iteration: 0, phase: "initial", schedule: currentSchedule(), damping: Number(ui.damping.value) / 100, activeVariable: "", unsatisfied: surfaceCode.checks.filter(c => c.syndrome !== 0).length }],
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