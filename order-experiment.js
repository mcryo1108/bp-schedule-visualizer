'use strict';
const $=id=>document.getElementById(id),E=OrderExperiment;
let data,current,order,history=[],edits=[],runs={},tracks=[],verified=false,runOrder=null;
let baselineKey = 'success', comparison, legend;
const names={success:'成功順序',failure:'失敗順序',custom:'編集順序'},colors={success:'#1684ad',failure:'#cf594a',custom:'#16845d'};
function error(e){$('status').textContent=e.message;$('status').className='error';}
function parseTracks(){const xs=$('tracks').value.split(/[\s,]+/).filter(Boolean).map(Number);if(!xs.length||xs.length>6||xs.some(v=>!Number.isInteger(v)||v<0||v>=data.model.n)||new Set(xs).size!==xs.length)throw Error('追跡変数は範囲内の異なる整数を1〜6個指定してください');return xs;}
function commit(next,label){E.validateOrder(next,data.model.n);history.push({order:order.slice(),edits:edits.slice()});order=next;edits.push(label);sync();}
function sync(){ $('orderText').value=order.join(',');const a=Number($('varA').value),b=Number($('varB').value);$('positions').textContent=`現在の位置（0始まり）：A=v${a} は ${order.indexOf(a)}、B=v${b} は ${order.indexOf(b)}`;$('changes').textContent=edits.join(' / ')||'順序変更なし';$('undo').disabled=!history.length;$('export').disabled=!runOrder;$('status').textContent=runOrder&&order.some((v,i)=>v!==runOrder[i])?'順序を編集しました。「再計算」で緑の軌跡を更新してください。':'';}
function setupComparison() {
  $('edit').textContent = '変更して再計算';
  $('applyText').textContent = '入力した順序で再計算';
  $('run').hidden = true;
  comparison = document.createElement('section');
  comparison.setAttribute('aria-label', '編集前後の比較');
  comparison.style.cssText = 'margin:12px 0;padding:14px;border:1px solid #c7d4df;border-radius:8px;background:#f7fafb';
  $('status').before(comparison);
  legend = document.createElement('p');
  legend.setAttribute('aria-label', 'グラフの凡例');
  $('llrCharts').before(legend);
}

function outcome(run) {
  return run.correct ? '成功' : run.matched ? '論理失敗' : 'BP不一致';
}

function renderComparison() {
  legend.innerHTML = Object.keys(runs).map(key =>
    '<strong style="color:' + colors[key] + ';margin-right:16px">● ' +
    ({success:'青：元の成功順序',failure:'赤：元の失敗順序',custom:'緑：編集した順序'})[key] + '</strong>'
  ).join('');
  const base = runs[baselineKey], edited = runs.custom;
  const title = document.createElement('strong');
  comparison.replaceChildren(title);
  if (!edited) {
    title.textContent = '比較元：' + names[baselineKey] + '。変更して再計算すると、ここに結果が出ます。';
    return;
  }
  title.textContent = names[baselineKey] + ' → 編集順序：' +
    outcome(base) + '（' + base.iterations + ' sweep）→ ' +
    outcome(edited) + '（' + edited.iterations + ' sweep）';
  const commonSweeps = Math.min(base.iterations, edited.iterations);
  const differences = new Map();
  for (let t = 1; t <= commonSweeps; t++) {
    for (let v = 0; v < data.model.n; v++) {
      if (base.hard[t][v] !== edited.hard[t][v] && !differences.has(v)) {
        differences.set(v, {t, before:base.hard[t][v], after:edited.hard[t][v]});
      }
    }
  }
  const summary = document.createElement('p');
  summary.textContent = '硬判定が異なった変数：' + differences.size + '個（両方に記録がある sweep 1〜' + commonSweeps + '）';
  comparison.append(summary);
  if (!differences.size) return;
  const list = document.createElement('div');
  list.className = 'row';
  const entries = [...differences].sort(([a], [b]) => Number(tracks.includes(b)) - Number(tracks.includes(a)));
  for (const [v, {t, before, after}] of entries.slice(0, 12)) {
    const button = document.createElement('button');
    button.className = 'secondary';
    button.textContent = 'v' + v + '：' + before + ' → ' + after + '（sweep ' + t + '）';
    button.onclick = () => {
      if (!tracks.includes(v)) {
        $('tracks').value = [...tracks.slice(0, 5), v].join(',');
        $('updateTracks').click();
        if (!verified) return;
      }
      $('sweep').value = t;
      $('inspectVariable').value = v;
      inspect();
      $('sweep').focus();
      $('sweep').scrollIntoView({block:'center'});
    };
    list.append(button);
  }
  comparison.append(list);
  if (entries.length > 12) {
    const note = document.createElement('small');
    note.textContent = '12件を表示。追跡中の変数を優先しています。';
    comparison.append(note);
  }
}
function resultTable(){let s='<table><tr><th>条件</th><th>sweep</th><th>不一致検査</th><th>論理的成功</th></tr>';for(const k of Object.keys(runs)){const r=runs[k];s+=`<tr><td style="color:${colors[k]}">${names[k]}</td><td>${r.iterations}</td><td>${r.residual.at(-1).reduce((a,b)=>a+b,0)}</td><td>${r.correct?'成功':r.matched?'不一致ではないが論理失敗':'BP不一致'}</td></tr>`;}$('outcomes').innerHTML=s+'</table>';}
function chart(target,title,series){const w=560,h=230,p={l:56,r:18,t:28,b:36};let ys=series.flatMap(s=>s.y),lo=Math.min(0,...ys),hi=Math.max(...ys);if(hi===lo)hi=lo+1;const pad=(hi-lo)*.08;hi+=pad;lo-=pad;const X=t=>p.l+t/20*(w-p.l-p.r),Y=v=>p.t+(hi-v)/(hi-lo)*(h-p.t-p.b);let svg=`<svg class="plot" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}"><text x="${p.l}" y="16" font-size="13" fill="#243142">${title}</text>`;
for(let i=0;i<5;i++){const v=lo+(hi-lo)*i/4;svg+=`<path d="M${p.l},${Y(v)}H${w-p.r}" stroke="#e0e7ee"/><text x="${p.l-6}" y="${Y(v)+4}" text-anchor="end" font-size="10">${v.toPrecision(3)}</text>`;}
for(const t of [0,2,5,10,15,20])svg+=`<text x="${X(t)}" y="${h-16}" text-anchor="middle" font-size="10">${t}</text>`;
svg+=`<path d="M${p.l},${Y(0)}H${w-p.r}" stroke="#8c9da9"/><text x="${w-74}" y="${h-2}" font-size="10">sweep</text>`;
for(const s of series){svg+=`<polyline fill="none" stroke="${colors[s.key]}" stroke-width="2" points="${s.y.map((v,t)=>`${X(t)},${Y(v)}`).join(' ')}"/>`;s.y.forEach((v,t)=>svg+=`<circle tabindex="0" data-sweep="${t}" cx="${X(t)}" cy="${Y(v)}" r="3" fill="${colors[s.key]}" aria-label="${names[s.key]} sweep ${t} 値 ${v}"><title>${names[s.key]} / sweep ${t} / ${v}</title></circle>`);}
target.innerHTML=svg+'</svg>';target.querySelectorAll('[data-sweep]').forEach(c=>{const select=()=>{$('sweep').value=c.dataset.sweep;inspect();};c.onclick=select;c.onkeydown=e=>{if(e.key==='Enter'||e.key===' ')select();};});}
function draw(){resultTable();renderComparison();chart($('residualChart'),'不一致検査数',Object.keys(runs).map(k=>({key:k,y:runs[k].residual.map(a=>a.reduce((x,y)=>x+y,0))})));$('llrCharts').innerHTML='';for(const v of tracks){const div=document.createElement('div');$('llrCharts').append(div);chart(div,`v${v} の事後LLR`,Object.keys(runs).map(k=>({key:k,y:runs[k].llr.map(a=>a[v])})));}inspect();}
function inspect(){if(!runs.success)return;const t=Number($('sweep').value),v=Number($('inspectVariable').value);$('sweepLabel').textContent=t;
let html='<div class="tableWrap"><table><tr><th>条件</th><th>LLR</th><th>硬判定</th><th>不一致検査</th></tr>';let detail='';for(const k of Object.keys(runs)){const r=runs[k],has=t<r.llr.length;html+=`<tr><td>${names[k]}</td><td>${has?r.llr[t][v]:'未観測（停止後）'}</td><td>${has?r.hard[t][v]:'—'}</td><td>${has?r.residual[t].reduce((a,b)=>a+b,0):'—'}</td></tr>`;const d=r.details.find(x=>x.sweep===t&&x.variable===v);if(d){detail+=`<details><summary>${names[k]}｜v${v} 更新位置 ${d.position}｜LLR ${d.before.toPrecision(7)} → ${d.after.toPrecision(7)}</summary><p>事前LLR ${d.prior} ＋ 受信c2vの和 = ${d.after}</p>`;for(const c of d.checks){detail+=`<details><summary>検査${c.check} → v${v}：${c.value.toPrecision(8)}｜符号 ${c.sign} × 最小値 ${c.minAbs.toPrecision(8)} × 0.625</summary><pre>${JSON.stringify(c,null,2)}</pre></details>`;}detail+=`<details><summary>更新後の送信v2c</summary><pre>${JSON.stringify(d.outgoing,null,2)}</pre></details></details>`;}}
$('values').innerHTML=html+'</table></div>';$('details').innerHTML=detail||(t===0?'初期状態。変数更新はまだありません。':'選択したsweepの更新は保存されていません。');}
function trackOptions(){const previous=$('inspectVariable').value;$('inspectVariable').innerHTML=tracks.map(v=>`<option value="${v}">v${v}</option>`).join('');if(tracks.includes(Number(previous)))$('inspectVariable').value=previous;}
function baseline(){runs={};for(const role of ['success','failure']){const ref=current.references[role],r=E.run(data.model,current,ref.order,data.config,tracks),check=E.verify(r,ref);if(!check.ok||r.correct!==(role==='success'))throw Error(`基準照合失敗：${role} 最大LLR差 ${check.maxError}。実験を停止します`);runs[role]=r;}verified=true;$('verification').className='ok';$('verification').textContent='✓ 元の2順序：全保存sweepのLLR・硬判定・残余シンドロームと一致（rtol/atol 1e-11）';$('run').disabled=false;}
function loadCase(){verified=false;$('run').disabled=true;current=data.cases[Number($('caseSelect').value)];order=current.references.success.order.slice();history=[];edits=[];runOrder=null;baselineKey='success';tracks=parseTracks();trackOptions();$('caseInfo').textContent=`shot ${current.shot}｜成功 m${current.references.success.member}（${current.references.success.iterations} sweep）／失敗 m${current.references.failure.member}（${current.references.failure.iterations} sweep）｜H ${data.model.m}×${data.model.n}、${data.model.edge_variable.length} 辺`;baseline();sync();draw();}
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
$('useSuccess').onclick=()=>startFrom('success');
$('useFailure').onclick=()=>startFrom('failure');
$('undo').onclick=()=>{const old=history.pop();if(old){order=old.order;edits=old.edits;recalculate();}};
$('edit').onclick=()=>{try{const a=Number($('varA').value),b=Number($('varB').value),mode=$('editMode').value;if(!Number.isInteger(a)||!Number.isInteger(b))throw Error('変数番号は整数で指定してください');commit(mode==='swap'?E.swap(order,a,b):E.move(order,a,b,mode==='after'),`${mode}: v${a}, v${b}`);recalculate();}catch(e){error(e);}};
$('applyText').onclick=()=>{try{const s=$('orderText').value.trim();const next=s.startsWith('[')?JSON.parse(s):s.split(/[\s,]+/).filter(Boolean).map(Number);commit(next,'全順序を直接編集');recalculate();}catch(e){error(e);}};
for(const id of ['varA','varB'])$(id).oninput=sync;
function recalculate() {
  if (!verified) return;
  try {
    runs.custom = E.run(data.model,current,order,data.config,tracks);
    runOrder = order.slice();
    sync();
    draw();
    $('status').className = '';
    $('status').textContent = '編集した順序はブラウザーで再計算した結果です。';
  } catch (e) {
    runOrder = null;
    delete runs.custom;
    sync();
    draw();
    error(e);
  }
}
$('updateTracks').onclick=()=>{try{tracks=parseTracks();trackOptions();baseline();if(runOrder)runs.custom=E.run(data.model,current,runOrder,data.config,tracks);draw();}catch(e){verified=false;$('run').disabled=true;error(e);}};
$('sweep').oninput=inspect;$('inspectVariable').onchange=inspect;
$('export').onclick=()=>{if(!runOrder)return;const payload={schema:'serial-order-experiment-result-v1',source_job:data.provenance.source_job,source_hashes:data.provenance.source_hashes,config:data.config,shot:current.shot,syndrome:current.syndrome,truth:current.truth,order:runOrder,tracks,result:runs.custom,baseline_members:{success:current.references.success.member,failure:current.references.failure.member},native_verified_custom:false,note:'Model is pairs.json. Changes may alter several dependencies; no automatic causal claim.'};const url=URL.createObjectURL(new Blob([JSON.stringify(payload)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`shot${current.shot}_order_experiment.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
setupComparison();
Promise.resolve(JSON.parse(document.getElementById('pairData').textContent)).then(d=>{data=d;$('caseSelect').innerHTML=d.cases.map((c,i)=>`<option value="${i}">shot ${c.shot}</option>`).join('');$('caseSelect').value=String(Math.max(0,d.cases.findIndex(c=>c.shot===19)));loadCase();}).catch(error);
