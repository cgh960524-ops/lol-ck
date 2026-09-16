import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../rating-engine.js';
const E=globalThis.CKRating;
const clone=structuredClone;
const players=()=>Array.from({length:10},(_,i)=>({id:i+1,name:'P'+i,tag:'#KR1',puuid:'uuid-'+i,tier:'PLATINUM',form:80,role:E.ROLES[i%5],secondary:E.ROLES[(i+1)%5]}));
function game(id=1){return {gameId:String(id),duration:1800,gameCreation:Date.UTC(2026,8,1)+id*86400000,participants:players().map((p,i)=>({puuid:p.puuid,gameName:p.name,tagLine:'KR1',teamId:i<5?100:200,win:i<5,role:p.role,roleSource:'manual',championKey:'C'+(i%5),championName:'C'+(i%5),gold:10000,cs:150,damage:15000,kills:4,deaths:4,assists:8,vision:40,damageTaken:20000,mitigated:15000,ccTime:40,healsOnTeammates:1000,shieldsOnTeammates:1000,objectiveDamage:5000,turretDamage:1500}))};}
const recalc=(ps,ms,ss={})=>E.recalculate(ps,ms,ss).players;
test('deterministic replay, dedup and raw data immutability',()=>{const ps=players(),ms=[game(1),game(2)],before=clone(ms);recalc(ps,ms);const result=clone(ps);recalc(ps,[...ms,ms[0]]);assert.deepEqual(ps,result);assert.deepEqual(ms,before);});
test('simultaneous updates do not depend on participant/player order',()=>{const ms=[game(1),game(2)],a=recalc(players(),ms),b=recalc(players().reverse(),ms.map(m=>({...m,participants:[...m.participants].reverse()})));for(const p of a)assert.deepEqual(p.ratingV2,b.find(x=>x.id===p.id).ratingV2);});
test('appending matches preserves earlier replay events with the frozen reference',()=>{const a=recalc(players(),[game(1)]),b=recalc(players(),[game(1),game(2)]);for(const p of a)assert.deepEqual(p.ratingHistory[0],b.find(x=>x.id===p.id).ratingHistory[0]);});
test('changing preferred role or refreshing tier never rewrites frozen history',()=>{const ps=recalc(players(),[game()]),old=clone(ps[0].ratingHistory);ps[0].role='SUPPORT';ps[0].secondary='MID';ps[0].tier='CHALLENGER';recalc(ps,[game()]);assert.deepEqual(ps[0].ratingHistory,old);});
test('UNRANKED gets a neutral seed, not a permanently low anchor',()=>{const ps=players();ps[0].tier='UNRANKED';recalc(ps,[]);assert.equal(ps[0].ratingSeedV22.solo,1450);assert.equal(E.overallScore(ps[0]),1450);});
test('missing optional fields reduce evidence, not performance as a zero',()=>{const full=game(),missing=clone(full);for(const p of missing.participants)for(const k of ['damageTaken','mitigated','ccTime','healsOnTeammates','shieldsOnTeammates','objectiveDamage','turretDamage'])delete p[k];const a=recalc(players(),[full])[4],b=recalc(players(),[missing])[4];assert.ok(b.ratingHistory[0].metrics.every(x=>['efficiency','fight','survival','vision'].includes(x.key)));assert.equal(b.ratingHistory[0].personalChange,0);assert.equal(b.ratingHistory[0].reason,'low-quality');assert.ok(b.ratingHistory[0].quality<a.ratingHistory[0].quality);assert.ok(b.ratingV2.roles.SUPPORT.confidence<a.ratingV2.roles.SUPPORT.confidence);});
test('unknown or ambiguous lane is never compared to an arbitrary opponent',()=>{const m=game();m.participants[0].roleSource='inferred';const p=recalc(players(),[m])[0];assert.equal(p.ratingHistory[0].reason,'unconfirmed');assert.equal(p.ratingHistory[0].change,0);assert.equal(p.ratingV2.roles.TOP.games,0);const m2=game();m2.participants[6].role='TOP';const p2=recalc(players(),[m2])[0];assert.equal(p2.ratingHistory[0].opponentId,null);assert.equal(p2.ratingHistory[0].personalChange,0);});
test('a losing support can gain, a winning poor support can lose',()=>{const m=game(),strong=m.participants[9],weak=m.participants[4];Object.assign(strong,{assists:18,deaths:1,vision:130,ccTime:150,healsOnTeammates:12000,shieldsOnTeammates:10000});Object.assign(weak,{assists:1,deaths:10,vision:5,ccTime:2,healsOnTeammates:0,shieldsOnTeammates:0});const ps=recalc(players(),[m]);assert.ok(ps[9].ratingHistory[0].roleChange>0);assert.ok(ps[4].ratingHistory[0].roleChange<0);});
test('same performance against stronger confirmed opponent gets more credit',()=>{const a=players(),b=players();b[5].form=480;const x=recalc(a,[game()])[0].ratingHistory[0],y=recalc(b,[game()])[0].ratingHistory[0];assert.equal(x.performance,y.performance);assert.ok(y.personalChange>x.personalChange);assert.ok(y.roleChange>x.roleChange);assert.ok(y.contextAdjustment>x.contextAdjustment);assert.ok(Math.abs(y.contextAdjustment)<=400);});
test('POG metadata cannot double-count the same performance',()=>{const m=game(),s={history:[{id:1,finished:true,pogId:1,blue:players().slice(0,5),red:players().slice(5),sets:[{gameId:'1',imported:true}]}]},a=recalc(players(),[m],s);s.history[0].pogId=2;const b=recalc(players(),[m],s);assert.deepEqual(a.map(p=>p.ratingV2),b.map(p=>p.ratingV2));});
test('confirmed series set overrides the planned role',()=>{const m=game(),s={history:[{id:'s',blue:players().slice(0,5),red:players().slice(5),sets:[{gameId:'1',roleOverrides:{1:'MID',3:'TOP'}}]}]};const ps=recalc(players(),[m],s);assert.equal(ps[0].ratingHistory[0].role,'MID');assert.equal(ps[2].ratingHistory[0].role,'TOP');});
test('role specialization is independent and allowed above overall',()=>{const ms=Array.from({length:16},(_,i)=>{const m=game(i+1);if(i%2){[m.participants[4].role,m.participants[2].role]=['MID','SUPPORT'];Object.assign(m.participants[4],{damage:1000,gold:6000,cs:40,deaths:12,assists:1,vision:5});}else Object.assign(m.participants[4],{assists:18,deaths:1,vision:130,ccTime:150,healsOnTeammates:12000,shieldsOnTeammates:10000});return m;}),p=recalc(players(),ms)[4];assert.ok(E.positionScore(p,'SUPPORT')>E.overallScore(p));assert.ok(E.positionScore(p,'SUPPORT')>E.positionScore(p,'MID')+150);});
test('zero data, remake and duplicate account links remain finite',()=>{const ps=players(),m=game();m.duration=100;recalc(ps,[m]);assert.equal(ps[0].internalGames,0);m.duration=1800;m.participants[1]={...m.participants[0]};const {diagnostics}=E.recalculate(ps,[m]);assert.equal(diagnostics.duplicateLinks,1);assert.equal(ps[0].internalGames,1);for(const p of ps)assert.ok(Number.isFinite(E.overallScore(p)));});
test('production snapshot replays idempotently with all identities preserved',async()=>{const dir=new URL('../../backup/2026-09-16T20-51-42-666Z-before-role-power-v2/',import.meta.url);let state;try{state=JSON.parse(await readFile(new URL('app-state.json',dir),'utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}const ms=JSON.parse(await readFile(new URL('internal-matches.json',dir),'utf8')),ps=clone(state.players),ids=ps.map(p=>p.id);recalc(ps,ms,state.seriesState);const once=JSON.stringify(ps);recalc(ps,ms,state.seriesState);assert.equal(JSON.stringify(ps),once);assert.deepEqual(ps.map(p=>p.id),ids);for(const p of ps)for(const h of p.ratingHistory)assert.ok(Math.abs(h.roleChange)<=141);const p9=ps.find(p=>p.name==='9 Things');assert.ok(E.positionScore(p9,'SUPPORT')>E.positionScore(p9,'MID'));});
test('manual floors never change overall or assigned-role scores',()=>{
 const a=players(),b=players();b[0].manualPowerFloor=3000;recalc(a,[game()]);recalc(b,[game()]);
 assert.equal(E.overallScore(a[0]),E.overallScore(b[0]));for(const role of E.ROLES)assert.equal(E.positionScore(a[0],role),E.positionScore(b[0],role));
 assert.equal(b[0].manualPowerFloor,3000); // Retained only for audit/rollback.
});
test('past peak is blended only into its documented role, never all five',()=>{
 const a=players()[0],b={...a,soloPowerOverride:2600,soloPowerSource:'past TOP'};
 const normal=E.initialProfile(a),high=E.initialProfile(b);
 assert.equal(high.roles.TOP.rating,(normal.roles.TOP.rating+2600)/2);
 for(const role of E.ROLES.filter(r=>r!=='TOP'))assert.deepEqual(high.roles[role],normal.roles[role]);
 const explicit=E.initialProfile({...b,soloPowerRole:'SUPPORT'});assert.equal(explicit.roles.TOP.rating,normal.roles.TOP.rating);assert.ok(explicit.roles.SUPPORT.rating>normal.roles.SUPPORT.rating);
});
test('unplayed off-roles do not inherit main peak or changes from other roles',()=>{
 const p=players();p[0].tier='MASTER';p[0].form=60;p[0].soloPowerOverride=2600;
 const profile=E.initialProfile(p[0]);assert.equal(profile.roles.TOP.rating,2355);assert.equal(profile.roles.JUNGLE.rating,2075);assert.equal(profile.roles.SUPPORT.rating,2030);
 recalc(p,[game(),game(2)]);assert.equal(E.positionScore(p[0],'SUPPORT'),1786);assert.equal(p[0].ratingV2.roles.SUPPORT.evidenceRating,2030);assert.equal(p[0].ratingV2.roles.SUPPORT.games,0);assert.equal(p[0].ratingV2.roles.SUPPORT.provisional,true);
});
test('migration preserves legacy seed for audit and freezes the new role-local profile',()=>{
 const p=players();p[0].tier='MASTER';p[0].form=60;p[0].soloPowerOverride=2600;p[0].ratingSeedV2={value:2600,source:'solo-registration',role:'TOP',secondary:'JUNGLE',rolePriors:{}};
 const old=clone(p[0].ratingSeedV2);recalc(p,[game()]);const fresh=clone(p[0].ratingSeedV22),ratings=clone(p[0].ratingV2);
 p[0].tier='IRON';p[0].role='SUPPORT';p[0].soloPowerOverride=3200;p[0].manualPowerFloor=9999;recalc(p,[game()]);
 assert.deepEqual(p[0].ratingSeedV2,old);assert.deepEqual(p[0].ratingSeedV22,fresh);assert.deepEqual(p[0].ratingV2,ratings);
});
test('provisional label uses games, distinct opponents and confidence for Set or JSON data',()=>{
 assert.equal(E.confidenceLabel({games:0}),'잠정 · 미배치');
 for(const r of [{games:7,opponents:4,confidence:.8},{games:20,opponents:1,confidence:.8},{games:20,opponents:4,confidence:.2}])assert.ok(E.isProvisional(r));
 assert.equal(E.isProvisional({games:20,opponents:4,confidence:.8}),false);assert.equal(E.isProvisional({games:20,opponents:new Set([1,2,3,4]),confidence:.8}),false);
});
test('removing historical floor does not remove the same-role learning ability',()=>{
 const ps=players();ps[4].manualPowerFloor=2600;const ms=Array.from({length:20},(_,i)=>{const m=game(i+1);Object.assign(m.participants[4],{assists:18,deaths:1,vision:130,ccTime:150,healsOnTeammates:12000,shieldsOnTeammates:10000});return m;});
 recalc(ps,ms);assert.ok(E.positionScore(ps[4],'SUPPORT')>ps[4].ratingSeedV22.roles.SUPPORT.rating+100);const noFloor=players();recalc(noFloor,ms);assert.equal(E.overallScore(ps[4]),E.overallScore(noFloor[4]));
});

test('master off-role retains general skill; unknown evidence is provisional, not platinum',()=>{
 const p=players();p[0].tier='MASTER';p[0].form=0;recalc(p,[]);
 assert.equal(E.positionScore(p[0],'TOP'),2050);assert.equal(E.positionScore(p[0],'JUNGLE'),2015);assert.equal(E.positionScore(p[0],'SUPPORT'),1734);assert.equal(p[0].ratingV2.roles.SUPPORT.evidenceRating,1970);
 for(const r of Object.values(p[0].ratingV2.roles)){assert.equal(r.provisional,true);assert.equal(r.confidence,0);}
 const low=E.initialProfile({...players()[0],tier:'SILVER',form:0});assert.equal(low.roles.TOP.rating,1100);assert.equal(low.roles.SUPPORT.rating,1020);
});
test('first unfamiliar-role game does not mechanically deduct the role offset from overall',()=>{
 const p=players(),m=game();for(const mp of m.participants)mp.role='MID'; // No unambiguous matchup, equal teams.
 recalc(p,[m]);const change=p[0].ratingHistory[0].roleChange;assert.equal(p[0].ratingV2.overall,1500+change);assert.equal(p[0].ratingV2.roles.MID.evidenceRating,1420);assert.equal(p[0].ratingV2.roles.MID.rating,1250+change);
});
test('V2.1 migration preserves its frozen solo and documented role peak, not current edits',()=>{
 const p=players();p[0].ratingSeedV21={policy:'role-local-priors-v1',solo:2050,primary:'TOP',secondary:'JUNGLE',source:'solo-registration',roles:Object.fromEntries(E.ROLES.map(r=>[r,{rating:1500,base:1500,peak:r==='TOP'?2600:null,historySource:'frozen'}]))};
 const saved=clone(p[0].ratingSeedV21);p[0].tier='IRON';p[0].soloPowerOverride=9999;
 recalc(p,[]);assert.deepEqual(p[0].ratingSeedV21,saved);assert.equal(p[0].ratingSeedV22.solo,2050);assert.equal(p[0].ratingSeedV22.roles.TOP.rating,2325);assert.equal(p[0].ratingSeedV22.roles.JUNGLE.rating,2015);
});
test('neutral UNRANKED prior never pulls learned ability back toward 1450',()=>{
 const p=players();p[4].tier='UNRANKED';const ms=Array.from({length:12},(_,i)=>{const m=game(i+1);Object.assign(m.participants[4],{assists:18,deaths:1,vision:130,ccTime:150,healsOnTeammates:12000,shieldsOnTeammates:10000});return m;});
 recalc(p,ms);assert.ok(p[4].ratingHistory.every(h=>h.priorChange===0));assert.ok(p[4].ratingV2.roles.SUPPORT.rating>1550);
});
test('observable estimates can move both ways without solo-restoration rewards',()=>{
 const p=players(),ms=Array.from({length:30},(_,i)=>{const m=game(i+1);Object.assign(m.participants[4],{assists:1,deaths:12,vision:3,ccTime:1,healsOnTeammates:0,shieldsOnTeammates:0});Object.assign(m.participants[9],{assists:18,deaths:1,vision:130,ccTime:150,healsOnTeammates:12000,shieldsOnTeammates:10000});return m;});
 recalc(p,ms);assert.ok(p[4].ratingV2.roles.SUPPORT.rating<1400);assert.ok(p[9].ratingV2.roles.SUPPORT.rating>1600);
 assert.ok(p[4].ratingHistory.every(h=>h.priorChange===0));assert.ok(p[9].ratingHistory.every(h=>h.priorChange===0));
 for(const x of [p[4],p[9]])for(const h of x.ratingHistory)assert.ok(Math.abs(h.roleChange-h.personalChange-h.outcomeChange-h.priorChange-(h.calibrationChange||0))<2);
});

test('solo restoration retires on lifetime participation or role experience, not confidence',()=>{
 assert.equal(E.soloRetention(10,0),1);assert.equal(E.soloRetention(20,0),.5);assert.equal(E.soloRetention(30,0),0);assert.equal(E.soloRetention(500,0),0);assert.equal(E.soloRetention(20,20),0);
 const ms=Array.from({length:40},(_,i)=>game(i+1)),ps=recalc(players(),ms);
 for(const p of ps){assert.equal(p.ratingV2.soloRestorationEnded,true);for(const h of p.ratingHistory.filter(h=>h.internalGamesBefore>=30)){assert.equal(h.priorChange,0);assert.equal(h.soloRetention,0);}assert.equal(p.ratingV2.overall,p.ratingV2.roles[p.role].rating);}
});
test('many unconfirmed games never extend solo restoration or invent comparison confidence',()=>{
 const ms=Array.from({length:35},(_,i)=>{const m=game(i+1);if(i<30)m.participants[0].roleSource='inferred';return m;}),p=recalc(players(),ms)[0];
 assert.equal(p.internalGames,35);assert.equal(p.ratingV2.unconfirmed,30);assert.equal(p.ratingV2.comparisonCount,5);assert.equal(p.ratingV2.soloRetention,0);assert.ok(p.ratingV2.roles.TOP.provisional);assert.ok(p.ratingHistory.every(h=>h.priorChange===0));
});
test('mature unplayed off-role starts conservatively without changing internal overall',()=>{
 const ms=Array.from({length:35},(_,i)=>{const m=game(i+1);Object.assign(m.participants[0],{damage:1000,gold:5000,cs:30,deaths:12,assists:1});return m;}),p=recalc(players(),ms)[0];
 assert.notEqual(p.ratingV2.overall,p.ratingSeedV22.solo);const mid=p.ratingV2.roles.MID;assert.equal(mid.evidenceRating,p.ratingV2.overall);assert.equal(mid.rating,Math.round(E.offRoleEstimate(p.ratingSeedV22,'MID',mid.evidenceRating,mid.transferAnchor).rating));assert.equal(mid.seedSource,'internal-transfer');assert.equal(mid.games,0);assert.equal(mid.comparisons,0);assert.equal(mid.confidence,0);assert.equal(mid.provisional,true);
 const next=game(36);[next.participants[0].role,next.participants[2].role]=['MID','TOP'];const q=recalc(players(),[...ms,next])[0];assert.equal(q.ratingHistory.at(-1).roleBefore,mid.rating);assert.equal(q.ratingHistory.at(-1).priorChange,0);assert.deepEqual(q.ratingHistory.slice(0,35),p.ratingHistory);
});
test('large rating gap expectation is symmetric and saturates, not a free underdog bonus',()=>{
 assert.equal(E.matchupExpectation(400),E.matchupExpectation(1400));assert.equal(E.matchupExpectation(-1400),-E.matchupExpectation(1400));assert.ok(E.matchupExpectation(100)<E.matchupExpectation(400));
 const ps=players();ps[5].tier='CHALLENGER';ps[5].form=200;const m=game();Object.assign(m.participants[0],{gold:2000,cs:5,damage:100,kills:0,assists:0,deaths:20,vision:0,damageTaken:0,mitigated:0,ccTime:0,objectiveDamage:0,turretDamage:0,healsOnTeammates:0,shieldsOnTeammates:0});const h=recalc(ps,[m])[0].ratingHistory[0];assert.ok(h.personalChange<0);
});
test('missing and duplicate role matches expose distinct audit reasons',()=>{
 const m=game();m.participants[5].puuid='unknown';m.participants[5].gameName='unlinked';const p=recalc(players(),[m])[0];assert.equal(p.ratingHistory[0].comparisonStatus,'opponent-unlinked');assert.equal(p.ratingV2.comparisonCount,0);
 m.participants[5].roleSource='inferred';assert.equal(recalc(players(),[m])[0].ratingHistory[0].comparisonStatus,'opponent-role-unconfirmed');
 m.participants[5].roleSource='manual';m.participants[6].role='TOP';assert.equal(recalc(players(),[m])[0].ratingHistory[0].comparisonStatus,'opponent-role-ambiguous');
});
