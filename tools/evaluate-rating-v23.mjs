import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import '../rating-engine.js';
const dir=resolve(process.argv[2]),read=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const state=await read('app-state.json'),matches=await read('internal-matches.json'),raw=JSON.stringify({matches,series:state.seriesState}),players=structuredClone(state.players);
const identities=players.map(p=>({id:p.id,name:p.name,puuid:p.puuid,playAliases:p.playAliases}));
CKRating.recalculate(players,matches,state.seriesState);
const once=JSON.stringify(players);CKRating.recalculate(players,matches,state.seriesState);assert.equal(JSON.stringify(players),once);
assert.equal(JSON.stringify({matches,series:state.seriesState}),raw);
assert.deepEqual(players.map(p=>({id:p.id,name:p.name,puuid:p.puuid,playAliases:p.playAliases})),identities);
for(const p of players){
 const old=state.players.find(x=>x.id===p.id);for(const key of ['ratingSeedV2','ratingSeedV21','ratingSeedV22'])if(old[key])assert.deepEqual(p[key],old[key]);
 for(const h of p.ratingHistory)if(h.internalGamesBefore>=30){assert.equal(h.priorChange,0);assert.equal(h.soloRetention,0);}
 if(p.internalGames>=30){assert.equal(p.ratingV2.soloRetention,0);const played=Object.values(p.ratingV2.roles).filter(r=>r.games);assert.ok(p.ratingV2.overall>=Math.min(...played.map(r=>r.rating))-1&&p.ratingV2.overall<=Math.max(...played.map(r=>r.rating))+1);}
}
const rows=players.filter(p=>!p.archived).map(p=>{const old=state.players.find(x=>x.id===p.id);return {name:p.name,before:old.ratingV2.overall,after:p.ratingV2.overall,delta:p.ratingV2.overall-old.ratingV2.overall,games:p.internalGames,comparisons:p.ratingV2.comparisonCount,soloRetention:p.ratingV2.soloRetention,roles:Object.fromEntries(CKRating.ROLES.map(r=>[r,{before:old.ratingV2.roles[r].rating,after:p.ratingV2.roles[r].rating,games:p.ratingV2.roles[r].games,comparisons:p.ratingV2.roles[r].comparisons,restorationRemaining:p.ratingV2.roles[r].soloRetention}]))};});
const diagnostic=ps=>{const hs=ps.flatMap(p=>p.ratingHistory||[]).filter(h=>h.opponentId&&h.quality>0);return {samples:hs.length,performanceMAE:hs.reduce((s,h)=>s+Math.abs(h.performance-h.expectedPerformance),0)/hs.length,brier:hs.reduce((s,h)=>s+(Number(h.win)-h.expected)**2,0)/hs.length};};
const audit=players.filter(p=>['2611130932135616','bebebbi'].includes(p.name)).map(p=>({name:p.name,missing:p.ratingHistory.filter(h=>h.comparisonStatus!=='matched').map(h=>({gameId:h.gameId,role:h.role,status:h.comparisonStatus})),matchups:p.ratingHistory.filter(h=>h.opponentId).map(h=>({gameId:h.gameId,role:h.role,opponent:players.find(o=>String(o.id)===String(h.opponentId))?.name,personal:h.personalChange,prior:h.priorChange,priorRemaining:h.soloRetention,opponentPower:h.opponentPower}))}));
const report={version:CKRating.VERSION,players:players.length,matches:matches.length,diagnostics:{before:diagnostic(state.players),after:diagnostic(players),note:'Historical replay only, not independent accuracy validation.'},rows,audit};
await writeFile(join(dir,'rating-v23-comparison.json'),JSON.stringify(report,null,2));
await writeFile(join(dir,'롤력-변경표.md'),'# 롤력 V2.3 변경표\n\n| 닉네임 | 이전 | 변경 | 차이 | 내전 | 솔랭 복원 잔존계수 |\n|---|---:|---:|---:|---:|---:|\n'+rows.map(r=>`| ${r.name} | ${r.before} | ${r.after} | ${r.delta>0?'+':''}${r.delta} | ${r.games} | ${Math.round(r.soloRetention*100)}% |`).join('\n')+'\n\n잔존계수는 전체 점수의 솔랭 비중이 아닙니다. 0%는 복원 보정 종료를 뜻하며 초기 추정치의 간접 영향은 남을 수 있습니다. 원본 경기와 계정 연결을 변경하지 않았습니다.\n');
console.log(JSON.stringify({...report,rows:rows.map(({roles,...r})=>r),audit:undefined},null,2));
