import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import '../rating-engine.js';
import {observe} from '../rating-observation.js';
const dir=resolve(process.argv[2]),read=async f=>JSON.parse(await readFile(join(dir,f),'utf8')),state=await read('app-state.json'),matches=await read('internal-matches.json'),ps=structuredClone(state.players),raw=JSON.stringify({matches,series:state.seriesState});
const previousSource=execFileSync('git',['show','c61e39b:rating-observation.js'],{encoding:'utf8'}),previous=await import('data:text/javascript;base64,'+Buffer.from(previousSource).toString('base64'));
let unchangedNonSupportObservations=0;
for(const m of CKRating.prepareMatches(ps,matches,state.seriesState))for(const p of m.participants){const role=CKRating.confirmedRole(p);if(!role||role==='SUPPORT')continue;const rivals=m.participants.filter(x=>x.teamId!==p.teamId&&CKRating.confirmedRole(x)===role);if(rivals.length!==1)continue;const a=previous.observe(p,rivals[0],m,role,CKRating.reference),b=observe(p,rivals[0],m,role,CKRating.reference);for(const key of ['signal','pairedSignal','quality','target'])assert.equal(a[key],b[key],role+' '+key);unchangedNonSupportObservations++;}
CKRating.recalculate(ps,matches,state.seriesState);const once=JSON.stringify(ps);CKRating.recalculate(ps,matches,state.seriesState);assert.equal(JSON.stringify(ps),once);assert.equal(JSON.stringify({matches,series:state.seriesState}),raw);
for(const p of ps){const old=state.players.find(x=>x.id===p.id);for(const key of ['internalGames','internalKills','internalDeaths','internalAssists','internalChampions','ratingSeedV22'])assert.deepEqual(p[key],old[key]);}
const rows=ps.filter(p=>!p.archived&&p.ratingV2.roles.SUPPORT.games).map(p=>{const old=state.players.find(x=>x.id===p.id),r=p.ratingV2.roles.SUPPORT;return {name:p.name,games:r.games,before:old.ratingV2.roles.SUPPORT.rating,after:r.rating,delta:r.rating-old.ratingV2.roles.SUPPORT.rating,overallBefore:old.ratingV2.overall,overallAfter:p.ratingV2.overall,provisional:r.provisional,otherRoleChanges:Object.fromEntries(CKRating.ROLES.filter(x=>x!=='SUPPORT'&&p.ratingV2.roles[x].rating!==old.ratingV2.roles[x].rating).map(x=>[x,p.ratingV2.roles[x].rating-old.ratingV2.roles[x].rating]))};});
const report={version:CKRating.VERSION,players:ps.length,matches:matches.length,unchangedNonSupportObservations,rows};
await writeFile(join(dir,'support-v32-comparison.json'),JSON.stringify(report,null,2));await writeFile(join(dir,'서폿-보정-변경표.md'),'# V3.2 서폿 영향력 보정\n\n서폿 실제 플레이 이력이 있는 활성 선수만 표시합니다. 타 포지션 관측 공식은 동일하지만 전체 요약과 역할 간 초기값 전이로 간접 변동이 있습니다.\n\n| 선수 | 서폿 경기 | 이전 서폿 | 변경 서폿 | 변화 | 전체 이전 | 전체 변경 |\n|---|---:|---:|---:|---:|---:|---:|\n'+rows.map(r=>`| ${r.name} | ${r.games} | ${r.before} | ${r.after} | ${r.delta>0?'+':''}${r.delta} | ${r.overallBefore} | ${r.overallAfter} |`).join('\n')+'\n\n개별 선수를 목표 점수로 맞추는 예외는 없습니다. 백업과 배포 검증 기록을 같은 폴더에 보존합니다.\n');
console.log(JSON.stringify(report,null,2));
