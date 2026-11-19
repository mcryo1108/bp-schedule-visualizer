'use strict';
const $=id=>document.getElementById(id),E=OrderExperiment;
let data,current,order,history=[],edits=[],runs={},tracks=[],verified=false,runOrder=null;
let baselineKey = 'failure';
const names={success:'元の成功順序',failure:'元の失敗順序',custom:'編集後の順序'},colors={success:'#1684ad',failure:'#cf594a',custom:'#16845d'};
function error(e){$('status').textContent=e.message;$('status').className='error';}
function parseTracks(){const xs=$('tracks').value.split(/[\s,]+/).filter(Boolean).map(Number);if(!xs.length||xs.length>6||xs.some(v=>!Number.isInteger(v)||v<0||v>=data.model.n)||new Set(xs).size!==xs.length)throw Error('追跡変数は範囲内の異なる整数を1〜6個指定してください');return xs;}
function commit(next,label){E.validateOrder(next,data.model.n);history.push({order:order.slice(),edits:edits.slice()});order=next;edits.push(label);sync();}
function buildInterface() {
  // The original page carries the reference data in its pairData script.
  document.querySelector('header .eyebrow')?.remove();
  document.querySelector('header h1 + p')?.remove();
  const main = document.querySelector('main');
  main.innerHTML = `
    <section class="card">
      <h2>1. 順序を編集</h2>
      <div class="row"><label>入力ショット <select id="caseSelect"></select></label>
        <strong>実際のエラー位置</strong><span id="errorNodes" class="row"></span></div>
      <p class="muted">番号は回路の誤り機構（DEM変数）。クリックすると変数Bに入ります。</p>
      <div class="row"><label>編集の開始点 <select id="origin"><option value="failure">元の失敗順序</option><option value="success">元の成功順序</option></select></label>
        <span id="member"></span></div>
      <div class="row" style="margin-top:14px"><label>変数A <input id="varA" type="number" min="0"></label>
        <select id="neighbors" aria-label="変数Bと検査を共有する変数からAを選ぶ"></select>
        <label>変数B <input id="varB" type="number" min="0"></label>
        <select id="editMode" aria-label="位置の変更方法"><option value="swap">AとBを交換</option><option value="before">AをBの直前へ</option><option value="after">AをBの直後へ</option></select>
        <button id="edit">交換して再計算</button><button id="undo" class="secondary">戻す</button></div>
      <p id="positions" class="muted"></p><p id="changes"></p>
      <details><summary>全順序を直接編集</summary><textarea id="orderText" aria-label="全更新順序" rows="3"></textarea><button id="applyText">この順序で再計算</button></details>
      <p id="status" role="status"></p></section>
    <section class="card"><h2>2. 更新順序による違い</h2>
      <p id="result" aria-live="polite"></p><div id="outcomes"></div>
      <label>グラフに表示する変数 <input id="tracks" aria-label="表示する変数番号" size="28"></label>
      <button id="updateTracks" class="secondary">表示を更新</button>
      <p class="muted">番号をカンマで区切って最大6個。各変数の判定を反復ごとに比較します。</p>
      <p id="legend"></p><p>LLR が 0 以下なら「補正する」、正なら「補正しない」。</p>
      <div id="llrCharts" class="charts"></div><details><summary>不一致検査数の推移</summary><div id="residualChart"></div></details></section>
    <section class="card"><h2>選んだ反復の値</h2><div class="row"><label>反復 <input id="sweep" type="range" min="0" max="20" value="1"></label><output id="sweepLabel"></output>
      <label>変数 <select id="inspectVariable"></select></label></div><div id="values"></div>
      <details><summary>受信メッセージの内訳</summary><div id="details"></div></details></section>
    <details class="card"><summary>実験条件・出力</summary><p>d=5・5ラウンド・SI1000 p=0.001・NMS係数0.625・上限20反復。成功はシンドロームと論理観測量の一致。</p><p id="verification"></p><button id="export" class="secondary" disabled>結果をJSON保存</button></details>`;
}

let variableChecks, checkVariables;
function initializeGraph() {
  checkVariables = [];
  variableChecks = Array.from({length:data.model.n}, () => []);
  for (let c=0; c<data.model.m; c++) {
    const variables=data.model.edge_variable.slice(data.model.row_ptr[c],data.model.row_ptr[c+1]);
    checkVariables.push(variables);
    for (const v of variables) variableChecks[v].push(c);
  }
}
function numberAt(id) {
  return $(id).value.trim() === '' ? NaN : Number($(id).value);
}
function valid(v) {return Number.isInteger(v) && v >= 0 && v < data.model.n;}
function refreshNeighbors() {
  const b=numberAt('varB');
  const neighbors=valid(b) ? new Set(variableChecks[b].flatMap(c=>checkVariables[c])) : new Set();
  neighbors.delete(b);
  const select=$('neighbors');
  select.replaceChildren(new Option('Bの近傍からAを選択',''));
  for(const v of [...neighbors].sort((a,b)=>a-b)) select.add(new Option('v'+v,v));
}
function markSelection() {
  const a=numberAt('varA'), b=numberAt('varB');
  const ready=valid(a) && valid(b) && a!==b;
  $('edit').disabled=!verified || !ready;
  $('edit').textContent=$('editMode').value === 'swap' ? '交換して再計算' : '移動して再計算';
  const checks=ready ? variableChecks[a].filter(c=>variableChecks[b].includes(c)) : [];
  $('positions').textContent=ready ? '現在の更新位置（1始まり）　v'+a+' は '+(order.indexOf(a)+1)+' 番目、v'+b+' は '+(order.indexOf(b)+1)+' 番目　｜　共有検査 '+(checks.map(c=>'c'+c).join(', ')||'なし') : '異なる2つの変数番号を選んでください。';
}
function sync() {
  $('orderText').value=order.join(',');
  $('changes').textContent=edits.join(' → ');
  $('undo').disabled=!history.length;
  $('export').disabled=!runOrder;
  $('applyText').disabled=!verified;
  $('member').textContent='メンバー '+current.references[baselineKey].member;
  markSelection();
}
function renderComparison() {
  $('legend').innerHTML=Object.keys(runs).map(k=>'<strong style="color:'+colors[k]+';margin-right:1rem">'+names[k]+'</strong>').join('');
  const edited=runs.custom, base=runs[baselineKey];
  if(!edited){$('result').textContent='同じエラー入力を、2つの保存順序で復号した結果です。';return;}
  let first=null, differing=[];
  for(let t=1;t<=Math.min(edited.iterations,base.iterations);t++){
    differing=Array.from({length:data.model.n},(_,v)=>v).filter(v=>base.hard[t][v]!==edited.hard[t][v]);
    if(differing.length){first=t;break;}
  }
  const effect=first===null ? '共通の反復では硬判定が一致。' :
    '最初の硬判定差は第'+first+'反復の '+differing.slice(0,5).map(v=>'v'+v).join('、')+(differing.length>5?' ほか':'')+'。';
  $('result').textContent='編集前 '+outcome(base)+' → 編集後 '+outcome(edited)+'。'+effect;
  return first===null ? null : {t:first,v:differing[0]};
}
function outcome(run) {return run.correct?'成功':run.matched?'論理失敗':'シンドローム不一致';}
function resultTable(){let s='<table><tr><th>条件</th><th>停止反復</th><th>不一致検査</th><th>復号結果</th></tr>';for(const k of Object.keys(runs)){const r=runs[k];s+=`<tr><td style="color:${colors[k]}">${names[k]}</td><td>${r.iterations}</td><td>${r.residual.at(-1).reduce((a,b)=>a+b,0)}</td><td>${outcome(r)}</td></tr>`;}$('outcomes').innerHTML=s+'</table>';}
function chart(target,title,series){const w=560,h=230,p={l:56,r:18,t:28,b:36};let ys=series.flatMap(s=>s.y),lo=Math.min(0,...ys),hi=Math.max(...ys);if(hi===lo)hi=lo+1;const pad=(hi-lo)*.08;hi+=pad;lo-=pad;const X=t=>p.l+t/20*(w-p.l-p.r),Y=v=>p.t+(hi-v)/(hi-lo)*(h-p.t-p.b);let svg=`<svg class="plot" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}"><text x="${p.l}" y="16" font-size="13" fill="#243142">${title}</text>`;
for(let i=0;i<5;i++){const v=lo+(hi-lo)*i/4;svg+=`<path d="M${p.l},${Y(v)}H${w-p.r}" stroke="#e0e7ee"/><text x="${p.l-6}" y="${Y(v)+4}" text-anchor="end" font-size="10">${v.toPrecision(3)}</text>`;}
for(const t of [0,2,5,10,15,20])svg+=`<text x="${X(t)}" y="${h-16}" text-anchor="middle" font-size="10">${t}</text>`;
svg+=`<path d="M${p.l},${Y(0)}H${w-p.r}" stroke="#8c9da9"/><text x="${w-74}" y="${h-2}" font-size="10">sweep</text>`;
for(const s of series){svg+=`<polyline fill="none" stroke="${colors[s.key]}" stroke-width="${s.key==='custom'?4:2}" stroke-dasharray="${s.key==='custom'?'5 5':'none'}" points="${s.y.map((v,t)=>`${X(t)},${Y(v)}`).join(' ')}"/>`;s.y.forEach((v,t)=>svg+=`<circle tabindex="0" data-sweep="${t}" cx="${X(t)}" cy="${Y(v)}" r="${s.key==='custom'?4:2.6}" stroke="${colors[s.key]}" fill="${s.key==='custom'?'none':colors[s.key]}" aria-label="${names[s.key]} sweep ${t} 値 ${v}"><title>${names[s.key]} / sweep ${t} / ${v}</title></circle>`);}
target.innerHTML=svg+'</svg>';target.querySelectorAll('[data-sweep]').forEach(c=>{const select=()=>{$('sweep').value=c.dataset.sweep;if(target.dataset.variable)$('inspectVariable').value=target.dataset.variable;inspect();};c.onclick=select;c.onkeydown=e=>{if(e.key==='Enter'||e.key===' ')select();};});}
function draw(){resultTable();renderComparison();chart($('residualChart'),'不一致検査数',Object.keys(runs).map(k=>({key:k,y:runs[k].residual.map(a=>a.reduce((x,y)=>x+y,0))})));$('llrCharts').innerHTML='';for(const v of tracks){const div=document.createElement('div');div.dataset.variable=v;$('llrCharts').append(div);chart(div,`v${v} の事後LLR（実エラー ${current.error[v]}）`,Object.keys(runs).map(k=>({key:k,y:runs[k].llr.map(a=>a[v])})));}inspect();}
function inspect(){if(!runs.success)return;const t=Number($('sweep').value),v=Number($('inspectVariable').value);$('sweepLabel').textContent=t;
let html='<div class="tableWrap"><table><tr><th>条件</th><th>LLR</th><th>硬判定</th><th>不一致検査</th></tr>';let detail='';for(const k of Object.keys(runs)){const r=runs[k],has=t<r.llr.length;html+=`<tr><td>${names[k]}</td><td>${has?r.llr[t][v]:'未観測（停止後）'}</td><td>${has?r.hard[t][v]:'—'}</td><td>${has?r.residual[t].reduce((a,b)=>a+b,0):'—'}</td></tr>`;const d=r.details.find(x=>x.sweep===t&&x.variable===v);if(d){detail+=`<details><summary>${names[k]}｜v${v} 更新位置 ${d.position}｜LLR ${d.before.toPrecision(7)} → ${d.after.toPrecision(7)}</summary><p>事前LLR ${d.prior} ＋ 受信c2vの和 = ${d.after}</p>`;for(const c of d.checks){detail+=`<details><summary>検査${c.check} → v${v}：${c.value.toPrecision(8)}｜符号 ${c.sign} × 最小値 ${c.minAbs.toPrecision(8)} × 0.625</summary><pre>${JSON.stringify(c,null,2)}</pre></details>`;}detail+=`<details><summary>更新後の送信v2c</summary><pre>${JSON.stringify(d.outgoing,null,2)}</pre></details></details>`;}}
$('values').innerHTML=html+'</table></div>';$('details').innerHTML=detail||(t===0?'初期状態。変数更新はまだありません。':'選択したsweepの更新は保存されていません。');}
function trackOptions(){const previous=$('inspectVariable').value;$('inspectVariable').innerHTML=tracks.map(v=>`<option value="${v}">v${v}</option>`).join('');if(tracks.includes(Number(previous)))$('inspectVariable').value=previous;}
function baseline(){runs={};for(const role of ['success','failure']){const ref=current.references[role],r=E.run(data.model,current,ref.order,data.config,tracks),check=E.verify(r,ref);if(!check.ok||r.correct!==(role==='success'))throw Error(`基準照合失敗：${role} 最大LLR差 ${check.maxError}。実験を停止します`);runs[role]=r;}verified=true;$('verification').className='ok';$('verification').textContent='✓ 元の2順序：全保存sweepのLLR・硬判定・残余シンドロームと一致（rtol/atol 1e-11）';}
function loadCase() {
  verified=false;
  current=data.cases[Number($('caseSelect').value)];
  const actual=current.error.flatMap((bit,v)=>bit?[v]:[]);
  const b=current.shot===20 ? 3124 : actual[0];
  const a=current.shot===20 ? 3033 : variableChecks[b].flatMap(c=>checkVariables[c]).find(v=>v!==b);
  $('errorNodes').replaceChildren();
  for(const v of actual){
    const button=document.createElement('button');
    button.className='secondary';button.textContent='v'+v;
    button.onclick=()=>{$('varB').value=v;refreshNeighbors();markSelection();};
    $('errorNodes').append(button);
  }
  $('varA').value=a;$('varB').value=b;
  $('editMode').value='swap';
  tracks=[...new Set([b,a,...actual])].slice(0,6);
  $('tracks').value=tracks.join(',');
  trackOptions();$('inspectVariable').value=b;$('sweep').value=1;
  baselineKey='failure';$('origin').value=baselineKey;
  order=current.references.failure.order.slice();
  history=[];edits=[];runOrder=null;
  $('status').textContent='';
  baseline();refreshNeighbors();sync();draw();
}
const embeddedData=JSON.parse($('pairData').textContent);
buildInterface();
$('caseSelect').onchange=()=>{try{loadCase();}catch(e){error(e);}};
function startFrom(key) {
  if (!verified) return;
  baselineKey = key;
  order = current.references[key].order.slice();
  history = [];
  edits = [];
  runOrder = null;
  delete runs.custom;
  sync();
  draw();
}
$('origin').onchange=()=>startFrom($('origin').value);
$('neighbors').onchange=()=>{if($('neighbors').value!=='')$('varA').value=$('neighbors').value;markSelection();};
$('undo').onclick=()=>{const old=history.pop();if(old){order=old.order;edits=old.edits;recalculate();}};
$('edit').onclick=()=>{try{const a=Number($('varA').value),b=Number($('varB').value),mode=$('editMode').value;if(!Number.isInteger(a)||!Number.isInteger(b))throw Error('変数番号は整数で指定してください');commit(mode==='swap'?E.swap(order,a,b):E.move(order,a,b,mode==='after'),mode==='swap' ? 'v'+a+' ↔ v'+b : 'v'+a+' を v'+b+' の'+(mode==='before'?'直前':'直後')+'へ');recalculate();}catch(e){error(e);}};
$('applyText').onclick=()=>{try{const s=$('orderText').value.trim();const next=s.startsWith('[')?JSON.parse(s):s.split(/[\s,]+/).filter(Boolean).map(Number);commit(next,'全順序を直接編集');recalculate();}catch(e){error(e);}};
$('varA').oninput=markSelection;
$('varB').oninput=()=>{refreshNeighbors();markSelection();};
$('editMode').onchange=markSelection;
function recalculate() {
  if (!verified) return;
  try {
    runs.custom = E.run(data.model,current,order,data.config,tracks);
    runOrder = order.slice();
    sync();
    draw();
    $('status').className = '';
    $('status').textContent = '';
    const first=renderComparison();
    if(first){$('sweep').value=first.t;if(tracks.includes(first.v))$('inspectVariable').value=first.v;inspect();}
  } catch (e) {
    runOrder = null;
    delete runs.custom;
    sync();
    draw();
    error(e);
  }
}
$('updateTracks').onclick=()=>{try{tracks=parseTracks();trackOptions();baseline();if(runOrder)runs.custom=E.run(data.model,current,runOrder,data.config,tracks);draw();sync();$('status').textContent='';}catch(e){error(e);}};
$('sweep').oninput=inspect;$('inspectVariable').onchange=inspect;
$('export').onclick=()=>{if(!runOrder)return;const payload={schema:'serial-order-experiment-result-v1',source_job:data.provenance.source_job,source_hashes:data.provenance.source_hashes,config:data.config,shot:current.shot,syndrome:current.syndrome,truth:current.truth,order:runOrder,tracks,result:runs.custom,baseline_members:{success:current.references.success.member,failure:current.references.failure.member},native_verified_custom:false,note:'Model is pairs.json. Changes may alter several dependencies; no automatic causal claim.'};const url=URL.createObjectURL(new Blob([JSON.stringify(payload)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`shot${current.shot}_order_experiment.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
Promise.resolve(embeddedData).then(d=>{data=d;initializeGraph();$('caseSelect').innerHTML=d.cases.map((c,i)=>`<option value="${i}">shot ${c.shot}</option>`).join('');$('caseSelect').value=String(Math.max(0,d.cases.findIndex(c=>c.shot===20)));loadCase();}).catch(error);
