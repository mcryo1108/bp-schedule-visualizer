const pi=Object.fromEntries(['BP','Node','Step','Order','Values','Event','Compare','Refresh','Snapshot'].map(k=>[k,document.getElementById('parallelInspect'+k)]));
let inspectJob=null,inspectFocus=null;
function parallelRecordJob(){return ensembleJob||ensembleLastJob;}
function recordButton(trace,id){
  const e=trace.events[id],button=document.createElement('button');button.className='traceRef';
  button.textContent=`${e.source} → ${e.target} · ${e.value} · step ${e.step} · 更新 #${e.id}`;
  button.addEventListener('click',()=>{inspectFocus=id;drawParallelInspector();});return button;
}
function drawParallelInspector(){
  const job=parallelRecordJob();if(!job?.traces)return;
  if(inspectJob!==job){inspectJob=job;inspectFocus=null;pi.BP.replaceChildren(...job.orders.map((_,i)=>new Option(`BP ${i+1}`,i)));pi.Node.replaceChildren(...job.graph.variables.map(v=>new Option(`v${v.id} · 変数`, `v${v.id}`)),...job.graph.checks.map(c=>new Option(`c${c.id} · 検査`,`c${c.id}`)));}
  const run=Number(pi.BP.value),trace=job.traces[run],step=Math.max(0,Number(pi.Step.value)||0),node=pi.Node.value,frame=trace.frames[step],order=job.orders[run];
  pi.Step.max=String(Math.max(0,trace.frames.length-1));
  pi.Order.textContent=`BP ${run+1} · ${job.algorithm} · damping ${job.damping} · 更新順序: ${order.map(id=>`v${id}`).join(' → ')}。各変数で c→v、事後LLR、v→c の順に更新。`;
  pi.Values.replaceChildren();pi.Event.replaceChildren();
  if(!frame){pi.Values.textContent='このBPは指定stepに未到達です。「記録を更新」で最新の記録を読み込みます。';}
  else {
    const ids=[];
    if(node[0]==='v')ids.push(frame.p[Number(node.slice(1))]);
    for(const [key,id]of frame.c)if((node[0]==='v'?`v${key.split(':')[1]}`:`c${key.split(':')[0]}`)===node)ids.push(id);
    for(const [key,id]of frame.v)if((node[0]==='v'?`v${key.split(':')[0]}`:`c${key.split(':')[1]}`)===node)ids.push(id);
    for(const id of ids)pi.Values.append(recordButton(trace,id));
    const e=trace.events[inspectFocus]||trace.events[ids[0]];
    if(e){const heading=document.createElement('h3');heading.textContent=`${e.source} → ${e.target} = ${e.value}`;pi.Event.append(heading);
      const description=document.createElement('p');description.textContent=`step ${e.step} · 順序位置 ${e.position<0?'初期化':e.position+1} · 更新 #${e.id} · ${e.kind} · ${e.algorithm}`;pi.Event.append(description);
      const formula=document.createElement('p');formula.textContent=e.raw===undefined?'事後LLR = 事前LLR + 受信メッセージの和（初期値は事前LLR）':`新規計算値 ${e.raw}、以前の値 ${e.previous}。混合後 = ${e.damping} × 以前の値 + ${1-e.damping} × 新規計算値`;pi.Event.append(formula);
      const label=document.createElement('h4');label.textContent='実際に参照した値（クリックして参照元へ）';pi.Event.append(label);
      for(const ref of e.inputs){const input=trace.events[ref],hint=document.createElement('p');hint.textContent=input.step===0?'初期値':input.step===e.step?'同じスイープ内ですでに更新された値':'以前のスイープの値';pi.Event.append(hint,recordButton(trace,ref));}
      if(e.previousRef!==undefined){const label=document.createElement('h4');label.textContent='dampingで使った以前の値';pi.Event.append(label,recordButton(trace,e.previousRef));}
    }
  }
  const table=document.createElement('table');table.className='llrValuesTable';
  for(let i=-1;i<job.orders.length;i++){const row=document.createElement('tr');let values;
    if(i<0)values=['BP','更新順序内の位置','事後LLR / 検査への入力','参照元の記録'];
    else {const f=job.traces[i].frames[step];let value='未到達';if(f)value=node[0]==='v'?String(job.histories[i][step][Number(node.slice(1))]):f.v.filter(([key])=>key.split(':')[1]===node.slice(1)).map(([key,id])=>`v${key.split(':')[0]}: ${job.traces[i].events[id].value}`).join(' / ');values=[`BP ${i+1}`,node[0]==='v'?String(job.orders[i].indexOf(Number(node.slice(1)))+1):'—',value,`${job.traces[i].events.length}更新`];}
    for(const value of values){const cell=document.createElement(i<0?'th':'td');cell.textContent=value;row.append(cell);}table.append(row);
  }pi.Compare.replaceChildren(table);
}
for(const el of [pi.BP,pi.Node,pi.Step])el.addEventListener('change',()=>{inspectFocus=null;drawParallelInspector();});
pi.Refresh.addEventListener('click',drawParallelInspector);pi.Snapshot.addEventListener('click',()=>{inspectFocus=null;drawParallelInspector();});
window.addEventListener('ensemble-record-start',()=>{setTimeout(drawParallelInspector,0)});
window.addEventListener('ensemble-bit-select',event=>{
  drawParallelInspector();
  pi.BP.value=String(event.detail.run);pi.Node.value=`v${event.detail.bit}`;pi.Step.value=String(event.detail.step);
  inspectFocus=null;drawParallelInspector();
});
