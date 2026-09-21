import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createDiscordSession} from '../discord-auth.mjs';

function request(handler,path,{method='GET',body,headers={}}={}){return new Promise((resolve,reject)=>{const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.url=path;req.method=method;req.headers={host:'localhost',...headers};const chunks=[];const res={writeHead(status,headers){this.status=status;this.headers=headers;return this},end(chunk){if(chunk)chunks.push(Buffer.from(chunk));const raw=Buffer.concat(chunks).toString('utf8');resolve({status:this.status,headers:this.headers,body:raw?JSON.parse(raw):null})}};Promise.resolve(handler(req,res)).catch(reject)})}

test('server rejects anonymous edits, persists Discord actor audit, and keeps raw matches when deleting',async()=>{
 const originalFetch=globalThis.fetch;let memberAllowed=true;
 globalThis.fetch=async(input,init)=>{if(String(input).startsWith('https://discord.com/api/v10/guilds/1434891063327461481/members/')){assert.equal(init.headers.Authorization,'Bot test-bot-token');return {status:memberAllowed?200:404,ok:memberAllowed}}return originalFetch(input,init)};
 const dir=await mkdtemp(join(tmpdir(),'eungck-discord-series-')),appFile=join(dir,'app.json'),matchFile=join(dir,'matches.json');
 const roles=['TOP','JUNGLE','MID','ADC','SUPPORT'],blue=roles.map((role,index)=>({id:index+1,name:`B${index}`,role})),red=roles.map((role,index)=>({id:index+6,name:`R${index}`,role}));
 const series={id:1,seriesNumber:'CKS-20260921-001',blue,red,sets:[{number:1,gameId:'',winner:'',imported:false}],finished:false};
 await writeFile(appFile,JSON.stringify({version:1,players:[],seriesState:{active:series,history:[]}}));await writeFile(matchFile,'[]');
 Object.assign(process.env,{VERCEL:'1',APP_STATE_FILE:appFile,DATA_FILE:matchFile,RUNTIME_CONFIG_FILE:join(dir,'runtime.json'),MATCH_STORE_MODE:'blob',DISCORD_OAUTH_CLIENT_ID:'123456789012345678',DISCORD_OAUTH_CLIENT_SECRET:'test-secret',DISCORD_SESSION_SECRET:'z'.repeat(48),DISCORD_OAUTH_REDIRECT_URI:'https://lol-ck.vercel.app/api/auth/discord/callback',PUBLIC_APP_URL:'https://lol-ck.vercel.app/',DISCORD_BOT_TOKEN:'test-bot-token',DISCORD_GUILD_ID:'1434891063327461481'});delete process.env.BLOB_READ_WRITE_TOKEN;
 try{const {handleRequest}=await import(`../server.mjs?discord-series-test=${Date.now()}`),overrides=Object.fromEntries([...blue,...red].map(member=>[String(member.id),member.role]));overrides['4']='SUPPORT';overrides['5']='ADC';const body={seriesId:1,setNumber:1,roleOverrides:overrides};
  const anonymous=await request(handleRequest,'/api/series-management/roles',{method:'POST',headers:{origin:'https://lol-ck.vercel.app'},body});assert.equal(anonymous.status,401);
  const anonymousLog=await request(handleRequest,'/api/series-management/logs?seriesId=1');assert.equal(anonymousLog.status,401);
  const session=createDiscordSession({id:'123456789012345678',username:'테스터'}),headers={origin:'https://lol-ck.vercel.app',cookie:`ck_discord_session=${session}`};
  const auth=await request(handleRequest,'/api/auth/me',{headers});assert.equal(auth.body.canManage,true);
  memberAllowed=false;
  const outsiderAuth=await request(handleRequest,'/api/auth/me',{headers});assert.equal(outsiderAuth.body.canManage,false);
  const outsiderEdit=await request(handleRequest,'/api/series-management/roles',{method:'POST',headers,body});assert.equal(outsiderEdit.status,403);
  const outsiderDelete=await request(handleRequest,'/api/series-management/delete',{method:'POST',headers,body:{seriesId:1}});assert.equal(outsiderDelete.status,403);
  const outsiderLog=await request(handleRequest,'/api/series-management/logs?seriesId=1',{headers});assert.equal(outsiderLog.status,403);
  memberAllowed=true;
  const saved=await request(handleRequest,'/api/series-management/roles',{method:'POST',headers,body});assert.equal(saved.status,200);assert.equal(saved.body.ok,true);
  const log=await request(handleRequest,'/api/series-management/logs?seriesId=1',{headers});assert.equal(log.status,200);assert.equal(log.body.entries[0].actor.name,'테스터');assert.equal(log.body.entries[0].action,'roles_updated');assert.equal(log.body.entries[0].after['4'],'SUPPORT');
  const state=JSON.parse(await readFile(appFile,'utf8')),tampered=structuredClone(state.seriesState);delete tampered.active.sets[0].roleOverrides;
  const bypass=await request(handleRequest,'/api/app-state',{method:'PUT',body:{players:[],seriesState:tampered}});assert.equal(bypass.status,403);
  const removed=await request(handleRequest,'/api/series-management/delete',{method:'POST',headers,body:{seriesId:1}});assert.equal(removed.status,200);
  const after=JSON.parse(await readFile(appFile,'utf8'));assert.equal(after.seriesState.active,null);assert.deepEqual(after.seriesState.deletedSeriesNumbers,['CKS-20260921-001']);assert.equal(after.seriesAuditLog.at(-1).action,'series_deleted');assert.deepEqual(JSON.parse(await readFile(matchFile,'utf8')),[]);
  const publicState=await request(handleRequest,'/api/app-state');assert.equal(publicState.status,200);assert.equal(publicState.body.seriesAuditLog,undefined);
 }finally{globalThis.fetch=originalFetch;await rm(dir,{recursive:true,force:true})}
});
