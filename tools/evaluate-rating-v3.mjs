import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import '../rating-engine.js';
const dir=resolve(process.argv[2]),state=JSON.parse(await readFile(join(dir,'app-state.json'),'utf8')),matches=JSON.parse(await readFile(join(dir,'internal-matches.json'),'utf8')),raw=JSON.stringify({matches,series:state.seriesState}),ps=structuredClone(state.players);
CKRating.recalculate(ps,matches,state.seriesState);const once=JSON.stringify(ps);CKRating.recalculate(ps,matches,state.seriesState);assert.equal(JSON.stringify(ps),once);assert.equal(JSON.stringify({matches,series:state.seriesState}),raw);
for(const p of ps){const old=state.players.find(x=>x.id===p.id);for(const k of ['ratingSeedV2','ratingSeedV21','ratingSeedV22'])if(old[k])assert.deepEqual(p[k],old[k]);assert.equal(p.internalGames,old.internalGames);assert.deepEqual(p.internalChampions,old.internalChampions);for(const h of p.ratingHistory){assert.equal(h.outcomeChange,0);assert.equal(h.priorChange,0);if(h.internalGamesBefore>=30)assert.equal(h.soloRetention,0);}}
const index=players=>new Map(players.flatMap(p=>(p.ratingHistory||[]).map(h=>[p.id+'|'+h.gameId,h]))),a=index(state.players),b=index(ps),prepared=CKRating.prepareMatches(ps,matches,state.seriesState),find=CKRating.playerResolver(ps),holdout=[];
for(const m of prepared.filter(m=>m.gameCreation>CKRating.reference.cutoff)){
 const entries=m.participants.map(mp=>({mp,p:find(mp)}));if(entries.length!==10||entries.some(x=>!x.p))continue;
 const hs=entries.map(x=>({mp:x.mp,a:a.get(x.p.id+'|'+m.gameId),b:b.get(x.p.id+'|'+m.gameId)}));if(hs.some(x=>!x.a||!x.b))continue;
 const blue=hs.find(x=>x.mp.teamId===100);holdout.push({gameId:String(m.gameId),seriesId:m.seriesId,win:Number(blue.mp.win),before:blue.a.expected,after:blue.b.expected});
}
const loss=(rows,k)=>rows.reduce((s,x)=>s+(x[k]-x.win)**2,0)/rows.length;
const clusters=[...new Set(holdout.map(x=>x.seriesId))].map(id=>holdout.filter(x=>x.seriesId===id));let seed=731;const rand=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296),diffs=[];
for(let i=0;i<2000;i++){const sample=clusters.flatMap(()=>clusters[Math.floor(rand()*clusters.length)]);diffs.push(loss(sample,'after')-loss(sample,'before'));}diffs.sort((a,b)=>a-b);
const diagnostics={holdoutGames:holdout.length,holdoutClusters:clusters.length,beforeBrier:loss(holdout,'before'),afterBrier:loss(holdout,'after'),delta95ClusterBootstrap:[diffs[50],diffs[1949]],note:'Later matches excluded from frozen feature calibration. Registration seeds may have been recorded later than these historical matches. This is a retrospective comparison, not a prospective validation or a true-skill label.'};
const rows=ps.filter(p=>!p.archived).map(p=>{const old=state.players.find(x=>x.id===p.id);return {name:p.name,before:old.ratingV2.overall,after:p.ratingV2.overall,delta:p.ratingV2.overall-old.ratingV2.overall,games:p.internalGames,roles:Object.fromEntries(CKRating.ROLES.map(r=>[r,{before:old.ratingV2.roles[r].rating,after:p.ratingV2.roles[r].rating,games:p.ratingV2.roles[r].games,estimatedTarget:p.ratingV2.roles[r].estimatedTarget,provisional:p.ratingV2.roles[r].provisional}]))};});
const report={version:CKRating.VERSION,reference:{...CKRating.reference,cells:undefined},diagnostics,rows,holdout};await writeFile(join(dir,'rating-v3-comparison.json'),JSON.stringify(report,null,2));
await writeFile(join(dir,'롤력-V3-비교표.md'),'# 관측 실력 V3 재계산 비교\n\n운영 반영 여부는 배포 검증 기록을 확인하세요. 특정 선수의 목표 점수를 맞추는 규칙은 없습니다.\n\n| 닉네임 | 이전 전체 | V3 전체 | 변화 | 탑 | 정글 | 미드 | 원딜 | 서폿 |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n'+rows.map(r=>`| ${r.name} | ${r.before} | ${r.after} | ${r.delta>0?'+':''}${r.delta} | ${Object.values(r.roles).map(x=>x.after+(x.provisional?'*':'')).join(' | ')} |`).join('\n')+'\n\n별표는 잠정 포지션입니다.\n\n## 시간 분리 검증\n\n```json\n'+JSON.stringify(diagnostics,null,2)+'\n```\n');
console.log(JSON.stringify({diagnostics,rows:rows.map(({roles,...r})=>r)},null,2));
