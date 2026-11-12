const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=require('path').resolve(__dirname,'..');
const original=fs.readFileSync(__dirname+'/baseline-engine.js','utf8');
const changed=fs.readFileSync(root+'/app.js','utf8'),trace=fs.readFileSync(root+'/trace.js','utf8');
function fn(s,name){const start=s.indexOf('function '+name+'('),lo=s.indexOf('{',start);let depth=1,end=lo+1;while(depth){depth+=(s[end]==='{')-(s[end]==='}');end++;}return s.slice(start,end);}
const names=['clamp','colorPoint','isColorPlaquette','createColorCode','createBpState','atanhSafe','updatePosterior','stepChecks','stepVariables','checkMessage','variableMessage','stepSerialVariable'];
function context(s,instrumented){const c=vm.createContext({console,Map,Set,Math,document:{querySelectorAll:()=>[],getElementById:()=>({addEventListener(){}})}});vm.runInContext(`let code,bp,llrFollowLatest;const SQRT3_OVER_2=Math.sqrt(3)/2;let schedule='flooding',reverse=false;const ui={damping:{value:25}};function currentAlgorithm(){return 'sum-product'};function currentSchedule(){return schedule};function createSerialOrder(n){const a=Array.from({length:n},(_,i)=>i);return reverse?a.reverse():a}`,c);if(instrumented)vm.runInContext(trace,c);vm.runInContext(names.map(n=>fn(s,n)).join('\n'),c);return c;}

const actual=context(changed,true),reference=context(changed,true);
vm.runInContext(fn(changed,'estimateErrors')+'\n'+fn(changed,'estimateSyndrome')+'\n'+fn(changed,'bpStep'),actual);
let cases=0;
for(const d of [3,5,7])for(const reverse of [false,true])for(const algorithm of ['sum-product','min-sum']){
 for(const c of [actual,reference]){
  vm.runInContext(`currentAlgorithm=()=>${JSON.stringify(algorithm)};schedule='serial';reverse=${reverse};code=createColorCode(${d},0);for(const v of code.variables)v.error=Number(v.id===0||v.id===1);for(const check of code.checks)check.syndrome=check.variables.reduce((a,v)=>a^v.error,0);bp=createBpState(code,.12);`,c);
 }
 for(let step=1;step<=5;step++){
  vm.runInContext('bpStep(false)',actual);
  vm.runInContext('bp.trace.begin(bp.stepCount+1,bp.iteration,schedule,.25,bp.serialOrder);for(let i=0;i<code.variables.length;i++)stepSerialVariable();bp.stepCount++;',reference);
  const values='JSON.stringify({posterior:bp.posterior,c:[...bp.cToV],v:[...bp.vToC]})';
  assert.strictEqual(vm.runInContext(values,actual),vm.runInContext(values,reference));
  assert.strictEqual(vm.runInContext('bp.stepCount',actual),step);
  assert.strictEqual(vm.runInContext('bp.iteration',actual),step);
  assert.strictEqual(vm.runInContext('bp.serialIndex',actual),0);
  assert.strictEqual(vm.runInContext('bp.history.length',actual),step+1);
  assert.strictEqual(vm.runInContext('bp.trace.frames.length',actual),step+1);
  vm.runInContext('if(bp.traceMeta.at(-1).unsatisfied!==estimateSyndrome(estimateErrors()).filter((s,i)=>s!==code.checks[i].syndrome).length)throw Error("hard decision mismatch")',actual);
 }
 cases++;
}
console.log(`Serial full-sweep steps: ${cases} cases, 5 sweeps each; messages, hard decisions, history and trace frames passed.`);
