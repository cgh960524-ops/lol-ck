import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import '../rating-engine.js';

const snapshot=resolve(process.argv[2]||'');
if(!process.argv[2])throw new Error('Usage: node tools/verify-bot-duo-retro.mjs <snapshot-folder>');
const before=JSON.parse(await readFile(join(snapshot,'app-state.json'),'utf8'));
const matches=JSON.parse(await readFile(join(snapshot,'internal-matches.json'),'utf8'));
const targetIds=new Set(CKRating.bottomDuoRollout.retroGameIds);
const targetMatches=matches.filter(match=>targetIds.has(String(match.gameId))).sort((a,b)=>Number(a.gameCreation)-Number(b.gameCreation));
assert.equal(targetMatches.length,6,'the frozen retrospective set must contain exactly six uploaded games');
assert.equal(new Set(targetMatches.map(match=>String(match.gameId))).size,6,'retrospective game IDs must be unique');

const players=structuredClone(before.players);
const result=CKRating.recalculate(players,matches,structuredClone(before.seriesState));
assert.equal(result.diagnostics.bottomDuoGames,6,'all six retrospective games must use the duo rule');
assert.equal(result.diagnostics.bottomDuoAdjusted,24,'four bottom players in each game must receive a duo audit');

const beforePlayers=new Map(before.players.map(player=>[String(player.id),player]));
const afterPlayers=new Map(result.players.map(player=>[String(player.id),player]));
const history=(player,gameId)=>(player.ratingHistory||[]).find(row=>String(row.gameId)===String(gameId));
const prefixIds=new Set(matches.filter(match=>Number(match.gameCreation)<Number(targetMatches[0].gameCreation)).map(match=>String(match.gameId)));
const numericHistoryFields=['before','after','change','roleBefore','roleAfter','roleChange','personalChange','matchupChange','referenceChange','capAdjustment','expectedPerformance','actualMatchup','residual'];

for(const [id,oldPlayer] of beforePlayers){
 const next=afterPlayers.get(id);assert.ok(next,`missing recalculated player ${id}`);
 for(const oldRow of oldPlayer.ratingHistory||[]){
  if(!prefixIds.has(String(oldRow.gameId)))continue;
  const newRow=history(next,oldRow.gameId);assert.ok(newRow,`${oldPlayer.name} lost history ${oldRow.gameId}`);
  for(const field of numericHistoryFields)assert.equal(newRow[field],oldRow[field],`${oldPlayer.name} ${oldRow.gameId} changed historical ${field}`);
 }
}

const targetPlayerIds=new Set();
for(const match of targetMatches)for(const participant of match.participants||[]){
 const player=CKRating.playerResolver(result.players)(participant);if(player)targetPlayerIds.add(String(player.id));
}
for(const [id,oldPlayer] of beforePlayers){
 if(targetPlayerIds.has(id))continue;
 const next=afterPlayers.get(id);
 assert.equal(next.ratingV2.overall,oldPlayer.ratingV2.overall,`${oldPlayer.name} did not play but overall changed`);
 assert.deepEqual(Object.fromEntries(Object.entries(next.ratingV2.roles).map(([role,row])=>[role,row.rating])),Object.fromEntries(Object.entries(oldPlayer.ratingV2.roles).map(([role,row])=>[role,row.rating])),`${oldPlayer.name} did not play but role rating changed`);
}

const resolver=CKRating.playerResolver(result.players),rows=[];
for(const match of targetMatches)for(const participant of match.participants||[]){
 const player=resolver(participant);if(!player)continue;
 const oldPlayer=beforePlayers.get(String(player.id)),oldRow=history(oldPlayer,match.gameId),newRow=history(player,match.gameId);
 assert.ok(oldRow&&newRow,`${player.name} is missing target history ${match.gameId}`);
 const bottom=['ADC','SUPPORT'].includes(newRow.role);
 assert.equal(Boolean(newRow.duoContextApplied),bottom,`${player.name} ${match.gameId} has an unexpected duo flag`);
 rows.push({gameId:String(match.gameId),player:player.name,role:newRow.role,champion:participant.championName||participant.championKey,oldRole:`${oldRow.roleBefore}->${oldRow.roleAfter} (${oldRow.roleChange>=0?'+':''}${oldRow.roleChange})`,newRole:`${newRow.roleBefore}->${newRow.roleAfter} (${newRow.roleChange>=0?'+':''}${newRow.roleChange})`,oldOverall:`${oldRow.before}->${oldRow.after} (${oldRow.change>=0?'+':''}${oldRow.change})`,newOverall:`${newRow.before}->${newRow.after} (${newRow.change>=0?'+':''}${newRow.change})`,contextAdjustment:newRow.contextAdjustment});
}

const playerChanges=result.players.map(player=>{const old=beforePlayers.get(String(player.id));return {player:player.name,overallBefore:old.ratingV2.overall,overallAfter:player.ratingV2.overall,overallChange:player.ratingV2.overall-old.ratingV2.overall,adcBefore:old.ratingV2.roles.ADC.rating,adcAfter:player.ratingV2.roles.ADC.rating,supportBefore:old.ratingV2.roles.SUPPORT.rating,supportAfter:player.ratingV2.roles.SUPPORT.rating}}).filter(row=>row.overallChange||row.adcBefore!==row.adcAfter||row.supportBefore!==row.supportAfter);
const report={ok:true,version:CKRating.VERSION,diagnostics:result.diagnostics,targetGameIds:[...targetIds],unchangedPrefixGames:prefixIds.size,rows,playerChanges};
await writeFile(join(snapshot,'bot-duo-v41-verification.json'),`${JSON.stringify(report,null,2)}\n`);
console.log(JSON.stringify(report,null,2));
