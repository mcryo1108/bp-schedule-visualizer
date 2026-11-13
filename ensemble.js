/* Parallel random serial schedules, with a frozen input shared by all workers. */
const ensembleUi = Object.fromEntries(['Count','Iterations','Start','Stop','Status','Settings','Results','Summary','Rows','Charts'].map(key => [key, document.getElementById(`ensemble${key}`)]));
let ensembleJob = null;
function updateEnsembleVisibility() {
  ensembleUi.Settings.hidden = currentSchedule() !== 'serial' || currentSerialOrderMode() !== 'random';
}
for (const input of [...ui.scheduleModes, ...ui.serialOrderModes]) input.addEventListener('change', updateEnsembleVisibility);
updateEnsembleVisibility();
function uniqueRandomOrders(n, count) {
  let permutations = 1;
  for (let i=2; i<=n && permutations<count; i++) permutations *= i;
  if (permutations < count) throw Error(`この符号では異なる順序を${count}本作れません。並列数を減らしてください。`);
  const seen = new Set(), orders = [];
  while (orders.length < count) {
    const order = Array.from({length:n}, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const key = order.join(',');
    if (!seen.has(key)) { seen.add(key); orders.push(order); }
  }
  return orders;
}
function ensembleChart(history, bound, maxIterations) {
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg'); svg.setAttribute('viewBox','0 0 640 200'); svg.setAttribute('role','img'); svg.setAttribute('aria-label','全ビットのLLR履歴');
  function element(tag,attrs,text) { const node=document.createElementNS(ns,tag); for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));if(text!==undefined)node.textContent=text;svg.append(node);return node; }
  element('rect',{width:640,height:200,fill:'#fff'});
  for(const f of [-1,-.5,0,.5,1]) {
    const y=90-f*70;
    element('line',{x1:48,y1:y,x2:625,y2:y,stroke:f===0?'#8995a5':'#e5eaf0','stroke-width':1});
    element('text',{x:42,y:y+4,'text-anchor':'end','font-size':12,fill:'#536176'},(f*bound).toFixed(1));
  }
  element('text',{x:48,y:185,'font-size':12,fill:'#536176'},'0');
  element('text',{x:625,y:185,'text-anchor':'end','font-size':12,fill:'#536176'},String(maxIterations));
  element('text',{x:330,y:198,'text-anchor':'middle','font-size':12,fill:'#536176'},`sweep（現在 ${history.length-1}）`);
  for(let bit=0;bit<history[0].length;bit++) {
    const points=history.map((row,i)=>`${48+i/Math.max(1,maxIterations)*577},${90-row[bit]/bound*70}`).join(' ');
    element('polyline',{points,fill:'none',stroke:`hsl(${bit*137.5%360},65%,38%)`,'stroke-width':1.4,'stroke-linejoin':'round'});
  }
  return svg;
}
function drawEnsembleHistories(job) {
  let bound = 1;
  for (const history of job.histories) for (const row of history) for (const value of row) bound = Math.max(bound, Math.abs(value));
  job.chartSlots.forEach((slot,i) => slot.replaceChildren(ensembleChart(job.histories[i],bound,job.maxIterations)));
}
ui.runButton.addEventListener('click', event => {
  if (currentSchedule() !== 'serial' || currentSerialOrderMode() !== 'random') return;
  event.stopImmediatePropagation();
  if (ensembleJob?.manual) {
    ensembleJob.manual=false; ui.runButton.textContent='Pause';
    for(const worker of ensembleJob.workers) worker.postMessage({type:'resume'});
  } else if (ensembleJob) stopEnsemble(); else ensembleUi.Start.click();
}, true);
function finishEnsemble(job) {
  if (ensembleJob !== job || job.workers.size || job.launching) return;
  drawEnsembleHistories(job);
  ui.runButton.textContent = "Run";
  ensembleJob = null; ensembleUi.Start.disabled = false; ensembleUi.Stop.disabled = true;
  ensembleUi.Status.textContent = `完了 ${job.finished}/${job.count}本 · シンドローム一致 ${job.converged}本 · 経過 ${((performance.now()-job.started)/1000).toFixed(2)}秒`;
  ensembleUi.Summary.textContent = `${job.description} · ${ensembleUi.Status.textContent}`;
}
function stopEnsemble() {
  const job = ensembleJob; if (!job) return;
  for (const worker of job.workers) worker.terminate(); job.workers.clear();
  for (const row of job.rows) if (row.dataset.pending) { row.children[1].textContent = '中止'; delete row.dataset.pending; }
  finishEnsemble(job); ensembleUi.Status.textContent = `中止 · 完了 ${job.finished}/${job.count}本`; ensembleUi.Summary.textContent = `${job.description} · ${ensembleUi.Status.textContent}`;
}
ensembleUi.Stop.addEventListener('click', stopEnsemble);
ensembleUi.Start.addEventListener('click', () => startEnsemble(false));
ui.stepButton.addEventListener('click', event => {
  if(currentSchedule()!=='serial'||currentSerialOrderMode()!=='random') return;
  event.stopImmediatePropagation();
  if(!ensembleJob) startEnsemble(true);
  else if(ensembleJob.manual && ensembleJob.pending.size===0) {
    for(const worker of ensembleJob.workers) { ensembleJob.pending.add(worker); worker.postMessage({type:'step'}); }
  }
},true);
function startEnsemble(manual) {
  if (ensembleJob) return;
  const count = Number(ensembleUi.Count.value), maxIterations = Number(ensembleUi.Iterations.value);
  if (!Number.isInteger(count) || count < 1 || count > 32 || !Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 500) {
    ensembleUi.Status.textContent = '並列数は1〜32、最大反復数は1〜500の整数を指定してください。'; return;
  }
  if (!window.Worker) { ensembleUi.Status.textContent = 'このブラウザでは並列実行を利用できません。'; return; }
  setRunning(false);
  const graph = graphArchive(), algorithm = currentAlgorithm(), damping = Number(ui.damping.value)/100;
  const prior = Math.log((1-Number(ui.errorRate.value)/100)/(Number(ui.errorRate.value)/100));
  let orders;
  try { orders = uniqueRandomOrders(graph.variables.length, count); } catch (error) { ensembleUi.Status.textContent = error.message; return; }
  const job = {count, finished:0, converged:0, workers:new Set(), rows:[], started:performance.now(), launching:true, manual, pending:new Set(), histories:orders.map(()=>[new Array(graph.variables.length).fill(prior)]), chartSlots:[], maxIterations}; ensembleJob = job;
  ensembleUi.Charts.replaceChildren();
  ensembleUi.Rows.replaceChildren(); ensembleUi.Results.hidden = false;
  ui.runButton.textContent = manual ? "Run" : "Pause";
  ensembleUi.Start.disabled = true; ensembleUi.Stop.disabled = false;
  ensembleUi.Status.textContent = `${count}本を並列実行中`;
  ensembleUi.Summary.textContent = `${graph.label || graph.type} · n=${graph.variables.length} · ${algorithm} · p=${ui.errorRate.value/100} · damping=${damping} · 最大${maxIterations} sweep · 真の誤り: ${graph.variables.filter(v=>v.error).map(v=>`v${v.id}`).join(', ') || 'なし'}（開始時の条件を固定）`;
  job.description = ensembleUi.Summary.textContent;
  orders.forEach((order, index) => {
    const card = document.createElement('section'); card.className='ensembleHistoryCard';
    const heading = document.createElement('h3'); heading.textContent=`BP ${index+1} · LLR history`;
    const slot = document.createElement('div'); card.append(heading,slot); ensembleUi.Charts.append(card); job.chartSlots.push(slot);

    const row = document.createElement('tr'); row.dataset.pending = 'true';
    const cells = [`BP ${index+1}`, '実行中', '0', '—', '—'];
    for (const value of cells) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = '更新順序・LLR'; details.append(summary);
    const orderText = document.createElement('p'); orderText.className = 'ensembleOrder'; orderText.textContent = order.map(id=>`v${id}`).join(' → '); details.append(orderText); row.children[4].replaceChildren(details);
    ensembleUi.Rows.append(row); job.rows.push(row);
    function fail(message, worker) {
      if (ensembleJob !== job || !row.dataset.pending) return;
      row.children[1].textContent = `実行エラー: ${message}`; delete row.dataset.pending;
      if (worker) { worker.terminate(); job.workers.delete(worker); } job.finished++; finishEnsemble(job);
    }
    let worker;
    try {
      worker = new Worker('ensemble-worker.js?v=step-20261113'); job.workers.add(worker); job.pending.add(worker);
      worker.onerror = event => { event.preventDefault(); fail(event.message || 'Workerを起動できませんでした', worker); };
      worker.onmessage = event => {
        if (ensembleJob !== job) return;
        const message = event.data;
        if (message.type === 'error') { fail(message.message, worker); return; }
        job.pending.delete(worker);
        const result = message.result || message;
        row.children[2].textContent = String(result.iterations ?? result.iteration);
        row.children[3].textContent = String(result.unsatisfied);
        if (message.type !== 'done') {
          job.histories[index].push(message.posterior);
          drawEnsembleHistories(job);
          return;
        }
        job.histories[index] = result.history;
        row.children[1].textContent = result.converged ? 'シンドローム一致' : '最大反復に到達';
        delete row.dataset.pending; job.finished++; if (result.converged) job.converged++;
        drawEnsembleHistories(job);
        const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.textContent = 'このBPのJSONを保存';
        exportButton.addEventListener('click', () => {
          const url = URL.createObjectURL(new Blob([JSON.stringify({format:'bp-random-ensemble',version:1,graph,prior,damping,algorithm,maxIterations,...result})],{type:'application/json'}));
          const link = document.createElement('a'); link.href = url; link.download = `random-bp-${index+1}.json`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
        }); details.append(exportButton);
        worker.terminate(); job.workers.delete(worker); finishEnsemble(job);
      };
      worker.postMessage({graph,prior,damping,algorithm,order,maxIterations,manual,delay:currentUpdateDelay()});
    } catch (error) { fail(error.message, worker); }
  });
  drawEnsembleHistories(job);
  job.launching = false;
  finishEnsemble(job);
}
window.addEventListener('pagehide', stopEnsemble);
