import fs from 'node:fs';
import { chromium } from 'playwright';
// 固定煙霧年齡與鏡位，交錯關閉／啟用；僅攔截此測試頁，不改遊戲或試玩視窗。
const out='.tmpshot/camera-smoke-benchmark-'+new Date().toISOString().replaceAll(':','-');fs.mkdirSync(out,{recursive:true});
let fixture=fs.readFileSync('scripts/bench-explosion-shaders.browser.js','utf8');
fixture=fixture.replace('cameraSmoke.update(ctx.scene, ctx.camera, 1 / 60, 0)','if(window.__maskEnabled) cameraSmoke.update(ctx.scene, ctx.camera, 1 / 60, 0); else cameraSmoke.reset()');
fixture=fixture.replace('cameraSmoke.render(ctx.renderer)','if(window.__maskEnabled) cameraSmoke.render(ctx.renderer)');
fixture=fixture.replace('variant: benchVariant, gpu:','mask: {...cameraSmoke.stats}, enabled:window.__maskEnabled, variant: benchVariant, gpu:');
fixture+=`
window.__smokeStressBench=(core=false)=>{
 setTab('stress');setScale(1);setAutoFly(false);
 const a=smoke.object.geometry.getAttribute('aAlpha').array,m=smoke.object.instanceMatrix.array;
 let best=-1, score=-1;
 for(let i=0;i<a.length;i++)if(m[i*16+13]>40&&m[i*16+13]<80&&a[i]>score){best=i;score=a[i];}
 ctx.camera.position.set(m[best*16+12],m[best*16+13],m[best*16+14]+(core?0:5));
 controls.target.set(m[best*16+12],m[best*16+13],m[best*16+14]-80);controls.update();
 benchCase={id:core?'stress-core':'stress-inside'};cameraSmoke.reset();
};`;
const b=await chromium.launch({channel:'chrome',headless:true});const results=[],errors=[];
try{
 const p=await b.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await p.route('**/src/tools/smoke.ts*',async r=>{const response=await r.fetch();const s=await response.text();await r.fulfill({response,body:s.replaceAll('requestAnimationFrame(frame);','')+'\n'+fixture})});
 await p.goto('http://localhost:5173/tools/smoke.html');await p.waitForFunction(()=>window.__explosionBench);
 const info=await p.evaluate(()=>window.__explosionBench.info);
 for(const spec of [{id:'handoff-near',age:.42,distance:8},{id:'smoke-near',age:.8,distance:8},{id:'handoff-far',age:.42,distance:120},{id:'stress-inside'},{id:'stress-core'}]){
  if(spec.id.startsWith('stress'))await p.evaluate(core=>window.__smokeStressBench(core),spec.id==='stress-core');else await p.evaluate(s=>window.__explosionBench.setup(s),spec);
  for(const enabled of [false,true,false,true]){
   await p.evaluate(v=>window.__maskEnabled=v,enabled);
   const r=await p.evaluate(()=>window.__explosionBench.measure('baseline',45,true));
   results.push({case:spec.id,...r});console.log(JSON.stringify({case:spec.id,enabled,gpu:r.gpu.median,cpu:r.cpu.median,mask:r.mask}));
   await p.screenshot({path:out+'/'+spec.id+'-'+enabled+'.png'});
   fs.writeFileSync(out+'/results.json',JSON.stringify({info,results,errors},null,2));
  }
 }
 if(errors.length)throw Error(errors.join('\n'));
}finally{await b.close()}
