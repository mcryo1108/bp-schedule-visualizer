/* Native-compatible diagnostic serial NMS replay; no damping, fixed order. */
(function(root){
'use strict';
function validateOrder(order,n){if(order.length!==n||order.some(v=>!Number.isInteger(v)||v<0||v>=n)||new Set(order).size!==n)throw Error(`順序は0〜${n-1}を重複なく全${n}個指定してください`);}
function run(model,input,order,config,tracks=[]){
 validateOrder(order,model.n);
 const {n,m,row_ptr:rp,edge_variable:ev,prior}=model,E=ev.length;
 const ve=Array.from({length:n},()=>[]),er=new Int32Array(E);
 for(let c=0;c<m;c++)for(let e=rp[c];e<rp[c+1];e++){ve[ev[e]].push(e);er[e]=c;}
 const init=prior.map(p=>Math.log((1-p)/p)),q=Float64Array.from(ev,v=>init[v]),r=new Float64Array(E),post=Float64Array.from(init),hard=new Uint8Array(n),version=new Int32Array(E),position=new Int32Array(E);
 position.fill(-1);const watched=new Set(tracks),details=[],llr=[],hardHistory=[],residual=[];
 const snapshot=()=>{let res=input.syndrome.slice();for(let c=0;c<m;c++)for(let e=rp[c];e<rp[c+1];e++)res[c]^=hard[ev[e]];llr.push(Array.from(post));hardHistory.push(Array.from(hard));residual.push(res);return res.every(v=>v===0);};
 let matched=snapshot(),iterations=0;
 if(!matched)for(let it=1;it<=config.max_iter;it++){
  for(let pos=0;pos<n;pos++){
   const v=order[pos],edges=ve[v],keep=watched.has(v);let total=init[v];const entry=keep?{sweep:it,position:pos,variable:v,prior:init[v],before:post[v],checks:[]}:null;
   for(const e of edges){
    const c=er[e];let sign=input.syndrome[c],mag=Number.MAX_VALUE,mins=[],incoming=[];
    for(let f=rp[c];f<rp[c+1];f++)if(f!==e){const x=q[f];sign+=x<=0;if(Math.abs(x)<mag){mag=Math.abs(x);mins=[f];}else if(Math.abs(x)===mag)mins.push(f);
     if(keep)incoming.push({edge:f,variable:ev[f],value:x,sourceSweep:version[f],sourcePosition:position[f],sameSweep:version[f]===it});}
    const old=r[e],next=config.alpha*(sign%2?-1:1)*mag;r[e]=next;
    // Match ldpc's prefix writes and reverse suffix additions exactly.
    q[e]=total;version[e]=it;position[e]=pos;total+=next;
    if(keep)entry.checks.push({edge:e,check:c,old,value:next,sign:sign%2?-1:1,minAbs:mag,minEdges:mins,incoming});
   }
   post[v]=total;hard[v]=total<=0;let suffix=0;
   for(let i=edges.length-1;i>=0;i--){const e=edges[i];q[e]+=suffix;version[e]=it;position[e]=pos;suffix+=r[e];}
   if(keep){entry.after=total;entry.hard=hard[v];entry.outgoing=edges.map(e=>({edge:e,check:er[e],value:q[e]}));details.push(entry);}
  }
  iterations=it;matched=snapshot();if(matched)break;
 }
 const logical= model.logical_rows.map(row=>row.reduce((s,v)=>s^hard[v],0));
 const correct=matched&&logical.every((x,i)=>x===input.truth[i]);
 return {order:order.slice(),iterations,matched,correct,llr,hard:hardHistory,residual,details};
}
function verify(result,reference){
 let maxError=0,ok=result.iterations===reference.iterations&&result.llr.length===reference.llr.length;
 if(ok)for(let t=0;t<reference.llr.length;t++){
  for(let v=0;v<reference.llr[t].length;v++){const a=result.llr[t][v],b=reference.llr[t][v];maxError=Math.max(maxError,Math.abs(a-b));if(!Number.isFinite(a)||Math.abs(a-b)>1e-11+1e-11*Math.abs(b)||result.hard[t][v]!==reference.hard[t][v])ok=false;}
  if(result.residual[t].some((x,c)=>x!==reference.residual[t][c]))ok=false;
 }
 return {ok,maxError};
}
function swap(order,a,b){validateOrder(order,order.length);const out=order.slice(),i=out.indexOf(a),j=out.indexOf(b);if(i<0||j<0)throw Error('変数番号が範囲外です');[out[i],out[j]]=[out[j],out[i]];return out;}
function move(order,a,b,after=false){validateOrder(order,order.length);if(a===b)throw Error('異なる変数を指定してください');const out=order.slice(),i=out.indexOf(a);if(i<0||!out.includes(b))throw Error('変数番号が範囲外です');out.splice(i,1);out.splice(out.indexOf(b)+(after?1:0),0,a);return out;}
const api={run,verify,validateOrder,swap,move};if(typeof module!=='undefined')module.exports=api;else root.OrderExperiment=api;
})(typeof window!=='undefined'?window:this);
