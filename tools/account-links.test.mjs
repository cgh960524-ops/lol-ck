import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRiotId,sameAccount,linkAccount,unlinkAccount} from '../account-links.js';
import '../rating-engine.js';
const roster=()=>[{id:1,name:'본계정',tag:'#KR1',puuid:'main',tier:'MASTER',lp:80,role:'JUNGLE',secondary:'TOP',ratingSeedV4:{solo:2050}},{id:2,name:'다른 선수',tag:'#KR2',puuid:'other',playAliases:[{puuid:'taken',gameName:'남의부캐',tagLine:'KR3'}]}];
const alt={puuid:'alt',gameName:'스킨 계정',tagLine:'KR1',tier:'IRON',lp:0,role:'SUPPORT'};
test('Riot ID requires both name and tag and trims outer whitespace',()=>{
 assert.deepEqual(parseRiotId(' 스킨 계정 # KR1 '),{gameName:'스킨 계정',tagLine:'KR1'});
 for(const value of ['', '이름', '#KR1', '이름# ', '이름#태그#추가'])assert.throws(()=>parseRiotId(value));
});
test('link only stores identity, preserving solo rank, roles and seed',()=>{
 const players=roster(),before=structuredClone(players[0]);linkAccount(players,1,alt);
 const {playAliases,...after}=players[0];assert.deepEqual(after,before);assert.deepEqual(playAliases,[{puuid:'alt',gameName:'스킨 계정',tagLine:'KR1'}]);
});
test('self, another primary and another player alias cannot be linked',()=>{
 for(const account of [{puuid:'main',gameName:'본계정',tagLine:'KR1'},{puuid:'other',gameName:'새이름',tagLine:'KR9'},{puuid:'new',gameName:'다른 선수',tagLine:'KR2'},{puuid:'taken',gameName:'남의부캐',tagLine:'KR3'}]){
  const players=roster(),before=structuredClone(players);assert.throws(()=>linkAccount(players,1,account),{status:409});assert.deepEqual(players,before);
 }
});
test('same PUUID can refresh a renamed alias without duplicate entries',()=>{
 const players=roster();linkAccount(players,1,alt);linkAccount(players,1,{...alt,gameName:'새 부캐'});assert.equal(players[0].playAliases.length,1);assert.equal(players[0].playAliases[0].gameName,'새 부캐');
 assert.equal(sameAccount({},{}),false);
});
test('missing or archived target is rejected; unlink is target-scoped and idempotent',()=>{
 const players=roster();assert.throws(()=>linkAccount(players,99,alt),{status:404});players[0].archived=true;assert.throws(()=>linkAccount(players,1,alt),{status:404});delete players[0].archived;
 linkAccount(players,1,alt);unlinkAccount(players,1,'alt');unlinkAccount(players,1,'alt');assert.deepEqual(players[0].playAliases,[]);assert.equal(players[1].playAliases.length,1);
});
test('matches played on a linked alias count as the main player without copying solo rank',()=>{
 const players=Array.from({length:10},(_,i)=>({id:i+1,name:'P'+i,tag:'#KR1',puuid:'u'+i,tier:'PLATINUM',role:CKRating.ROLES[i%5]}));
 const match={gameId:'123456789',gameCreation:Date.UTC(2026,8,17),duration:1800,participants:players.map((p,i)=>({puuid:p.puuid,gameName:p.name,tagLine:'KR1',teamId:i<5?100:200,win:i<5,role:p.role,roleSource:'manual',kills:4,deaths:3,assists:9,gold:12000,cs:180,damage:20000,vision:30}))};
 const expected=CKRating.recalculate(structuredClone(players),[structuredClone(match)],{}).players[0];
 Object.assign(match.participants[0],{puuid:alt.puuid,gameName:alt.gameName,tagLine:alt.tagLine});linkAccount(players,1,alt);
 const actual=CKRating.recalculate(players,[match],{}).players[0];assert.equal(actual.internalGames,1);assert.equal(actual.tier,'PLATINUM');assert.deepEqual(actual.ratingV2,expected.ratingV2);
});
