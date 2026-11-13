/* Parallel random serial schedules, with a frozen input shared by all workers. */
const ensembleUi = Object.fromEntries(['Count','Iterations','Start','Stop','Status','Settings','Results','Summary','Rows','Charts'].map(key => [key, document.getElementById(`ensemble${key}`)]));
let ensembleJob = null, ensembleLastJob = null;
let ensembleFocus = null;
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
  const bitIds=Array.from({length:history[0].length},(_,i)=>i).sort((a,b)=>Number(a===ensembleFocus)-Number(b===ensembleFocus));
  for(const bit of bitIds) {
    const points=history.map((row,i)=>`${48+i/Math.max(1,maxIterations)*577},${90-row[bit]/bound*70}`).join(' ');
    element('polyline',{points,fill:'none',stroke:`hsl(${bit*137.5%360},65%,38%)`,'stroke-width':bit===ensembleFocus?3:1.4,opacity:ensembleFocus===null||bit===ensembleFocus?1:.12,'data-bit':bit,'stroke-linejoin':'round'});
  }
  return svg;
}
function drawEnsembleOrders(job) {
  let wrap=document.getElementById('ensembleOrderComparison');
  if(!wrap){wrap=document.createElement('div');wrap.id='ensembleOrderComparison';ensembleUi.Charts.before(wrap);}
  if(wrap.dataset.focus===String(ensembleFocus)&&wrap._job===job)return;
  wrap._job=job;wrap.dataset.focus=String(ensembleFocus);wrap.replaceChildren();
  const title=document.createElement('h3');title.textContent='更新順序を比較（左から順に更新）';wrap.append(title);
  const help=document.createElement('p');help.textContent='同じ色は同じノードです。ノードをクリックすると、全BPでその位置とLLRの線を強調します。順序は各BPで全スイープ共通です。';wrap.append(help);
  const clear=document.createElement('button');clear.textContent='強調を解除';clear.onclick=()=>{ensembleFocus=null;ensembleBitSelect.value='';drawEnsembleHistories(job)};wrap.append(clear);
  const scroller=document.createElement('div');scroller.className='ensembleOrderScroll';
  const table=document.createElement('table');table.className='ensembleOrderMatrix';
  const head=table.createTHead().insertRow();for(const text of ['BP',...job.orders[0].map((_,i)=>String(i+1)+'番'), '選択ノードの位置']){const th=document.createElement('th');th.textContent=text;head.append(th);}
  const body=table.createTBody();job.orders.forEach((order,i)=>{const row=body.insertRow();row.insertCell().textContent='BP '+(i+1);order.forEach(bit=>{const cell=row.insertCell();const b=document.createElement('button');b.textContent='v'+bit;b.style.background=`hsl(${bit*137.5%360},65%,90%)`;b.className=ensembleFocus===bit?'orderSelected':ensembleFocus===null?'':'orderDim';b.setAttribute('aria-pressed',String(ensembleFocus===bit));b.onclick=()=>{ensembleFocus=bit;ensembleBitSelect.value=String(bit);drawEnsembleHistories(job)};cell.append(b);});row.insertCell().textContent=ensembleFocus===null?'—':`v${ensembleFocus}: ${order.indexOf(ensembleFocus)+1}番目`;});
  scroller.append(table);wrap.append(scroller);
}
function drawEnsembleHistories(job) {
  drawEnsembleOrders(job);
  let bound = 1;
  for (const history of job.histories) for (const row of history) for (const value of row) bound = Math.max(bound, Math.abs(value));
  job.chartSlots.forEach((slot,i) => {
    slot.replaceChildren(ensembleChart(job.histories[i],bound,job.maxIterations));
    const text=document.createElement('p'); text.className='ensembleFocusValue';
    const values=job.histories[i].at(-1);
    text.textContent=ensembleFocus===null?'全ビットを表示':`v${ensembleFocus} · LLR = ${values[ensembleFocus]} · ハード判定 ${values[ensembleFocus]<0?1:0} · sweep ${job.histories[i].length-1}`;
    slot.append(text);
  });
}
ui.runButton.addEventListener('click', event => {
  if (currentSchedule() !== 'serial' || currentSerialOrderMode() !== 'random') return;
  event.stopImmediatePropagation();
  if (ensembleJob?.manual) {
    ensembleJob.manual=false; ui.runButton.textContent='Pause';
    ensembleUi.Status.textContent='並列実行を再開';
    for(const worker of ensembleJob.workers) worker.postMessage({type:'resume'});
  } else if (ensembleJob) pauseEnsemble(); else ensembleUi.Start.click();
}, true);
function finishEnsemble(job) {
  if (ensembleJob !== job || job.workers.size || job.launching) return;
  drawEnsembleHistories(job);
  ui.runButton.textContent = "Run";
  ensembleJob = null; ensembleUi.Start.disabled = false; ensembleUi.Stop.disabled = true;
  ensembleUi.Status.textContent = `完了 ${job.finished}/${job.count}本 · シンドローム一致 ${job.converged}本 · 経過 ${((performance.now()-job.started)/1000).toFixed(2)}秒`;
  ensembleUi.Summary.textContent = `${job.description} · ${ensembleUi.Status.textContent}`;
}
function cancelEnsemble() {
  const job = ensembleJob; if (!job) return;
  for (const worker of job.workers) worker.terminate(); job.workers.clear();
  for (const row of job.rows) if (row.dataset.pending) { row.children[1].textContent = '中止'; delete row.dataset.pending; }
  finishEnsemble(job); ensembleUi.Status.textContent = `中止 · 完了 ${job.finished}/${job.count}本`; ensembleUi.Summary.textContent = `${job.description} · ${ensembleUi.Status.textContent}`;
}
function pauseEnsemble() {
  const job=ensembleJob; if(!job) return;
  job.manual=true; ui.runButton.textContent='Run';
  for(const worker of job.workers) worker.postMessage({type:'pause'});
  ensembleUi.Status.textContent='一時停止 · Runで再開 / BP stepで1スイープ更新';
}
ensembleUi.Stop.addEventListener('click', pauseEnsemble);
document.getElementById('ensembleHistoryRun').addEventListener('click',()=>ui.runButton.click());
document.getElementById('ensembleHistoryStop').addEventListener('click',pauseEnsemble);
document.getElementById('ensembleHistoryStep').addEventListener('click',()=>ui.stepButton.click());
const ensembleBitSelect=document.getElementById('ensembleFocusBit');
function refreshEnsembleFocus() {
  const job=ensembleJob||ensembleLastJob; if(!job) return;
  const selected=ensembleBitSelect.value;
  const bit=hoveredVariable?.id ?? (selected==='' ? (llrUi.bit.value===''?null:Number(llrUi.bit.value)) : Number(selected));
  const next=bit!==null&&bit<job.histories[0][0].length?bit:null;
  if(next===ensembleFocus) return;
  ensembleFocus=next; drawEnsembleHistories(job);
}
ensembleBitSelect.addEventListener('change',refreshEnsembleFocus);
llrUi.bit.addEventListener('change',refreshEnsembleFocus);
canvas.addEventListener('mousemove',refreshEnsembleFocus);
canvas.addEventListener('mouseleave',refreshEnsembleFocus);
canvas.addEventListener('click',refreshEnsembleFocus);
for(const button of [ui.resetButton,ui.newButton]) button.addEventListener('click',cancelEnsemble);

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
  const job = {count, finished:0, converged:0, workers:new Set(), rows:[], started:performance.now(), launching:true, manual, pending:new Set(), histories:orders.map(()=>[new Array(graph.variables.length).fill(prior)]), chartSlots:[], traces:orders.map(()=>({events:[],frames:[]})), maxIterations, graph, prior, damping, algorithm, orders}; ensembleJob = job; ensembleLastJob=job;
  ensembleBitSelect.replaceChildren(new Option("全ビット", ""),...graph.variables.map(v=>new Option(`v${v.id}`,String(v.id)))); ensembleFocus=null;
  ensembleUi.Charts.replaceChildren();
  ensembleUi.Rows.replaceChildren(); ensembleUi.Results.hidden = false;
  ui.runButton.textContent = manual ? "Run" : "Pause";
  ensembleUi.Start.disabled = true; ensembleUi.Stop.disabled = false;
  ensembleUi.Status.textContent = `${count}本を並列実行中`;
  ensembleUi.Summary.textContent = `${graph.label || graph.type} · n=${graph.variables.length} · ${algorithm} · p=${ui.errorRate.value/100} · damping=${damping} · 最大${maxIterations} sweep · 真の誤り: ${graph.variables.filter(v=>v.error).map(v=>`v${v.id}`).join(', ') || 'なし'}（開始時の条件を固定）`;
  job.description = ensembleUi.Summary.textContent;
  window.dispatchEvent(new Event("ensemble-record-start"));
  orders.forEach((order, index) => {
    const card = document.createElement('section'); card.className='ensembleHistoryCard';
    const heading = document.createElement('h3'); heading.textContent=`BP ${index+1} · LLR history`;
    const slot = document.createElement('div');
    const schedule = document.createElement('p'); schedule.className='ensembleCardOrder'; schedule.setAttribute('aria-label',`BP ${index+1}の更新順序`);
    schedule.textContent='更新順序: '+order.map(id=>`v${id}`).join(' → ');
    card.append(heading,slot,schedule); ensembleUi.Charts.append(card); job.chartSlots.push(slot);

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
      worker = new Worker('ensemble-worker.js?v=records-20261113'); job.workers.add(worker); job.pending.add(worker);
      worker.onerror = event => { event.preventDefault(); fail(event.message || 'Workerを起動できませんでした', worker); };
      worker.onmessage = event => {
        if (ensembleJob !== job) return;
        const message = event.data;
        if (message.type === 'paused') return;
        if (message.type === 'error') { fail(message.message, worker); return; }
        if(message.traceDelta) {
          const trace=job.traces[index];
          for(const e of message.traceDelta.events) trace.events.push(e);
          for(const f of message.traceDelta.frames) trace.frames.push(f);
        }
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
        row.children[1].textContent = result.converged ? (result.iterations===maxIterations?'最大反復に到達（一致）':'シンドローム一致') : '最大反復に到達';
        delete row.dataset.pending; job.finished++; if (result.converged) job.converged++;
        drawEnsembleHistories(job);
        const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.textContent = 'このBPのJSONを保存';
        exportButton.addEventListener('click', () => {
          const url = URL.createObjectURL(new Blob([JSON.stringify({format:'bp-random-ensemble',version:1,graph,prior,damping,algorithm,maxIterations,...result,trace:job.traces[index]})],{type:'application/json'}));
          const link = document.createElement('a'); link.href = url; link.download = `random-bp-${index+1}.json`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
        }); details.append(exportButton);
        worker.terminate(); job.workers.delete(worker); finishEnsemble(job);
      };
      worker.postMessage({graph,prior,damping,algorithm,order,maxIterations,manual,stopOnConvergence:document.getElementById('ensembleEarlyStop').checked,delay:currentUpdateDelay()});
    } catch (error) { fail(error.message, worker); }
  });
  drawEnsembleHistories(job);
  job.launching = false;
  finishEnsemble(job);
}
window.addEventListener('pagehide', cancelEnsemble);

document.getElementById('ensembleSaveAll').addEventListener('click',()=>{
  const job=ensembleJob||ensembleLastJob; if(!job) return;
  const payload={format:'bp-ensemble-full-trace',version:2,graph:job.graph,prior:job.prior,damping:job.damping,algorithm:job.algorithm,maxIterations:job.maxIterations,runs:job.histories.map((history,i)=>({id:i+1,order:job.orders[i],history,trace:job.traces[i],iterations:history.length-1}))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`bp-ensemble-histories-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
