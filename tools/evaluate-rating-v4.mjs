import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import '../rating-engine.js';
const dir=resolve(process.argv[2]),state=JSON.parse(await readFile(join(dir,'app-state.json'),'utf8')),matches=JSON.parse(await readFile(join(dir,'internal-matches.json'),'utf8'));
const ps=structuredClone(state.players),original=JSON.stringify({matches,series:state.seriesState}),result=CKRating.recalculate(ps,matches,state.seriesState),once=JSON.stringify(ps);
CKRating.recalculate(ps,matches,state.seriesState);assert.equal(JSON.stringify(ps),once);assert.equal(JSON.stringify({matches,series:state.seriesState}),original);
for(const p of ps){const old=state.players.find(x=>x.id===p.id);for(const key of ['ratingSeedV2','ratingSeedV21','ratingSeedV22','internalGames','internalKills','internalDeaths','internalAssists','internalChampions'])assert.deepEqual(p[key],old[key]);for(const h of p.ratingHistory){assert.ok(Math.abs(h.roleChange)<=61);assert.equal(h.priorChange,0);assert.equal(h.outcomeChange,0);if(h.quality<.65)assert.equal(h.personalChange,0);}}
const oldHistory=new Map(state.players.flatMap(p=>p.ratingHistory.map(h=>[p.id+'|'+h.gameId,h]))),newHistory=new Map(ps.flatMap(p=>p.ratingHistory.map(h=>[p.id+'|'+h.gameId,h]))),find=CKRating.playerResolver(ps),games=[];
for(const m of result.matches.filter(m=>m.gameCreation>CKRating.reference.cutoff)){
 const rows=m.participants.map(mp=>({mp,p:find(mp)}));if(rows.length!==10||rows.some(x=>!x.p))continue;
 const both=rows.map(x=>({...x,a:oldHistory.get(x.p.id+'|'+m.gameId),b:newHistory.get(x.p.id+'|'+m.gameId)}));if(both.some(x=>!x.a||!x.b))continue;
 const blue=both.find(x=>x.mp.teamId===100),pairs=both.filter(x=>x.mp.teamId===100&&x.b.quality>=.65&&x.b.opponentId!=null).map(x=>({role:x.b.role,before:Math.tanh((x.a.evidenceRoleBefore-x.a.opponentEvidencePower)/650),after:x.b.expectedPerformance,actual:x.b.actualMatchup}));
 games.push({gameId:m.gameId,cluster:m.seriesId,win:Number(blue.mp.win),before:blue.a.expected,after:blue.b.expected,pairs});
}
const avg=a=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length),brier=(rows,key)=>avg(rows.map(x=>(x[key]-x.win)**2)),mae=key=>avg(games.flatMap(g=>g.pairs).map(x=>Math.abs(x[key]-x.actual)));
const clusters=[...new Set(games.map(x=>x.cluster))].map(c=>games.filter(x=>x.cluster===c)),diff=[];let seed=731;const rand=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
for(let i=0;i<2000;i++){const sample=clusters.flatMap(()=>clusters[Math.floor(rand()*clusters.length)]);diff.push(brier(sample,'after')-brier(sample,'before'));}diff.sort((a,b)=>a-b);
const validation={laterGames:games.length,clusters:clusters.length,brierBefore:brier(games,'before'),brierAfter:brier(games,'after'),brierDifference95:[diff[50],diff[1949]],matchupMarginMAEBefore:mae('before'),matchupMarginMAEAfter:mae('after'),limitations:'Retrospective development comparison, not independent validation. Current/frozen registration evidence may postdate matches. Margin labels are statistical proxies, not true skill. Existing late period was reused; no accuracy improvement claim.'};
const rows=ps.filter(p=>!p.archived).map(p=>{const old=state.players.find(x=>x.id===p.id);return {id:p.id,name:p.name,before:old.ratingV2.overall,after:p.ratingV2.overall,roleEvidenceVerified:p.ratingV2.roleEvidenceVerified,roles:Object.fromEntries(CKRating.ROLES.map(role=>[role,{before:old.ratingV2.roles[role].rating,after:p.ratingV2.roles[role].rating,games:p.ratingV2.roles[role].games,provisional:p.ratingV2.roles[role].provisional,learning:p.ratingV2.roles[role].learningFactor}]))};});
const report={version:CKRating.VERSION,diagnostics:result.diagnostics,validation,rows};await writeFile(join(dir,'rating-v4-comparison.json'),JSON.stringify(report,null,2));
await writeFile(join(dir,'롤력-V4-변경표.md'),'# 맞상대 수행 V4 변경표\n\n특정 선수 목표 점수는 없습니다. 과거 시즌/포지션 API 근거가 없는 선수는 기존 등록값 기반 잠정 초기 추정을 사용합니다.\n\n| 닉네임 | 전체 전 → 후 | 탑 전 → 후 | 정글 전 → 후 | 미드 전 → 후 | 원딜 전 → 후 | 서폿 전 → 후 |\n|---|---:|---:|---:|---:|---:|---:|\n'+rows.map(r=>`| ${r.name} | ${r.before} → ${r.after} | ${Object.values(r.roles).map(x=>`${x.before} → ${x.after}${x.provisional?'*':''}`).join(' | ')} |`).join('\n')+'\n\n별표는 잠정입니다.\n\n## 후반 경기 비교와 한계\n\n```json\n'+JSON.stringify(validation,null,2)+'\n```\n');
console.log(JSON.stringify({version:CKRating.VERSION,diagnostics:result.diagnostics,validation,rows:rows.map(r=>({name:r.name,before:r.before,after:r.after}))},null,2));
