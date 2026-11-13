/* Each worker owns an independent BP state. The supplied order is fixed per run. */
function runSerialBP({graph, prior, damping, algorithm, order, maxIterations, stopOnConvergence = true}, progress = () => {}) {
  const n = graph.variables.length;
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 500 ||
      order.length !== n || new Set(order).size !== n || order.some(id => !Number.isInteger(id) || id < 0 || id >= n) ||
      !Number.isFinite(prior) || damping < 0 || damping > 0.9 || !['sum-product', 'min-sum'].includes(algorithm)) throw Error('並列BPの条件が不正です。');
  const vToC = new Map(), cToV = new Map(), posterior = new Array(n).fill(prior);
  for (const v of graph.variables) for (const c of v.checks) {
    vToC.set(`${v.id}:${c}`, prior); cToV.set(`${c}:${v.id}`, 0);
  }
  const history = [posterior.slice()], unsatisfiedHistory = [];
  const cap = x => Math.max(-0.999999, Math.min(0.999999, x));
  const atanh = x => 0.5 * Math.log((1 + cap(x)) / (1 - cap(x)));
  const unsatisfied = () => graph.checks.reduce((count, c) => count + Number(c.variables.reduce((s, id) => s ^ Number(posterior[id] < 0), 0) !== c.syndrome), 0);
  let remaining = unsatisfied(), iteration = 0;
  unsatisfiedHistory.push(remaining);
  const start = performance.now();
  for (iteration = 1; iteration <= maxIterations; iteration++) {
    for (const id of order) {
      const variable = graph.variables[id];
      for (const cid of variable.checks) {
        const check = graph.checks[cid];
        let product = check.syndrome ? -1 : 1, minimum = Infinity;
        for (const other of check.variables) if (other !== id) {
          const value = vToC.get(`${other}:${cid}`);
          if (algorithm === 'min-sum') { product *= Math.sign(value); minimum = Math.min(minimum, Math.abs(value)); }
          else product *= Math.tanh(value / 2);
        }
        const raw = algorithm === 'min-sum' ? product * (minimum === Infinity ? 2 * atanh(1) : minimum) : 2 * atanh(product);
        const key = `${cid}:${id}`;
        cToV.set(key, cToV.get(key) * damping + raw * (1 - damping));
      }
      let value = prior;
      for (const cid of variable.checks) value += cToV.get(`${cid}:${id}`);
      posterior[id] = value;
      for (const target of variable.checks) {
        let raw = prior;
        for (const cid of variable.checks) if (cid !== target) raw += cToV.get(`${cid}:${id}`);
        const key = `${id}:${target}`;
        vToC.set(key, vToC.get(key) * damping + raw * (1 - damping));
      }
    }
    history.push(posterior.slice()); remaining = unsatisfied(); unsatisfiedHistory.push(remaining);
    if (iteration % 10 === 0 || remaining === 0 || iteration === maxIterations) progress({iteration, unsatisfied: remaining});
    if (stopOnConvergence && remaining === 0) break;
  }
  return {order, history, unsatisfiedHistory, posterior, estimate: posterior.map(x => Number(x < 0)),
    iterations: history.length - 1, unsatisfied: remaining, converged: remaining === 0, computeMs: performance.now() - start};
}
self.onmessage = event => {
  try {
    const result = runSerialBP(event.data, value => self.postMessage({type: 'progress', ...value}));
    self.postMessage({type: 'done', result});
  } catch (error) { self.postMessage({type: 'error', message: error.message}); }
};
