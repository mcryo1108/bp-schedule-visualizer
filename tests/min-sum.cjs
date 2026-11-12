const fs=require('fs'),vm=require('vm'),assert=require('assert');
const app=fs.readFileSync(require('path').join(__dirname,'../app.js'),'utf8');
const trace=fs.readFileSync(require('path').join(__dirname,'../trace.js'),'utf8');
function fn(name){let a=app.indexOf('function '+name+'('),i=app.indexOf('{',a),d=1,j=i+1;while(d){d+=(app[j]==='{')-(app[j]==='}');j++;}return app.slice(a,j);}
const c=vm.createContext({console,Map,Set,Math,document:{getElementById:()=>({addEventListener(){}})}});
vm.runInContext(`let code,bp,algorithm='min-sum';const ui={damping:{value:25}};function currentAlgorithm(){return algorithm};function currentSchedule(){return 'flooding'};`,c);
vm.runInContext(trace,c);vm.runInContext(['clamp','atanhSafe','checkMessage','stepChecks','stepVariables','variableMessage','stepSerialVariable','updatePosterior'].map(fn).join('\n'),c);
vm.runInContext(`
function setup(values,syndrome){
 const check={id:0,syndrome,variables:[]};
 code={checks:[check],variables:values.map((q,id)=>({id,checks:[check]}))};check.variables=code.variables;
 bp={prior:2,halfStep:0,stepCount:0,iteration:0,serialOrder:values.map((_,i)=>i),serialIndex:0,posterior:values.map(()=>2),cToV:new Map(values.map((_,i)=>['0:'+i,0])),vToC:new Map(values.map((q,i)=>[i+':0',q]))};
 bp.trace=new BPTrace(code,bp);
 for(let i=0;i<values.length;i++){const id=bp.trace.v.get(i+':0');bp.trace.events[id].value=values[i];}
}
`,c);
for(const values of [[2,-3,4],[-2,-2,5],[0,3,-4],[7]])for(const syndrome of [0,1])for(const schedule of ['flooding','serial']){
 c.values=values;c.syndrome=syndrome;
 vm.runInContext('setup(values,syndrome)',c);
 const input=values.slice(1),sgn=input.reduce((s,v)=>s*Math.sign(v),syndrome?-1:1),minimum=input.length?Math.min(...input.map(Math.abs)):Math.log((1+.999999)/(1-.999999));
 const raw=vm.runInContext('checkMessage(code.checks[0],code.variables[0])',c);assert.strictEqual(raw,sgn*minimum);
 vm.runInContext(schedule==='serial'?'stepSerialVariable()':'stepChecks()',c);
 assert.strictEqual(vm.runInContext("bp.cToV.get('0:0')",c),raw*.75);
 const e=vm.runInContext("bp.trace.events.find(e=>e.kind==='c2v'&&e.target==='v0')",c);
 assert.strictEqual(e.algorithm,'min-sum');assert.strictEqual(e.raw,raw);assert.strictEqual(e.signProduct,sgn);
 assert.deepStrictEqual(Array.from(e.minimumRefs),input.map((v,i)=>Math.abs(v)===minimum?vm.runInContext(`bp.trace.v.get('${i+1}:0')`,c):null).filter(x=>x!==null));
}
console.log('Min-sum: signs, zero, tied minima, degree-one cap, damping and both schedules passed (16 cases).');
