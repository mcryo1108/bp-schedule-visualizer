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
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 160;
  canvas.setAttribute('aria-label', 'このBPの全ビットLLR履歴');
  const context = canvas.getContext('2d');

  context.fillStyle = '#ffffff'; context.fillRect(0, 0, 640, 160);
  context.strokeStyle = '#d6dde7'; context.beginPath(); context.moveTo(35, 75); context.lineTo(630, 75); context.stroke();
  context.fillStyle = '#637083'; context.font = '12px sans-serif'; context.fillText(bound.toFixed(1), 0, 16); context.fillText((-bound).toFixed(1), 0, 142); context.fillText('0', 35, 157); context.fillText(`sweep 0–${maxIterations}`, 540, 157);
  for (let bit = 0; bit < history[0].length; bit++) {
    context.strokeStyle = `hsla(${bit * 137.5 % 360},65%,42%,.65)`; context.lineWidth = 1; context.beginPath();
    history.forEach((row, i) => { const x = 35 + i / Math.max(1, maxIterations) * 595, y = 75 - row[bit] / bound * 65; if (i) context.lineTo(x,y); else context.moveTo(x,y); }); context.stroke();
  }
  return canvas;
}
function drawEnsembleHistories(job) {
  let bound = 1;
  for (const history of job.histories) for (const row of history) for (const value of row) bound = Math.max(bound, Math.abs(value));
  job.chartSlots.forEach((slot,i) => slot.replaceChildren(ensembleChart(job.histories[i],bound,job.maxIterations)));
}
ui.runButton.addEventListener('click', event => {
  if (currentSchedule() !== 'serial' || currentSerialOrderMode() !== 'random') return;
  event.stopImmediatePropagation();
  if (ensembleJob) stopEnsemble(); else ensembleUi.Start.click();
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
ensembleUi.Start.addEventListener('click', () => {
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
  const job = {count, finished:0, converged:0, workers:new Set(), rows:[], started:performance.now(), launching:true, histories:orders.map(()=>[new Array(graph.variables.length).fill(prior)]), chartSlots:[], maxIterations}; ensembleJob = job;
  ensembleUi.Charts.replaceChildren();
  ensembleUi.Rows.replaceChildren(); ensembleUi.Results.hidden = false;
  ui.runButton.textContent = "Pause";
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
      worker = new Worker('ensemble-worker.js?v=live-20261113'); job.workers.add(worker);
      worker.onerror = event => { event.preventDefault(); fail(event.message || 'Workerを起動できませんでした', worker); };
      worker.onmessage = event => {
        if (ensembleJob !== job) return;
        const message = event.data;
        if (message.type === 'error') { fail(message.message, worker); return; }
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
      worker.postMessage({graph,prior,damping,algorithm,order,maxIterations,delay:currentUpdateDelay()});
    } catch (error) { fail(error.message, worker); }
  });
  drawEnsembleHistories(job);
  job.launching = false;
  finishEnsemble(job);
});
window.addEventListener('pagehide', stopEnsemble);
