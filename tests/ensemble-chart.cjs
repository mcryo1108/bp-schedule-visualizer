const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../ensemble.js'),'utf8');
const start=source.indexOf('function ensembleLineHit('),end=source.indexOf('function ensembleChart(');
const c=vm.createContext({Math,CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}}});
vm.runInContext('let ensembleFocus=null;'+source.slice(start,end),c);
c.history=[[0,2],[1,2],[2,2]];
const hit=(x,y)=>vm.runInContext(`ensembleLineHit(history,4,2,${x},${y},3)`,c);
assert.strictEqual(hit(336.5,72.5).bit,0); // v0 at sweep 1.
assert.strictEqual(hit(336.5,72.5).sweep,1);
assert.strictEqual(hit(336.5,55).bit,1);
assert.strictEqual(hit(600,150),null); // Empty plot does not choose a node.
c.history=[[1,1]];
vm.runInContext('ensembleFocus=1',c);
assert.strictEqual(hit(48,72.5).bit,1); // Keep selected node at a coincident point.
assert.strictEqual(hit(300,72.5),null); // No imaginary extension beyond recorded data.
vm.runInContext(`
let calls=[]; const ensembleBitSelect={value:''}; const llrUi={bit:{value:''}};
const code={variables:[{id:1}]}; const job={};
function render(){calls.push('render');}
function drawEnsembleHistories(value){if(value!==job)throw Error('wrong job');calls.push('draw');}
const window={dispatchEvent:e=>calls.push(e.detail)};
selectEnsembleLine(job,2,{bit:1,sweep:7,llr:-1});
if(ensembleBitSelect.value!=='1'||llrUi.bit.value!=='1')throw Error('selection not synchronized');
if(calls[2].bit!==1||calls[2].run!==2||calls[2].step!==7)throw Error('inspector selection lost');
`,c);
console.log('Chart hit-test: sampled values, blank area, single-frame/overlap and node/inspector synchronization passed.');
