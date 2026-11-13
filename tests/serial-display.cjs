const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(require('path').join(__dirname,'../app.js'),'utf8');
function fn(name){const start=source.indexOf('function '+name+'('),lo=source.indexOf('{',start);let depth=1,end=lo+1;while(depth){depth+=(source[end]==='{')-(source[end]==='}');end++;}return source.slice(start,end);}
const context=vm.createContext({});
vm.runInContext(`
let strokes=[],hoveredVariable=null;
const ctx={beginPath(){},arc(){},rect(){},fill(){},fillText(){},moveTo(){},lineTo(){},stroke(){strokes.push({color:this.strokeStyle,width:this.lineWidth})}};
const ui={truthToggle:{checked:false}};
const bp={active:'serial',activeVariableId:null,posterior:[2,2,2]};
const variables=[0,1,2].map(id=>({id,error:Number(id===1)}));
const code={type:'color',variables,checks:[{variables}]};
function pointForVariable(){return {mx:0,my:0,x1:0,y1:0,x2:1,y2:1}};
function pointForCheck(){return {x:0,y:0}};
function logisticColor(){return '#ffffff'};
`,context);
vm.runInContext(fn('drawVariables')+'\n'+fn('drawMessagePulse'),context);
for(const type of ['color','surface']){
 vm.runInContext(`code.type='${type}';ui.truthToggle.checked=false;bp.activeVariableId=null;strokes=[];drawVariables();drawMessagePulse()`,context);
 assert.strictEqual(vm.runInContext("strokes.filter(s=>s.color==='#e0a82e'||s.color.startsWith('rgba(224, 168, 46')).length",context),0,'Completed sweep must not highlight all nodes or edges');
 vm.runInContext('bp.activeVariableId=1;strokes=[];drawVariables();drawMessagePulse()',context);
 assert.strictEqual(vm.runInContext("strokes.filter(s=>s.color==='#e0a82e').length",context),1,'Only active node is highlighted');
}
vm.runInContext("code.type='color';bp.activeVariableId=null;ui.truthToggle.checked=true;strokes=[];drawVariables()",context);
assert.strictEqual(vm.runInContext("strokes.filter(s=>s.color==='#e0a82e').length",context),1,'True-error marker remains visible only on actual error');
console.log('Serial display: completed sweeps, individual updates, message pulses and true-error markers passed.');
