const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=require('path').resolve(__dirname,'..');
const original=fs.readFileSync(__dirname+'/baseline-engine.js','utf8');
const changed=fs.readFileSync(root+'/app.js','utf8'),trace=fs.readFileSync(root+'/trace.js','utf8');
function fn(s,name){const start=s.indexOf('function '+name+'('),lo=s.indexOf('{',start);let depth=1,end=lo+1;while(depth){depth+=(s[end]==='{')-(s[end]==='}');end++;}return s.slice(start,end);}
const names=['clamp','colorPoint','isColorPlaquette','createColorCode','createBpState','atanhSafe','updatePosterior','stepChecks','stepVariables','checkMessage','variableMessage','stepSerialVariable'];
function context(s,instrumented){const c=vm.createContext({console,Map,Set,Math,document:{querySelectorAll:()=>[],getElementById:()=>({addEventListener(){}})}});vm.runInContext(`let code,bp,llrFollowLatest;const SQRT3_OVER_2=Math.sqrt(3)/2;let schedule='flooding',reverse=false;const ui={damping:{value:25}};function currentAlgorithm(){return 'sum-product'};function currentSchedule(){return schedule};function createSerialOrder(n){const a=Array.from({length:n},(_,i)=>i);return reverse?a.reverse():a}`,c);if(instrumented)vm.runInContext(trace,c);vm.runInContext(names.map(n=>fn(s,n)).join('\n'),c);return c;}

const engine=context(changed,true);
vm.runInContext(['createSurfaceCode','createLdpcCode','createBb144Code','shuffled','graphArchive'].map(n=>fn(changed,n)).join('\n'),engine);
vm.runInContext("ui.boundaryModes=[{checked:true,value:'vertical'}]",engine);
const worker=vm.createContext({self:{},performance});
vm.runInContext(fs.readFileSync(root+'/ensemble-worker.js','utf8'),worker);
let cases=0;
for(const generator of ['createColorCode(3,0)','createColorCode(5,0)','createColorCode(7,0)','createSurfaceCode(3,0)','createLdpcCode(3,0)','createBb144Code(0)'])for(const algorithm of ['sum-product','min-sum'])for(const damp of [0,25,90]){
 vm.runInContext(`currentAlgorithm=()=>${JSON.stringify(algorithm)};schedule='serial';ui.damping.value=${damp};code=${generator};for(const v of code.variables)v.error=Number(v.id===0||v.id===1);for(const c of code.checks)c.syndrome=c.variables.reduce((a,v)=>a^v.error,0);bp=createBpState(code,.12);bp.serialOrder=code.variables.map(v=>v.id).reverse();`,engine);
 const payload=JSON.parse(vm.runInContext(`JSON.stringify({graph:graphArchive(),prior:bp.prior,damping:${damp}/100,algorithm:currentAlgorithm(),order:bp.serialOrder,maxIterations:5,stopOnConvergence:false})`,engine));
 worker.payload=payload;
 const result=vm.runInContext('runSerialBP(payload)',worker);
 const expected=[Array.from(vm.runInContext('bp.posterior',engine))];
 for(let step=1;step<=5;step++){
  vm.runInContext(`bp.trace.begin(${step},bp.iteration,schedule,${damp}/100,bp.serialOrder);for(let i=0;i<code.variables.length;i++)stepSerialVariable()`,engine);
  expected.push(Array.from(vm.runInContext('bp.posterior',engine)));
 }
 assert.deepStrictEqual(JSON.parse(JSON.stringify(result.history)),expected,`${generator} ${algorithm} ${damp}`);
 const g=payload.graph;
 const unsat=g.checks.filter(c=>c.variables.reduce((s,id)=>s^Number(result.posterior[id]<0),0)!==c.syndrome).length;
 assert.strictEqual(result.unsatisfied,unsat); cases++;
}
worker.payload={graph:{variables:[{id:0,checks:[0]}],checks:[{id:0,variables:[0],syndrome:1}]},prior:2,damping:0,algorithm:'sum-product',order:[0],maxIterations:50};
assert.strictEqual(vm.runInContext('runSerialBP(payload).iterations',worker),1);
worker.payload.order=[0,0];assert.throws(()=>vm.runInContext('runSerialBP(payload)',worker));
console.log(`Parallel worker: ${cases} conditions match main serial BP bit-for-bit for every sweep; early completion and invalid-order checks passed.`);
