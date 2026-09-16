import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import '../rating-engine.js';
const dir=resolve(process.argv[2]),read=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const state=await read('app-state.json'),matches=await read('internal-matches.json'),players=structuredClone(state.players);
const identities=players.map(p=>({id:p.id,name:p.name,puuid:p.puuid,playAliases:p.playAliases}));
CKRating.recalculate(players,matches,state.seriesState);
assert.deepEqual(players.map(p=>({id:p.id,name:p.name,puuid:p.puuid,playAliases:p.playAliases})),identities);
const once=JSON.stringify(players);CKRating.recalculate(players,matches,state.seriesState);assert.equal(JSON.stringify(players),once);
const rows=players.filter(p=>!p.archived).map(p=>{const old=state.players.find(x=>x.id===p.id);return {name:p.name,before:old.ratingV2.overall,after:p.ratingV2.overall,delta:p.ratingV2.overall-old.ratingV2.overall,roles:Object.fromEntries(CKRating.ROLES.map(r=>[r,{before:old.ratingV2.roles[r].rating,after:p.ratingV2.roles[r].rating,games:p.ratingV2.roles[r].games}]))};});
// Online replay diagnostics, not an independent holdout: registration priors can
// postdate old games, and the same archive is used for development.
const diagnostic=ps=>{const hs=ps.flatMap(p=>p.ratingHistory||[]).filter(h=>h.opponentId&&h.quality>0);return {samples:hs.length,performanceMAE:hs.reduce((s,h)=>s+Math.abs(h.performance-h.expectedPerformance),0)/hs.length,brier:hs.reduce((s,h)=>s+(Number(h.win)-h.expected)**2,0)/hs.length};};
const report={version:CKRating.VERSION,players:players.length,matches:matches.length,diagnostics:{before:diagnostic(state.players),after:diagnostic(players),note:'Historical replay only, not proof of predictive accuracy.'},rows};
await writeFile(join(dir,'rating-v22-comparison.json'),JSON.stringify(report,null,2));
await writeFile(join(dir,'롤력-변경표.md'),'# 롤력 V2.2 변경표\n\n| 닉네임 | 이전 | 변경 | 차이 |\n|---|---:|---:|---:|\n'+rows.map(r=>`| ${r.name} | ${r.before} | ${r.after} | ${r.delta>0?'+':''}${r.delta} |`).join('\n')+'\n\n특정 선수별 목표점수나 영구 하한선은 적용하지 않았습니다. 실제 정확도는 이후 경기로 검증해야 합니다.\n');
console.log(JSON.stringify(report,null,2));
