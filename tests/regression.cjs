const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=require('path').resolve(__dirname,'..');
const original=fs.readFileSync(__dirname+'/baseline-engine.js','utf8');
const changed=fs.readFileSync(root+'/app.js','utf8'),trace=fs.readFileSync(root+'/trace.js','utf8');
function fn(s,name){const start=s.indexOf('function '+name+'('),lo=s.indexOf('{',start);let depth=1,end=lo+1;while(depth){depth+=(s[end]==='{')-(s[end]==='}');end++;}return s.slice(start,end);}
const names=['clamp','colorPoint','isColorPlaquette','createColorCode','createBpState','atanhSafe','updatePosterior','stepChecks','stepVariables','checkMessage','variableMessage','stepSerialVariable'];
function context(s,instrumented){const c=vm.createContext({console,Map,Set,Math,document:{querySelectorAll:()=>[],getElementById:()=>({addEventListener(){}})}});vm.runInContext(`let code,bp,llrFollowLatest;const SQRT3_OVER_2=Math.sqrt(3)/2;let schedule='flooding',reverse=false;const ui={damping:{value:25}};function currentAlgorithm(){return 'sum-product'};function currentSchedule(){return schedule};function createSerialOrder(n){const a=Array.from({length:n},(_,i)=>i);return reverse?a.reverse():a}`,c);if(instrumented)vm.runInContext(trace,c);vm.runInContext(names.map(n=>fn(s,n)).join('\n'),c);return c;}
const a=context(original,false),b=context(changed,true);let cases=0,events=0;
for(const d of [3,5,7])for(const p of [.01,.12])for(const damp of [0,25,90])for(const schedule of ['flooding','serial'])for(const reverse of [false,true]){
const init=`schedule=${JSON.stringify(schedule)};reverse=${reverse};ui.damping.value=${damp};code=createColorCode(${d},0);for(const v of code.variables)v.error=Number(v.id===0||v.id===1);for(const c of code.checks)c.syndrome=c.variables.reduce((a,v)=>a^v.error,0);bp=createBpState(code,${p});`;
vm.runInContext(init,a);vm.runInContext(init,b);
for(let step=1;step<=80;step++){
const update=`if(schedule==='serial')stepSerialVariable();else if(bp.halfStep===0)stepChecks();else stepVariables();bp.stepCount++;bp.history.push(bp.posterior.slice());`;
vm.runInContext(update,a);vm.runInContext(`bp.trace.begin(${step},bp.iteration,schedule,${damp}/100,bp.serialOrder);`+update+'bp.trace.snapshot(bp);',b);
const output=`JSON.stringify({p:bp.posterior,c:[...bp.cToV],v:[...bp.vToC]})`;
assert.strictEqual(vm.runInContext(output,b),vm.runInContext(output,a),`${d} ${p} ${damp} ${schedule} ${reverse} ${step}`);
}
vm.runInContext(`for(const e of bp.trace.events){for(const input of e.inputs){if(input.ref>=e.id||bp.trace.events[input.ref].value!==input.value)throw Error('bad reference')};if(e.previousRef!==undefined&&bp.trace.events[e.previousRef].value!==e.previous)throw Error('bad previous');if(e.kind==='posterior'||e.kind==='v2c'){const raw=e.inputs.reduce((s,i)=>s+i.value,0);if((e.kind==='posterior'?e.value:e.raw)!==raw)throw Error('bad sum');}if(e.kind==='c2v'){let product=e.syndrome?-1:1;for(const i of e.inputs)product*=Math.tanh(i.value/2);if(product!==e.product||2*atanhSafe(product)!==e.raw)throw Error('bad check');}if(e.previousRef!==undefined&&e.previous*e.damping+e.raw*(1-e.damping)!==e.value)throw Error('bad damping');}for(const f of bp.trace.frames){for(const [key,id] of [...f.c,...f.v])if(bp.trace.events[id].step>f.step)throw Error('future value');}`,b);
events+=vm.runInContext('bp.trace.events.length',b);cases++;
}
console.log(JSON.stringify({cases,stepsPerCase:80,eventsValidated:events,bitExactWithOriginal:true,allReferencesAndCalculationsValid:true}));
// Round-trip the complete log and verify archived viewing cannot mutate it.
vm.runInContext(`const payload={format:'bp-full-trace',version:1,graph:graphArchive(),prior:bp.prior,events:bp.trace.events,frames:bp.trace.frames,history:bp.history,traceMeta:bp.history.map((_,i)=>({step:i,iteration:i,phase:'serial',schedule:'serial',damping:.9,activeVariable:'',unsatisfied:0}))};validateTrace(JSON.parse(JSON.stringify(payload)));`,b);
vm.runInContext(`ui.codeModes=[];ui.scheduleModes=[];ui.distance={};ui.errorRate={};function setRunning(){};function render(){};`,b);
(async()=>{
  const before=vm.runInContext('JSON.stringify(bp.history)',b);
  await vm.runInContext(`importTrace({text:async()=>JSON.stringify(payload)})`,b);
  assert.strictEqual(vm.runInContext('JSON.stringify(bp.history)',b),before);
  assert.strictEqual(vm.runInContext('bp.trace.readOnly',b),true);
  vm.runInContext(`let rejected=false;const bad=JSON.parse(JSON.stringify(payload));bad.events[2].inputs[0].ref=999999;try{validateTrace(bad)}catch(e){rejected=true}if(!rejected)throw Error('corruption was accepted')`,b);
  console.log('Full-log JSON round-trip and invalid-reference rejection passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
