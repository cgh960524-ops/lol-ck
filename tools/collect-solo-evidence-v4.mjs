import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {makeSoloEvidence} from '../rating-policy.js';
const dir=resolve(process.argv[2]),limit=Number(process.argv[3]||4),state=JSON.parse(await readFile(join(dir,'app-state.json'),'utf8'));
let report;try{report=JSON.parse(await readFile(join(dir,'solo-evidence-collection.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;report={origin:'https://lol-ck.vercel.app',rows:[],failures:[]};}
const done=new Set([...report.rows,...report.failures].map(x=>x.id));
for(const p of state.players.filter(p=>!p.archived&&!done.has(p.id)).slice(0,limit)){
 try{
  const r=await fetch(report.origin+'/api/player?riotId='+encodeURIComponent(p.name+p.tag)+'&matches=40',{signal:AbortSignal.timeout(55000)});
  if(!r.ok)throw new Error('HTTP '+r.status);
  const data=await r.json();if(data.puuid!==p.puuid)throw new Error('Account identity mismatch');
  const evidence=makeSoloEvidence({...data,sampledGames:data.recentGames});
  report.rows.push({id:p.id,puuid:p.puuid,name:p.name,evidence});
  console.log(JSON.stringify({name:p.name,tier:data.tier,role:evidence.roles.primary,secondary:evidence.roles.secondary,seasonGames:evidence.seasonGames,sample:evidence.sampledGames}));
 }catch(e){report.failures.push({id:p.id,name:p.name,error:e.message});console.log(JSON.stringify({name:p.name,error:e.message}));if(/401|403|429/.test(e.message)){await writeFile(join(dir,'solo-evidence-collection.json'),JSON.stringify(report,null,2));break;}}
 await writeFile(join(dir,'solo-evidence-collection.json'),JSON.stringify(report,null,2));
}
await writeFile(join(dir,'verified-solo-evidence.json'),JSON.stringify(report.rows,null,2));
console.log(JSON.stringify({collected:report.rows.length,failed:report.failures.length,remaining:state.players.filter(p=>!p.archived&&!new Set([...report.rows,...report.failures].map(x=>x.id)).has(p.id)).length}));
