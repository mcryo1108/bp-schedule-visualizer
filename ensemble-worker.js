/* Each worker owns an independent BP state. The supplied order is fixed per run. */
function* serialBPSteps({graph, prior, damping, algorithm, order, maxIterations, stopOnConvergence = true}, progress = () => {}) {
  const n = graph.variables.length;
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 500 ||
      order.length !== n || new Set(order).size !== n || order.some(id => !Number.isInteger(id) || id < 0 || id >= n) ||
      !Number.isFinite(prior) || damping < 0 || damping > 0.9 || !['sum-product', 'min-sum'].includes(algorithm)) throw Error('並列BPの条件が不正です。');
  const trace={events:[],frames:[]}, cr=new Map(),vr=new Map(),pr=[];
  let traceStep=0,position=-1,sentEvents=0,sentFrames=0;
  const add=e=>{const id=trace.events.length;trace.events.push({id,step:traceStep,position,algorithm,damping,...e});return id;};
  const priorRef=add({kind:'prior',source:'prior',target:'all',value:prior,inputs:[]});
  const frame=()=>trace.frames.push({step:traceStep,p:pr.slice(),c:[...cr],v:[...vr]});
  const delta=()=>{const result={events:trace.events.slice(sentEvents),frames:trace.frames.slice(sentFrames)};sentEvents=trace.events.length;sentFrames=trace.frames.length;return result;};
  const vToC = new Map(), cToV = new Map(), posterior = new Array(n).fill(prior);
  for (const v of graph.variables) for (const c of v.checks) {
    vToC.set(`${v.id}:${c}`, prior); cToV.set(`${c}:${v.id}`, 0);
    cr.set(`${c}:${v.id}`,add({kind:'initial-c',source:`c${c}`,target:`v${v.id}`,value:0,inputs:[]}));
    vr.set(`${v.id}:${c}`,add({kind:'initial-v',source:`v${v.id}`,target:`c${c}`,value:prior,inputs:[priorRef]}));
  }
  for(const v of graph.variables) pr[v.id]=add({kind:'initial-p',source:`v${v.id}`,target:`v${v.id}`,value:prior,inputs:[priorRef]});
  frame();
  const history = [posterior.slice()], unsatisfiedHistory = [];
  const cap = x => Math.max(-0.999999, Math.min(0.999999, x));
  const atanh = x => 0.5 * Math.log((1 + cap(x)) / (1 - cap(x)));
  const unsatisfied = () => graph.checks.reduce((count, c) => count + Number(c.variables.reduce((s, id) => s ^ Number(posterior[id] < 0), 0) !== c.syndrome), 0);
  let remaining = unsatisfied(), iteration = 0;
  unsatisfiedHistory.push(remaining);
  const start = performance.now();
  for (iteration = 1; iteration <= maxIterations; iteration++) {
    traceStep=iteration; position=-1;
    for (const id of order) {
      position++;
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
        const previous=cToV.get(key),previousRef=cr.get(key),value=previous*damping+raw*(1-damping);
        const inputs=check.variables.filter(other=>other!==id).map(other=>vr.get(`${other}:${cid}`));
        cr.set(key,add({kind:'c2v',source:`c${cid}`,target:`v${id}`,value,raw,previous,previousRef,syndrome:check.syndrome,inputs}));
        cToV.set(key,value);
      }
      let value = prior;
      for (const cid of variable.checks) value += cToV.get(`${cid}:${id}`);
      posterior[id] = value;
      pr[id]=add({kind:'posterior',source:`v${id}`,target:`v${id}`,value,inputs:[priorRef,...variable.checks.map(cid=>cr.get(`${cid}:${id}`))]});
      for (const target of variable.checks) {
        let raw = prior;
        for (const cid of variable.checks) if (cid !== target) raw += cToV.get(`${cid}:${id}`);
        const key = `${id}:${target}`;
        const previous=vToC.get(key),previousRef=vr.get(key),value=previous*damping+raw*(1-damping);
        vr.set(key,add({kind:'v2c',source:`v${id}`,target:`c${target}`,value,raw,previous,previousRef,inputs:[priorRef,...variable.checks.filter(cid=>cid!==target).map(cid=>cr.get(`${cid}:${id}`))]}));
        vToC.set(key,value);
      }
    }
    history.push(posterior.slice()); remaining = unsatisfied(); unsatisfiedHistory.push(remaining);
    frame();
    yield {iteration, unsatisfied: remaining, posterior: posterior.slice(),traceDelta:delta()};
    if (stopOnConvergence && remaining === 0) break;
  }
  return {trace,order, history, unsatisfiedHistory, posterior, estimate: posterior.map(x => Number(x < 0)),
    iterations: history.length - 1, unsatisfied: remaining, converged: remaining === 0, computeMs: performance.now() - start};
}
function runSerialBP(input, progress = () => {}) {
  const steps = serialBPSteps(input); let next;
  do { next = steps.next(); if (!next.done) progress(next.value); } while (!next.done);
  return next.value;
}
let workerSteps=null, workerInput=null, workerTimer=null;
function advanceWorker() {
  if(!workerSteps) return;
  try {
    const next=workerSteps.next();
    if(next.done) { self.postMessage({type:'done',result:{...next.value,trace:undefined}}); workerSteps=null; return; }
    self.postMessage({type:'progress',...next.value});
    if(next.value.iteration>=workerInput.maxIterations || (workerInput.stopOnConvergence !== false && next.value.unsatisfied===0)) {
      const end=workerSteps.next(); self.postMessage({type:'done',result:{...end.value,trace:undefined}}); workerSteps=null; return;
    }
    if(!workerInput.manual) workerTimer=setTimeout(advanceWorker,Math.max(16,workerInput.delay||20));
  } catch(error) { workerSteps=null; self.postMessage({type:'error',message:error.message}); }
}
self.onmessage = event => {
  if(event.data.type==='pause') { clearTimeout(workerTimer); if(workerInput) workerInput.manual=true; self.postMessage({type:'paused'}); return; }
  if(event.data.type==='step') { if(workerInput?.manual) advanceWorker(); return; }
  if(event.data.type==='resume') { if(workerInput?.manual) { workerInput.manual=false; advanceWorker(); } return; }
  clearTimeout(workerTimer); workerInput=event.data; workerSteps=serialBPSteps(workerInput); advanceWorker();
};
