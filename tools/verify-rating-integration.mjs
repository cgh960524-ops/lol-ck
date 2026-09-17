import {readFile,writeFile,mkdtemp,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {buildStyleProfiles} from '../player-style.js';
const source=resolve(process.argv[2]||'../backup/2026-09-16T20-51-42-666Z-before-role-power-v2'),dir=await mkdtemp(join(tmpdir(),'ck-rating-v2-test-'));
Object.assign(process.env,{VERCEL:'1',BLOB_READ_WRITE_TOKEN:'',DISCORD_WEBHOOK_URL:'',DISCORD_BOT_TOKEN:'',UPLOADER_TOKEN:'local-rating-test-only',APP_STATE_FILE:join(dir,'app-state.json'),DATA_FILE:join(dir,'internal-matches.json'),RUNTIME_CONFIG_FILE:join(dir,'runtime.json')});
await copyFile(join(source,'app-state.json'),process.env.APP_STATE_FILE);await copyFile(join(source,'internal-matches.json'),process.env.DATA_FILE);
const {handleRequest}=await import('../server.mjs'),server=createServer(handleRequest);
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 const state=await (await fetch(origin+'/api/app-state')).json(),matches=JSON.parse(await readFile(process.env.DATA_FILE,'utf8')),series=JSON.stringify(state.seriesState),version=state.ratingAlgorithm.version;
 assert.equal(version,CKRating.VERSION);assert.equal(state.players.length,37);
 const p9=state.players.find(p=>p.name==='9 Things'),expected=structuredClone(p9.ratingV2);
 assert.equal(p9.ratingV2.soloRestorationEnded,true);for(const p of state.players)for(const h of p.ratingHistory||[])if(h.internalGamesBefore>=30)assert.equal(h.priorChange,0);
 assert.equal((await fetch(origin+'/api/ratings/recalculate',{method:'POST'})).status,401);
 const res=await fetch(origin+'/api/ratings/recalculate',{method:'POST',headers:{Authorization:'Bearer local-rating-test-only'}});assert.equal(res.status,200);
 const stored=JSON.parse(await readFile(process.env.APP_STATE_FILE,'utf8'));assert.equal(stored.players.find(p=>p.id===p9.id).ratingSeedV22.solo,1450);
 const toku=stored.players.find(p=>p.name.replace(/\s/g,'')==='토쿠');assert.ok(toku.ratingV2.overall<2600);assert.ok(toku.ratingV2.roles.SUPPORT.rating<toku.ratingV2.roles.TOP.rating);assert.equal(toku.ratingV2.provisional,true);
 const stale=structuredClone(state);for(const p of stale.players){delete p.ratingSeedV2;delete p.ratingSeedV21;p.ratingSeedV22={policy:'skill-baseline-v1',solo:9999};p.ratingSeedV4={policy:'matchup-v4',solo:9999};p.manualPowerFloor=9999;p.internalRating=9999;p.ratingV2={overall:9999};}
 const put=await fetch(origin+'/api/app-state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(stale)});assert.equal(put.status,200);
 const after=await(await fetch(origin+'/api/app-state')).json();assert.deepEqual(after.players.find(p=>p.id===p9.id).ratingV2,expected);assert.equal(JSON.stringify(after.seriesState),series);assert.deepEqual(JSON.parse(await readFile(process.env.DATA_FILE,'utf8')),matches);
 for(const asset of ['/','/rating-engine.js','/rating-observation.js','/rating-policy.js','/rating-reference.js','/rating-evidence.css','/player-radar.js','/player-style.js','/player-radar.css','/client.js'])assert.equal((await fetch(origin+asset)).status,200,asset);
 if(process.env.PLAYWRIGHT_PACKAGE){
  const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_PACKAGE));browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(origin+'/api/')&&r.status()>=400)errors.push(r.url()+': '+r.status())});
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin,{waitUntil:'domcontentloaded'});await page.locator('[data-stats-id="'+p9.id+'"]').first().click();await page.locator('.player-radar').last().waitFor();
  assert.equal(await page.locator('.player-radar').count(),2);
  const style=buildStyleProfiles(state.players,matches,state.seriesState,CKRating).get(p9.id,'SUPPORT');
  assert.deepEqual(await page.locator('.radar-metric b').allTextContents(),style.metrics.map(m=>String(m.index)));
  await page.locator('[data-radar-role="ADC"]').click();assert.ok((await page.locator('[data-style-plot]').innerText()).includes('관측 없음'));assert.equal(await page.locator('[data-style-plot] .radar-area').count(),0);
  await page.locator('[data-radar-role="SUPPORT"]').click();
  await page.locator('.rating-evidence').scrollIntoViewIfNeeded();await page.screenshot({path:join(dir,'radar-desktop.png')});
  for(const width of [390,320]){
   await page.setViewportSize({width,height:1000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const clipping=await page.locator('.player-radar').evaluateAll(svgs=>svgs.flatMap(svg=>{const b=svg.getBoundingClientRect();return [...svg.querySelectorAll('text')].filter(t=>{const r=t.getBoundingClientRect();return r.left<b.left-1||r.right>b.right+1;}).map(t=>t.textContent);}));
   assert.deepEqual(clipping,[],'radar label clipping '+width);
   assert.ok(await page.locator('.rating-evidence').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'radar overflow '+width);
   await page.screenshot({path:join(dir,'radar-mobile-'+width+'.png')});
   await page.locator('.style-radar').scrollIntoViewIfNeeded();await page.screenshot({path:join(dir,'style-mobile-'+width+'.png')});
  }
  await page.setViewportSize({width:1440,height:1100});
  await page.locator('.rating-role-details summary').click();await page.locator('.rating-method summary').click();await page.locator('.rating-role').last().waitFor();
  assert.equal(await page.locator('.rating-role').count(),5);assert.ok((await page.locator('.rating-roles').innerText()).includes(String(expected.roles.SUPPORT.rating).replace(/\B(?=(\d{3})+(?!\d))/g,',')));
  await page.locator('.power-history-toggle').click();await page.locator('.rating-history-select').selectOption('SUPPORT');assert.ok((await page.locator('.power-history-detail').innerText()).includes(expected.roles.SUPPORT.rating.toLocaleString()));
  assert.ok((await page.locator('.rating-roles').innerText()).includes('잠정'));assert.ok((await page.locator('.rating-roles').innerText()).includes('맞상대 누적 수행'));assert.ok((await page.locator('.power-explain').innerText()).includes('솔랭 점수 복원은 없습니다'));assert.ok(!(await page.locator('.power-explain').innerText()).includes('하한 9,999점 적용'));
  assert.ok((await page.locator('.rating-roles').innerText()).includes('표본 부족 추가 감점 없음'));
  await page.locator('.rating-history-select').selectOption('TOP');assert.ok((await page.locator('.power-history-detail').innerText()).includes(expected.roles.TOP.rating.toLocaleString()));
  await page.locator('.rating-events summary').click();await page.screenshot({path:join(dir,'rating-desktop.png')});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(dir,'rating-mobile.png')});
  assert.equal(await page.locator('.rating-roles').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ui:'pass',screenshots:[join(dir,'rating-desktop.png'),join(dir,'rating-mobile.png')]}));
 }
 console.log(JSON.stringify({api:'pass',version,players:after.players.length,gameIdsUnchanged:true,seriesUnchanged:true,immutableSeeds:true,staleClientCannotOverride:true,player9:expected,artifacts:dir}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
