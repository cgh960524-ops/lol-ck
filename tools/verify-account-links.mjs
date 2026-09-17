// Isolated local server only. Riot identity requests are mocked; no production writes.
import {mkdtemp,copyFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const source=resolve(process.argv[2]),dir=await mkdtemp(join(tmpdir(),'ck-account-links-'));
Object.assign(process.env,{VERCEL:'1',BLOB_READ_WRITE_TOKEN:'',DISCORD_WEBHOOK_URL:'',DISCORD_BOT_TOKEN:'',RIOT_API_KEY:'local-mock-only',APP_STATE_FILE:join(dir,'state.json'),DATA_FILE:join(dir,'matches.json'),RUNTIME_CONFIG_FILE:join(dir,'runtime.json')});
await copyFile(join(source,'app-state.json'),process.env.APP_STATE_FILE);await copyFile(join(source,'internal-matches.json'),process.env.DATA_FILE);
const realFetch=globalThis.fetch,riotCalls=[];
globalThis.fetch=async(url,options)=>{
 if(String(url).includes('.api.riotgames.com/')){
  riotCalls.push(String(url));assert.ok(String(url).includes('/riot/account/v1/accounts/by-riot-id/'),'no solo rank or match lookup for alternate account');
  if(String(url).includes('Missing'))return new Response('{}',{status:404});
  return Response.json({puuid:'ui-test-alt',gameName:'테스트 부캐',tagLine:'ALT'});
 }
 return realFetch(url,options);
};
const {handleRequest}=await import('../server.mjs'),server=createServer(handleRequest);await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 const get=async()=>await(await fetch(origin+'/api/app-state')).json(),before=await get(),target=before.players.find(p=>p.name==='영훈이라능')||before.players.find(p=>!p.archived),second=before.players.find(p=>!p.archived&&p.id!==target.id),originalMatches=await readFile(process.env.DATA_FILE,'utf8');
 const send=(method,body)=>fetch(origin+'/api/player-accounts',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await send('POST',{playerId:target.id,riotId:'잘못된 형식'})).status,400);assert.equal(riotCalls.length,0);
 assert.equal((await send('POST',{playerId:target.id,riotId:'테스트 부캐#ALT'})).status,200);
 const after=await get(),p=after.players.find(p=>p.id===target.id);
 for(const key of ['name','tag','puuid','tier','lp','role','secondary','ratingSeedV4','soloEvidence','ratingV2'])assert.deepEqual(p[key],target[key],key+' preserved');
 assert.deepEqual(after.seriesState,before.seriesState);assert.deepEqual(after.discordRecruitment,before.discordRecruitment);assert.equal(await readFile(process.env.DATA_FILE,'utf8'),originalMatches);
 assert.equal((await send('POST',{playerId:second.id,riotId:'테스트 부캐#ALT'})).status,409);
 assert.equal((await fetch(origin+'/api/app-state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(before)})).status,200);
 assert.ok((await get()).players.find(p=>p.id===target.id).playAliases.some(a=>a.puuid==='ui-test-alt'),'stale client cannot erase link');
 assert.equal((await send('DELETE',{playerId:target.id,puuid:'ui-test-alt'})).status,200);
 const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_PACKAGE));browser=await chromium.launch({headless:true,channel:'msedge'});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 const ready=page.waitForResponse(r=>r.url()===origin+'/api/app-state'&&r.request().method()==='GET');await page.goto(origin,{waitUntil:'domcontentloaded'});await ready;await page.waitForFunction(()=>document.querySelectorAll('.account-link-open').length>0);
 const card=page.locator('.player[data-id="'+target.id+'"]'),selected=await card.getAttribute('class');
 await card.locator('.account-link-open').focus();await page.keyboard.press('Enter');await page.locator('#aliasDialog').waitFor();assert.equal(await card.getAttribute('class'),selected,'shortcut must not toggle player selection');
 assert.ok((await page.locator('#aliasTarget').innerText()).includes(target.name));assert.equal(await page.locator('#aliasMainLabel').isVisible(),false);
 await page.locator('#aliasRiotId').fill('Missing#ALT');await page.locator('#aliasSaveBtn').click();await page.waitForFunction(()=>document.querySelector('#aliasError').textContent.includes('찾을 수 없습니다'));assert.equal(await page.locator('#aliasSaveBtn').isEnabled(),true);
 await page.locator('#aliasRiotId').fill('테스트 부캐#ALT');await page.locator('#aliasSaveBtn').click();await page.locator('.alias-remove[data-puuid="ui-test-alt"]').waitFor();await page.waitForFunction(()=>!document.querySelector('#aliasSaveBtn').disabled);
 await page.screenshot({path:join(dir,'account-link-desktop.png')});
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('#aliasDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:join(dir,'account-link-mobile-'+width+'.png')});}
 await page.locator('#closeAlias').click();await page.reload({waitUntil:'domcontentloaded'});await page.locator('.player[data-id="'+target.id+'"] .account-link-open').click();await page.locator('.alias-remove[data-puuid="ui-test-alt"]').waitFor();
 page.once('dialog',d=>d.accept());await page.locator('.alias-remove[data-puuid="ui-test-alt"]').click();await page.waitForFunction(()=>!document.querySelector('#aliasSaveBtn').disabled);assert.equal(await page.locator('.alias-remove[data-puuid="ui-test-alt"]').count(),0);
 await page.locator('#closeAlias').click();await page.locator('#openAlias').click();assert.equal(await page.locator('#aliasMainLabel').isVisible(),true);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'pass',api:'identity-only lookup, conflicts, preservation, stale state protection',ui:'card shortcut, keyboard, error, link, reload, unlink, desktop/mobile',screenshots:dir,riotCalls:riotCalls.length}));
}finally{await browser?.close();await new Promise(r=>server.close(r));globalThis.fetch=realFetch;}
