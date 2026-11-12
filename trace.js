/* Every value is versioned. Dependencies always point to values that already
 * existed when the update ran, including the previous damped value. */
class BPTrace {
  constructor(graph, state) {
    this.events = []; this.frames = []; this.c = new Map(); this.v = new Map();
    this.p = []; this.step = 0; this.iteration = 0; this.phase = 'initial';
    this.schedule = currentSchedule(); this.damping = Number(ui.damping.value)/100;
    this.readOnly = false;
    this.prior = this.add({kind:'prior', label:'事前LLR', value:state.prior, inputs:[]});
    for (const variable of graph.variables) {
      for (const check of variable.checks) {
        const ck=`${check.id}:${variable.id}`, vk=`${variable.id}:${check.id}`;
        this.c.set(ck, this.add({kind:'initial-c', source:`c${check.id}`, target:`v${variable.id}`, label:`c${check.id} → v${variable.id}`, value:0, inputs:[]}));
        this.v.set(vk, this.add({kind:'initial-v', source:`v${variable.id}`, target:`c${check.id}`, label:`v${variable.id} → c${check.id}`, value:state.prior, inputs:[this.term(this.prior,'事前LLR')]}));
      }
      this.p[variable.id] = this.add({kind:'initial-p', target:`v${variable.id}`, label:`v${variable.id} のLLR`, value:state.prior, inputs:[this.term(this.prior,'事前LLR')]});
    }
    this.snapshot(state);
  }
  add(record) {
    const id=this.events.length;
    this.events.push({id,step:this.step,iteration:this.iteration,phase:this.phase,schedule:this.schedule,damping:this.damping,algorithm:currentAlgorithm(),...record});
    return id;
  }
  term(id, role) {return {ref:id,value:this.events[id].value,role};}
  begin(step, iteration, schedule, damping, order) {
    this.step=step;this.iteration=iteration;this.schedule=schedule;this.damping=damping;
    this.phase=schedule==='serial'?'serial':(bp.halfStep===0?'checks':'variables');
    this.order=order.slice();
  }
  posterior(variable, state, value) {
    const inputs=[this.term(this.prior,'事前LLR')];
    for(const c of variable.checks) inputs.push(this.term(this.c.get(`${c.id}:${variable.id}`),`c${c.id} から受信`));
    this.p[variable.id]=this.add({kind:'posterior',target:`v${variable.id}`,label:`v${variable.id} のLLR`,value,inputs});
  }
  snapshot(state) {
    this.frames.push({step:state.stepCount,iteration:state.iteration,phase:state.active||'initial',
      schedule:this.schedule,algorithm:currentAlgorithm(),damping:this.damping,order:(state.serialOrder||[]).slice(),
      c:[...this.c],v:[...this.v],p:this.p.slice(),end:this.events.length});
  }
}
function traceSetC(check, target, key, previous, raw, damping) {
  const t=bp.trace, inputs=[];
  let product=check.syndrome?-1:1;
  for(const v of check.variables) if(v.id!==target.id) {
    const term=t.term(t.v.get(`${v.id}:${check.id}`),`v${v.id} → c${check.id}`);
    if(currentAlgorithm()==='sum-product'){term.tanhHalf=Math.tanh(term.value/2); product*=term.tanhHalf;}
    else {term.sign=Math.sign(term.value);term.absolute=Math.abs(term.value);}
    inputs.push(term);
  }
  const previousRef=t.c.get(key);
  const value=previous*damping+raw*(1-damping);
  bp.cToV.set(key,value);
  t.c.set(key,t.add({kind:'c2v',source:`c${check.id}`,target:`v${target.id}`,label:`c${check.id} → v${target.id}`,
    value,raw,previous,previousRef,damping,syndrome:check.syndrome,product,
    clampedProduct:clamp(product,-.999999,.999999),
    signProduct:inputs.reduce((sign,i)=>sign*Math.sign(i.value),check.syndrome?-1:1),
    minAbs:inputs.length?Math.min(...inputs.map(i=>Math.abs(i.value))):null,
    minimumRefs:inputs.length?inputs.filter(i=>Math.abs(i.value)===Math.min(...inputs.map(j=>Math.abs(j.value)))).map(i=>i.ref):[],inputs}));
}
function traceSetV(variable, target, key, previous, raw, damping) {
  const t=bp.trace, inputs=[t.term(t.prior,'事前LLR')];
  for(const c of variable.checks) if(c.id!==target.id) inputs.push(t.term(t.c.get(`${c.id}:${variable.id}`),`c${c.id} → v${variable.id}`));
  const previousRef=t.v.get(key),value=previous*damping+raw*(1-damping);
  bp.vToC.set(key,value);
  t.v.set(key,t.add({kind:'v2c',source:`v${variable.id}`,target:`c${target.id}`,label:`v${variable.id} → c${target.id}`,
    value,raw,previous,previousRef,damping,inputs}));
}
let traceSelection='v0',traceFocus=null,traceStack=[],traceSession=null,traceRenderKey='';
const te=id=>document.getElementById(id);
const tx=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=value=>Number(Number(value).toPrecision(8)).toString();
function traceButton(t,id,role='') {
  const e=t.events[id];
  return `<button class="traceRef" data-ref="${id}" title="値 ${e.value} の計算元を開く">${tx(role||e.label)} <strong>${num(e.value)}</strong><small>step ${e.step} · 更新 #${id}</small></button>`;
}
function traceCurrentFrame(){return bp.trace.frames[Number(llrUi.cursor.value)]||bp.trace.frames.at(-1);}
function traceDefaultFocus(frame) {
  const n=Number(traceSelection.slice(1));
  return traceSelection[0]==='v'?frame.p[n]:new Map(frame.c).get(`${n}:${code.checks[n].variables[0].id}`);
}
function renderTraceInspector() {
  const t=bp.trace,frame=traceCurrentFrame();
  if(traceSession!==t){traceSession=t;traceFocus=null;traceStack=[];traceRenderKey='';
    if(!code.variables.some(v=>`v${v.id}`===traceSelection)&&!code.checks.some(c=>`c${c.id}`===traceSelection))traceSelection='v0';
    te('traceNode').innerHTML=code.variables.map(v=>`<option value="v${v.id}">v${v.id} · 量子ビット</option>`).join('')+code.checks.map(c=>`<option value="c${c.id}">c${c.id} · 検査</option>`).join('');
    te('traceNode').value=traceSelection;
  }
  te('traceCount').textContent=`${t.events.length.toLocaleString()} 更新記録 · ${t.frames.length} 時点${t.readOnly?' · 保存記録を閲覧中':''}`;
  const key=`${frame.step}|${traceSelection}|${traceFocus}|${t.events.length}`;
  if(key===traceRenderKey)return;traceRenderKey=key;
  te('traceBack').disabled=!traceStack.length;
  const cMap=new Map(frame.c),vMap=new Map(frame.v),n=Number(traceSelection.slice(1));
  let rows='';
  if(traceSelection[0]==='v') {
    const v=code.variables[n];
    rows=`<h3>v${n} · step ${frame.step}</h3><p class="traceSub">この時点で保持している値。各参照先には、最後に更新された時刻を表示します。</p>`+traceButton(t,frame.p[n],'事後LLR')+'<h4>受信したメッセージ</h4>';
    rows+=v.checks.map(c=>traceButton(t,cMap.get(`${c.id}:${n}`))).join('');
    rows+='<h4>送信したメッセージ</h4>'+v.checks.map(c=>traceButton(t,vMap.get(`${n}:${c.id}`))).join('');
  } else {
    const c=code.checks[n];
    rows=`<h3>c${n} · step ${frame.step} · シンドローム ${c.syndrome}</h3><h4>受信したメッセージ</h4>`+c.variables.map(v=>traceButton(t,vMap.get(`${v.id}:${n}`))).join('');
    rows+='<h4>送信したメッセージ</h4>'+c.variables.map(v=>traceButton(t,cMap.get(`${n}:${v.id}`))).join('');
  }
  te('traceSnapshot').innerHTML=rows;
  const id=traceFocus===null?traceDefaultFocus(frame):traceFocus,e=t.events[id];
  let formula='';
  if(e.kind==='c2v' && e.algorithm==='min-sum')formula=`<p class="traceFormula">r = (−1)<sup>s</sup> × ∏ sign(q) × min |q| （補正係数1）</p><p>送信先 ${tx(e.target)} の入力を除外。シンドローム s = ${e.syndrome}。<br>シンドロームを含む符号積 = ${num(e.signProduct)}<br>${e.minAbs===null?'ほかの入力がない次数1検査：有限上限 '+num(2*atanhSafe(1))+' を使用':`最小絶対値 = ${num(e.minAbs)}<br>最小値の入力 = ${e.minimumRefs.map(ref=>tx(t.events[ref].label)).join('、')}（同値はすべて表示）`}<br>新規計算値 = ${num(e.raw)}</p>`;
  else if(e.kind==='c2v')formula=`<p class="traceFormula">r = 2 atanh[ (−1)<sup>s</sup> ∏ tanh(q / 2) ]</p><p>シンドローム s = ${e.syndrome}。送信先 ${tx(e.target)} からの入力は除外。</p><p>積 = ${num(e.product)}<br>数値計算用の制限後 = ${num(e.clampedProduct)}<br>新規計算値 = ${num(e.raw)}</p>`;
  else if(e.kind==='v2c')formula=`<p class="traceFormula">q = 事前LLR + Σ ほかの検査からの受信値</p><p>送信先 ${tx(e.target)} からの入力は除外。<br>新規計算値 = ${num(e.raw)}</p>`;
  else if(e.kind==='posterior')formula='<p class="traceFormula">L = 事前LLR + Σ 全検査からの受信値</p>';
  else formula='<p>初期化時の値です。事前LLRは全量子ビットで共通、初期の検査→量子ビットメッセージは0です。</p>';
  let damping='';
  if(e.previousRef!==undefined)damping=`<h4>dampingで混ぜた値</h4><p class="traceFormula">${num(e.damping)} × ${num(e.previous)} + ${num(1-e.damping)} × ${num(e.raw)} = ${num(e.value)}</p>${traceButton(t,e.previousRef,'以前のメッセージ')}`;
  const updateFrame=t.frames.find(f=>f.step===e.step);
  const orderInfo=e.schedule==='serial' && updateFrame?.order?.length
    ? `<p class="traceSub">このスイープのノード順序：${updateFrame.order.map(v=>`v${v}`).join(' → ')}。各ノードで検査→変数、事後LLR、変数→検査の順に計算します。</p>`
    : '<p class="traceSub">フロッディング：検査→変数をまとめて更新し、次のstepで変数→検査をまとめて更新します。事後LLRは各stepで計算します。</p>';
  te('traceDetail').innerHTML=`<div class="traceEventTitle"><h3>${tx(e.label)}</h3><strong>${num(e.value)}</strong></div><p class="traceSub">step ${e.step} · ${tx(e.phase)} · ${tx(e.schedule)} · ${e.algorithm==='min-sum'?'ミンサム':'サムプロダクト'} · 更新 #${e.id}<br>反復開始番号 ${e.iteration} · damping ${num(e.damping)}</p>${orderInfo}${formula}<p class="traceSub">記録した値：${tx(e.value)}</p><h4>実際に参照した値</h4>${e.inputs.map(i=>traceButton(t,i.ref,i.role)+(i.absolute!==undefined?`<p class="traceTerm">符号 = ${num(i.sign)} · 絶対値 = ${num(i.absolute)}${e.minimumRefs.includes(i.ref)?' · 最小値':''}</p>`:i.tanhHalf===undefined?'':`<p class="traceTerm">tanh(${num(i.value)} / 2) = ${num(i.tanhHalf)}</p>`)).join('')}${damping}<p class="traceSub">参照先を押すと、その値が計算された時点へ遡れます。</p>`;
}
function drawTraceOverlay() {
  if(!bp.trace||traceFocus===null)return;
  const e=bp.trace.events[traceFocus]; if(!e)return;
  const point=node=>{if(!node)return null;const id=Number(node.slice(1));if(node[0]==='c')return pointForCheck(code.checks[id]);const p=pointForVariable(code.variables[id]);return {x:p.mx,y:p.my};};
  const b=point(e.target); if(!b)return;
  ctx.save();ctx.strokeStyle='#8b4cb3';ctx.lineWidth=3;ctx.setLineDash([5,4]);
  const middle=point(e.source)||b;
  const line=(a,b)=>{if(a&&b){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}};
  for(const input of e.inputs){const origin=bp.trace.events[input.ref].source; if(origin)line(point(origin),middle);}
  if(e.source)line(middle,b);
  ctx.setLineDash([]);ctx.beginPath();ctx.arc(b.x,b.y,19,0,2*Math.PI);ctx.stroke();ctx.restore();
}
function traceGraphClick(event) {
  if(!event.shiftKey)return false;
  const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*layout.width/rect.width,y=(event.clientY-rect.top)*layout.height/rect.height;
  let best=null,d=23;
  for(const c of code.checks){const p=pointForCheck(c),q=Math.hypot(x-p.x,y-p.y);if(q<d){d=q;best=`c${c.id}`;}}
  for(const v of code.variables){const p=pointForVariable(v),q=Math.hypot(x-p.mx,y-p.my);if(q<d){d=q;best=`v${v.id}`;}}
  if(!best)return false;traceSelection=best;te('traceNode').value=best;traceFocus=null;traceStack=[];
  if(best[0]==='v')llrUi.bit.value=best.slice(1);render();return true;
}
function graphArchive(){
  const {variables,checks,...meta}=code;
  return {...meta,variables:variables.map(v=>{const {checks,...rest}=v;return {...rest,checks:checks.map(c=>c.id)};}),checks:checks.map(c=>({...c,variables:c.variables.map(v=>v.id)}))};
}
function exportTrace(){
  const payload={format:'bp-full-trace',version:1,exportedAt:new Date().toISOString(),algorithm:bp.trace.events[0].algorithm||'sum-product',algorithmDetails:'min-sum: scale 1, degree-one cap 2*atanh(0.999999); sum-product: tanh product clamp ±0.999999; damping on both directions',graph:graphArchive(),
    prior:bp.prior,events:bp.trace.events,frames:bp.trace.frames,history:bp.history,traceMeta:bp.traceMeta};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload)],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download=`bp-full-trace-${new Date().toISOString().replaceAll(':','-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function validateTrace(a){
  if(a.format!=='bp-full-trace'||a.version!==1||!Array.isArray(a.events)||!Array.isArray(a.frames)||!a.frames.length||a.frames.length!==a.history?.length||a.frames.length!==a.traceMeta?.length)throw Error('対応する全記録ファイルではありません。');
  if(!a.graph||!['color','surface','ldpc','bb144'].includes(a.graph.type)||!Array.isArray(a.graph.variables)||!Array.isArray(a.graph.checks)||!Number.isFinite(a.prior))throw Error('符号の記録が不正です。');
  const n=a.graph.variables.length,m=a.graph.checks.length;
  if(!n||!m)throw Error('ノードがありません。');
  const edge=new Set();
  a.graph.variables.forEach((v,i)=>{if(v.id!==i||!Array.isArray(v.checks)||v.checks.some(c=>!Number.isInteger(c)||c<0||c>=m))throw Error('接続が不正です。');for(const c of v.checks)edge.add(`${c}:${i}`);});
  a.graph.checks.forEach((c,i)=>{if(c.id!==i||!Array.isArray(c.variables)||c.variables.some(v=>!Number.isInteger(v)||v<0||v>=n||!edge.has(`${i}:${v}`)))throw Error('接続が不正です。');});
  const allowed=new Set(['prior','initial-c','initial-v','initial-p','c2v','v2c','posterior']);
  a.events.forEach((e,i)=>{if(e.id!==i||!allowed.has(e.kind)||!Number.isFinite(e.value)||!Array.isArray(e.inputs)||e.inputs.some(x=>!Number.isInteger(x.ref)||x.ref<0||x.ref>=i||a.events[x.ref].value!==x.value)||(e.previousRef!==undefined&&(!Number.isInteger(e.previousRef)||e.previousRef<0||e.previousRef>=i)))throw Error('参照元の記録が不正です。');});
  a.frames.forEach((f,i)=>{if(f.step!==i||!Array.isArray(f.p)||f.p.length!==n||!Array.isArray(f.c)||!Array.isArray(f.v)||!a.history[i]||a.history[i].length!==n||a.history[i].some(x=>!Number.isFinite(x))||[...f.p,...f.c.map(x=>x[1]),...f.v.map(x=>x[1])].some(id=>!Number.isInteger(id)||id<0||id>=a.events.length)||f.p.some((id,j)=>a.events[id].value!==a.history[i][j]))throw Error('時刻ごとの値が不正です。');});
  return a;
}
async function importTrace(file){
  try {
    const a=validateTrace(JSON.parse(await file.text()));setRunning(false);
    const g=a.graph;
    code={...g,variables:g.variables.map(v=>({...v,checks:[]})),checks:g.checks.map(c=>({...c,variables:[]}))};
    for(const c of code.checks)c.variables=g.checks[c.id].variables.map(id=>code.variables[id]);
    for(const v of code.variables)v.checks=g.variables[v.id].checks.map(id=>code.checks[id]);
    for(const input of ui.codeModes)input.checked=input.value===code.type;
    ui.distance.value=String(code.size);ui.errorRate.value=String(100/(1+Math.exp(a.prior)));
    const last=a.frames.at(-1);for(const input of ui.scheduleModes)input.checked=input.value===last.schedule;
    for(const input of document.querySelectorAll('input[name="algorithmMode"]'))input.checked=input.value===(last.algorithm||'sum-product');
    ui.damping.value=String(last.damping*100);
    bp=createBpState(code,1/(1+Math.exp(a.prior)));bp.prior=a.prior;bp.history=a.history;bp.traceMeta=a.traceMeta;
    bp.posterior=a.history.at(-1).slice();bp.stepCount=last.step;bp.iteration=last.iteration;
    bp.trace.events=a.events;bp.trace.frames=a.frames;bp.trace.readOnly=true;
    llrFollowLatest=true;traceSession=null;te('traceImportStatus').textContent='保存記録を開きました。リセットすると現在の条件で新しい計算を開始します。';render();
  }catch(error){te('traceImportStatus').textContent=`開けませんでした：${error.message}`;}
}
te('traceNode').addEventListener('change',()=>{traceSelection=te('traceNode').value;traceFocus=null;traceStack=[];if(traceSelection[0]==='v')llrUi.bit.value=traceSelection.slice(1);render();});
te('traceBack').addEventListener('click',()=>{traceFocus=traceStack.pop()??null;render();});
te('traceHome').addEventListener('click',()=>{traceFocus=null;traceStack=[];render();});
te('traceExport').addEventListener('click',exportTrace);
te('traceImport').addEventListener('change',event=>{if(event.target.files[0])importTrace(event.target.files[0]);event.target.value='';});
te('llrCursor').addEventListener('input',()=>{traceFocus=null;traceStack=[];traceRenderKey='';});
te('llrBit').addEventListener('change',()=>{if(te('llrBit').value!==''){traceSelection=`v${te('llrBit').value}`;te('traceNode').value=traceSelection;traceFocus=null;render();}});
te('traceDetail').addEventListener('click',inspectReference);
te('traceSnapshot').addEventListener('click',inspectReference);
function inspectReference(event){const button=event.target.closest('[data-ref]');if(!button)return;traceStack.push(traceFocus);traceFocus=Number(button.dataset.ref);setRunning(false);render();}

te('traceShowAll').addEventListener('click',()=>{llrUi.bit.value='';render();});
