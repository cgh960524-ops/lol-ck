import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import '../rating-engine.js';
const dir=resolve(process.argv[2]),read=async file=>JSON.parse(await readFile(join(dir,file),'utf8')),state=await read('app-state.json'),matches=await read('internal-matches.json'),ps=structuredClone(state.players),raw=JSON.stringify({matches,series:state.seriesState});
CKRating.recalculate(ps,matches,state.seriesState);const once=JSON.stringify(ps);CKRating.recalculate(ps,matches,state.seriesState);assert.equal(JSON.stringify(ps),once);assert.equal(JSON.stringify({matches,series:state.seriesState}),raw);
const rows=[];let preferred=0,verified=0;
for(const p of ps){const old=state.players.find(x=>x.id===p.id);assert.equal(p.ratingV2.overall,old.ratingV2.overall,p.name+' overall');assert.deepEqual(p.internalChampions,old.internalChampions);assert.equal(p.internalGames,old.internalGames);for(const k of ['ratingSeedV2','ratingSeedV21','ratingSeedV22'])if(old[k])assert.deepEqual(p[k],old[k]);
 for(const role of CKRating.ROLES){const a=old.ratingV2.roles[role],b=p.ratingV2.roles[role];assert.equal(b.evidenceRating,a.rating,p.name+' '+role+' V3 evidence changed');assert.ok(b.rating<=a.rating,p.name+' unexpected increase');
  if(b.calibrationStatus==='preferred'){assert.equal(b.rating,a.rating);preferred++;}
  if(!a.provisional){assert.equal(b.rating,a.rating,p.name+' established role changed');verified++;}
  if(a.rating!==b.rating&&!p.archived)rows.push({name:p.name,role,before:a.rating,after:b.rating,delta:b.rating-a.rating,games:b.games,comparisons:b.comparisons,series:b.observedSeries,opponents:b.observedOpponents,share:b.roleEvidenceShare,anchor:b.transferAnchor,baseline:b.transferBaseline});
 }
}
const report={version:CKRating.VERSION,players:ps.length,matches:matches.length,unchangedOverall:ps.length,unchangedPreferredRoles:preferred,unchangedEstablishedRoles:verified,changedRoles:rows.length,rows};
await writeFile(join(dir,'rating-v31-comparison.json'),JSON.stringify(report,null,2));
const labels={TOP:'탑',JUNGLE:'정글',MID:'미드',ADC:'원딜',SUPPORT:'서폿'};
await writeFile(join(dir,'잠정-포지션-변경표.md'),'# V3.1 미경험·표본 부족 포지션 변경표\n\n전체 롤력, 등록 주·부포지션, 기존 검증 완료 포지션은 유지합니다. 변경된 역할만 표시합니다.\n\n| 선수 | 포지션 | 이전 | 변경 | 경기 | 유효 비교 | 시리즈 | 상대 수 | 관측 반영률 |\n|---|---|---:|---:|---:|---:|---:|---:|---:|\n'+rows.map(r=>`| ${r.name} | ${labels[r.role]} | ${r.before} | ${r.after} | ${r.games} | ${r.comparisons} | ${r.series} | ${r.opponents} | ${Math.round(r.share*100)}% |`).join('\n')+'\n\n관측 반영률은 다른 포지션으로의 보수적 전이 보정을 해제하는 진행률이며, 실력 추정의 정확도 확률이 아닙니다. 운영 배포 여부는 deployment-verification.json으로 확인하세요.\n');
console.log(JSON.stringify(report,null,2));
