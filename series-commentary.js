export const SERIES_COMMENTARY_PROMPT_VERSION="2026-09-18.2";

export const SERIES_COMMENTARY_SCHEMA={
  type:"object",
  additionalProperties:false,
  properties:{
    headline:{type:"string"},
    overview:{type:"string"},
    decisiveFactors:{type:"array",maxItems:5,items:{type:"string"}},
    setReviews:{type:"array",maxItems:5,items:{type:"object",additionalProperties:false,properties:{setNumber:{type:"integer"},title:{type:"string"},summary:{type:"string"}},required:["setNumber","title","summary"]}},
    matchupReviews:{type:"array",maxItems:5,items:{type:"object",additionalProperties:false,properties:{role:{type:"string",enum:["탑","정글","미드","원딜","서폿"]},title:{type:"string"},summary:{type:"string"}},required:["role","title","summary"]}},
    notablePlayers:{type:"array",maxItems:6,items:{type:"object",additionalProperties:false,properties:{name:{type:"string"},side:{type:"string",enum:["BLUE","RED"]},summary:{type:"string"}},required:["name","side","summary"]}},
    ratingSummary:{type:"string"},
    dataNotice:{type:"string"},
  },
  required:["headline","overview","decisiveFactors","setReviews","matchupReviews","notablePlayers","ratingSummary","dataNotice"],
};

const roles=["TOP","JUNGLE","MID","ADC","SUPPORT"];
const roleKo={TOP:"탑",JUNGLE:"정글",MID:"미드",ADC:"원딜",SUPPORT:"서폿"};
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const maybeNumber=value=>value===undefined||value===null||value===""||!Number.isFinite(Number(value))?null:Number(value);
const cleanText=(value,max=600)=>String(value??"").replace(/\s+/g," ").trim().slice(0,max);

export function seriesCommentaryKey(value){
  const raw=typeof value==="object"&&value?value.seriesNumber||value.id:value;
  return String(raw??"").trim().replace(/[^A-Za-z0-9_-]/g,"_").slice(0,100);
}

export function findFinishedSeries(state,reference){
  const wanted=String(reference??"").trim(),seriesState=state?.seriesState||{},all=[seriesState.active,...(seriesState.history||[])].filter(Boolean);
  return all.find(series=>series.finished&&(String(series.id)===wanted||String(series.seriesNumber||"")===wanted))||null;
}

const rosterSignature=series=>["BLUE","RED"].flatMap(side=>((side==="BLUE"?series?.blue:series?.red)||[]).map(member=>({side,id:String(member.id),role:String(member.role||"")})).sort((a,b)=>a.id.localeCompare(b.id)));
const overrideSignature=value=>Object.fromEntries(Object.entries(value||{}).map(([id,role])=>[String(id),String(role)]).sort(([a],[b])=>a.localeCompare(b)));
const importedSetSignature=series=>(series?.sets||[]).filter(set=>set?.imported&&set.gameId).map(set=>({number:Math.round(n(set.number)),gameId:String(set.gameId),winner:String(set.winner||""),roleOverrides:overrideSignature(set.roleOverrides)})).sort((a,b)=>a.number-b.number);
const seriesCoreSignature=series=>({id:String(series?.id||""),createdAt:n(series?.createdAt),finished:Boolean(series?.finished),finishedAt:n(series?.finishedAt),finalWinner:String(series?.finalWinner||""),blueCaptainId:String(series?.blueCaptainId||""),redCaptainId:String(series?.redCaptainId||""),pogId:String(series?.pogId||""),roster:rosterSignature(series),sets:importedSetSignature(series)});
const sameJson=(left,right)=>JSON.stringify(left)===JSON.stringify(right);

// Automatic commentary is a paid side effect, so only a server-verifiable
// unfinished -> finished transition is eligible. Invalid app-state writes are
// still saved for backwards compatibility; they simply cannot spend API cost.
export function validateSeriesCommentaryTransition({previousState,nextSeriesState,matches=[],resolveParticipant}={}){
  const fail=code=>({ok:false,code}),before=previousState?.seriesState?.active,after=nextSeriesState?.active;
  if(!before||before.finished||!after?.finished||String(before.id)!==String(after.id))return fail("not_finish_transition");
  const beforeNumber=String(before.seriesNumber||""),afterNumber=String(after.seriesNumber||"");
  if(String(before.createdAt||"")!==String(after.createdAt||"")||(beforeNumber&&beforeNumber!==afterNumber)||(afterNumber&&!/^CKS-[0-9]{8}-[0-9]{3,}$/.test(afterNumber))||String(before.blueCaptainId||"")!==String(after.blueCaptainId||"")||String(before.redCaptainId||"")!==String(after.redCaptainId||""))return fail("series_identity_changed");

  const beforeRoster=rosterSignature(before),afterRoster=rosterSignature(after),registered=new Set((previousState?.players||[]).map(player=>String(player.id)));
  if(beforeRoster.length!==10||new Set(beforeRoster.map(member=>member.id)).size!==10||beforeRoster.some(member=>!registered.has(member.id)))return fail("invalid_roster");
  for(const side of ["BLUE","RED"]){const members=beforeRoster.filter(member=>member.side===side);if(members.length!==5||roles.some(role=>members.filter(member=>member.role===role).length!==1))return fail("invalid_roster")}
  if(!sameJson(beforeRoster,afterRoster))return fail("roster_changed");

  const beforeSets=importedSetSignature(before),afterSets=importedSetSignature(after),sameSets=sameJson(beforeSets,afterSets),oneQueuedSet=afterSets.length===beforeSets.length+1&&sameJson(beforeSets,afterSets.slice(0,-1));
  if(!sameSets&&!oneQueuedSet)return fail("sets_changed_on_finish");
  if(afterSets.length<1||afterSets.length>5)return fail("invalid_set_structure");
  const gameIds=new Set();
  for(let index=0;index<afterSets.length;index++){
    const set=afterSets[index];
    if(set.number!==index+1||!/^[0-9]{6,12}$/.test(set.gameId)||gameIds.has(set.gameId)||!["BLUE","RED"].includes(set.winner))return fail("invalid_set_structure");
    gameIds.add(set.gameId);
  }
  const score={BLUE:afterSets.filter(set=>set.winner==="BLUE").length,RED:afterSets.filter(set=>set.winner==="RED").length},winner=score.BLUE>score.RED?"BLUE":score.RED>score.BLUE?"RED":"",target=Math.max(score.BLUE,score.RED);
  if(!winner||![1,2,3].includes(target)||String(after.finalWinner)!==winner)return fail("invalid_score");
  const running={BLUE:0,RED:0};for(let index=0;index<afterSets.length;index++){running[afterSets[index].winner]++;if(index<afterSets.length-1&&running[afterSets[index].winner]>=target)return fail("invalid_score")}
  const winningRoster=new Set((winner==="BLUE"?after.blue:after.red).map(member=>String(member.id)));if(!winningRoster.has(String(after.pogId||"")))return fail("invalid_pog");

  const previousHistory=previousState?.seriesState?.history||[],nextHistory=Array.isArray(nextSeriesState?.history)?nextSeriesState.history:[];
  if(nextHistory.length!==previousHistory.length+1)return fail("history_mismatch");
  for(let index=0;index<previousHistory.length;index++)if(!sameJson(seriesCoreSignature(previousHistory[index]),seriesCoreSignature(nextHistory[index])))return fail("history_mismatch");
  if(!sameJson(seriesCoreSignature(after),seriesCoreSignature(nextHistory.at(-1))))return fail("history_mismatch");
  const usedGameIds=new Set(previousHistory.flatMap(series=>importedSetSignature(series).map(set=>set.gameId)));if(afterSets.some(set=>usedGameIds.has(set.gameId)))return fail("duplicate_match_use");

  const matchById=new Map(matches.map(match=>[String(match.gameId),match])),sideRosters={BLUE:new Set((after.blue||[]).map(member=>String(member.id))),RED:new Set((after.red||[]).map(member=>String(member.id)))};
  for(const set of afterSets){
    const match=matchById.get(set.gameId),participants=match?.participants;
    if(!match)return fail("match_missing");
    if(!Array.isArray(participants)||participants.length!==10||typeof resolveParticipant!=="function")return fail("invalid_match_teams");
    const resolved=participants.map(participant=>({participant,player:resolveParticipant(participant)}));
    if(resolved.some(entry=>!entry.player)||new Set(resolved.map(entry=>String(entry.player.id))).size!==10)return fail("incomplete_player_mapping");
    const resolvedIds=new Set(resolved.map(entry=>String(entry.player.id)));if(beforeRoster.some(member=>!resolvedIds.has(member.id)))return fail("incomplete_player_mapping");
    const teams=new Map();for(const entry of resolved){const teamId=String(entry.participant.teamId);if(!teams.has(teamId))teams.set(teamId,[]);teams.get(teamId).push(entry)}
    if(teams.size!==2||[...teams.values()].some(team=>team.length!==5))return fail("invalid_match_teams");
    let actualWinner="";
    for(const team of teams.values()){
      const ids=new Set(team.map(entry=>String(entry.player.id))),side=["BLUE","RED"].find(candidate=>ids.size===sideRosters[candidate].size&&[...ids].every(id=>sideRosters[candidate].has(id)));
      if(!side)return fail("invalid_match_teams");
      const wins=new Set(team.map(entry=>Boolean(entry.participant.win)));if(wins.size!==1)return fail("invalid_match_teams");
      if([...wins][0]){if(actualWinner)return fail("invalid_match_teams");actualWinner=side}
    }
    if(!actualWinner||actualWinner!==set.winner)return fail("set_winner_mismatch");
  }
  return {ok:true,code:"ok",series:after,fingerprintInput:JSON.stringify({roster:afterRoster,sets:afterSets,finalWinner:winner})};
}

function teamName(series,side){
  const team=side==="BLUE"?(series.blue||[]):(series.red||[]),captainId=side==="BLUE"?series.blueCaptainId:series.redCaptainId;
  const captain=team.find(player=>String(player.id)===String(captainId))||[...team].sort((a,b)=>n(b.power)-n(a.power))[0];
  return `${cleanText(captain?.name||side,40)} 팀`;
}

function participantMetrics(participant,team){
  const total=key=>team.reduce((sum,item)=>sum+n(item[key]),0),kills=total("kills");
  const result={
    champion:cleanText(participant.championName||"Unknown",40),kills:n(participant.kills),deaths:n(participant.deaths),assists:n(participant.assists),
    kda:Number(((n(participant.kills)+n(participant.assists))/Math.max(1,n(participant.deaths))).toFixed(2)),
    killParticipation:Number(((n(participant.kills)+n(participant.assists))/Math.max(1,kills)).toFixed(3)),
    damage:n(participant.damage),damageShare:Number((n(participant.damage)/Math.max(1,total("damage"))).toFixed(3)),gold:n(participant.gold),goldShare:Number((n(participant.gold)/Math.max(1,total("gold"))).toFixed(3)),
    cs:n(participant.cs),vision:n(participant.vision),
  };
  for(const key of ["damageTaken","mitigated","turretDamage","objectiveDamage","healsOnTeammates","shieldsOnTeammates","ccTime","wardsPlaced","wardsKilled","controlWards","turretKills","inhibitorKills","objectivesStolen","objectivesStolenAssists","soloKills","soloDeaths","tripleKills","quadraKills","pentaKills"]){
    const value=maybeNumber(participant[key]);if(value!==null)result[key]=value;
  }
  return result;
}

function publicRatingEvent(event,playerById){
  return {
    gameId:String(event.gameId||""),role:roleKo[event.role]||event.role||"미확인",win:Boolean(event.win),
    before:maybeNumber(event.before),after:maybeNumber(event.after),change:maybeNumber(event.change),roleBefore:maybeNumber(event.roleBefore),roleAfter:maybeNumber(event.roleAfter),roleChange:maybeNumber(event.roleChange),
    opponent:cleanText(playerById.get(String(event.opponentId))?.name||"확인 불가",40),opponentPower:maybeNumber(event.opponentPower),
    expected:maybeNumber(event.expected),actualMatchup:maybeNumber(event.actualMatchup),residual:maybeNumber(event.residual),quality:maybeNumber(event.quality),reason:cleanText(event.reason,30),
    duoContextApplied:Boolean(event.duoContextApplied),duoChange:maybeNumber(event.duoChange),partnerAdjustment:maybeNumber(event.partnerAdjustment),defensive:Boolean(event.defensive),
  };
}

export function buildSeriesCommentaryEvidence({series,players=[],matches=[],seriesState=null,ratingVersion="",prepareMatches=null,playerResolver=null,positionScore=null}={}){
  if(!series?.finished)throw new Error("완료된 시리즈만 총평할 수 있습니다.");
  const importedSets=(series.sets||[]).filter(set=>set.imported&&set.gameId),setIds=new Set(importedSets.map(set=>String(set.gameId)));
  const prepared=typeof prepareMatches==="function"?prepareMatches(players,matches,seriesState||{active:series,history:[series]}):matches;
  const resolve=typeof playerResolver==="function"?playerResolver(players):(participant=>players.find(player=>String(player.id)===String(participant.playerId)));
  const playerById=new Map(players.map(player=>[String(player.id),player])),memberById=new Map(),sideById=new Map();
  for(const side of ["BLUE","RED"])for(const member of (side==="BLUE"?series.blue:series.red)||[]){memberById.set(String(member.id),member);sideById.set(String(member.id),side)}
  const snapshotById=new Map((series.ratingSnapshot?.players||[]).map(item=>[String(item.id),item])),afterById=new Map(Object.entries(series.powerAfter||{}));
  const seriesReferences=new Set([series.seriesNumber,series.id].filter(value=>value!==undefined&&value!==null&&value!=="").map(String));

  const setReviews=importedSets.map((set,index)=>{
    const match=prepared.find(item=>String(item.gameId)===String(set.gameId));
    if(!match)return {setNumber:n(set.number)||index+1,gameId:String(set.gameId),winner:set.winner,durationMinutes:null,dataAvailable:false,mappingComplete:false,mappedPlayers:0,expectedPlayers:memberById.size,teams:{},players:[],matchups:[],bottomDuo:{}};
    const mapped=(match.participants||[]).map(participant=>{const player=resolve(participant),id=player?String(player.id):"",member=memberById.get(id),side=sideById.get(id);return player&&member&&side?{participant,player,member,side}:null}).filter(Boolean);
    const bySide=side=>mapped.filter(entry=>entry.side===side),teamTotals=side=>{const entries=bySide(side),sum=key=>entries.reduce((total,entry)=>total+n(entry.participant[key]),0);return {kills:sum("kills"),deaths:sum("deaths"),assists:sum("assists"),damage:sum("damage"),gold:sum("gold"),cs:sum("cs"),vision:sum("vision")}};
    const publicPlayers=mapped.map(entry=>{const team=bySide(entry.side).map(item=>item.participant),snapshot=snapshotById.get(String(entry.player.id)),role=set.roleOverrides?.[String(entry.player.id)]||entry.participant.role||entry.member.role,roleEvent=(entry.player.ratingHistory||[]).find(event=>String(event.gameId)===String(set.gameId)&&String(event.role)===String(role)),rolePower=roleEvent?.roleBefore??(snapshot?.role===role?snapshot?.power:null)??(typeof positionScore==="function"?positionScore(entry.player,role):null)??entry.member.power;return {id:String(entry.player.id),name:cleanText(entry.player.name||entry.member.name,40),side:entry.side,role,roleLabel:roleKo[role]||role,startPower:maybeNumber(rolePower),...participantMetrics(entry.participant,team)}});
    const matchups=roles.map(role=>{const blue=publicPlayers.find(player=>player.side==="BLUE"&&player.role===role),red=publicPlayers.find(player=>player.side==="RED"&&player.role===role);return blue&&red?{role,roleLabel:roleKo[role],blue,red}:null}).filter(Boolean);
    const duo=side=>{const duoPlayers=publicPlayers.filter(player=>player.side===side&&["ADC","SUPPORT"].includes(player.role));return {players:duoPlayers.map(player=>({name:player.name,role:player.roleLabel,startPower:player.startPower})),combinedStartPower:duoPlayers.reduce((total,player)=>total+n(player.startPower),0),kills:duoPlayers.reduce((total,player)=>total+player.kills,0),deaths:duoPlayers.reduce((total,player)=>total+player.deaths,0),assists:duoPlayers.reduce((total,player)=>total+player.assists,0),damage:duoPlayers.reduce((total,player)=>total+player.damage,0),gold:duoPlayers.reduce((total,player)=>total+player.gold,0),cs:duoPlayers.reduce((total,player)=>total+player.cs,0),vision:duoPlayers.reduce((total,player)=>total+player.vision,0)}};
    const teamIdToSide=new Map();for(const entry of mapped)if(!teamIdToSide.has(n(entry.participant.teamId)))teamIdToSide.set(n(entry.participant.teamId),entry.side);
    const objectives=(match.epicObjectives||[]).map(event=>({minute:Number((n(event.timestamp)/60000).toFixed(1)),type:cleanText(event.monsterType,30),subType:cleanText(event.monsterSubType,40),side:teamIdToSide.get(n(event.teamId))||"UNKNOWN"}));
    return {setNumber:n(set.number)||index+1,gameId:String(set.gameId),winner:set.winner,durationMinutes:Number((n(match.duration)/60).toFixed(1)),dataAvailable:true,mappingComplete:mapped.length===memberById.size,mappedPlayers:mapped.length,expectedPlayers:memberById.size,teams:{BLUE:teamTotals("BLUE"),RED:teamTotals("RED")},players:publicPlayers,matchups,bottomDuo:{BLUE:duo("BLUE"),RED:duo("RED")},objectives};
  });

  const roster=[...(series.blue||[]).map(member=>({...member,side:"BLUE"})),...(series.red||[]).map(member=>({...member,side:"RED"}))];
  const ratingChanges=roster.map(member=>{
    const player=playerById.get(String(member.id)),snapshot=snapshotById.get(String(member.id));
    const events=(player?.ratingHistory||[]).filter(event=>(seriesReferences.has(String(event.seriesId))||setIds.has(String(event.gameId)))&&setIds.has(String(event.gameId))).sort((a,b)=>n(a.time)-n(b.time));
    const publicEvents=events.map(event=>publicRatingEvent(event,playerById)),first=publicEvents[0],last=publicEvents.at(-1),overallChange=publicEvents.reduce((total,event)=>total+n(event.change),0),roleChange=publicEvents.reduce((total,event)=>total+n(event.roleChange),0);
    const overallBefore=maybeNumber(snapshot?.overall??member.overallPower??first?.before??member.power),roleBefore=maybeNumber(snapshot?.power??first?.roleBefore??member.power);
    const overallAfter=maybeNumber(afterById.get(String(member.id))??(overallBefore===null?last?.after:overallBefore+overallChange)),roleAfter=maybeNumber(roleBefore===null?last?.roleAfter:roleBefore+roleChange);
    return {id:String(member.id),name:cleanText(player?.name||member.name,40),side:member.side,assignedRole:member.role,assignedRoleLabel:roleKo[member.role]||member.role,overallBefore,overallAfter,overallChange:overallBefore!==null&&overallAfter!==null?overallAfter-overallBefore:overallChange,roleBefore,roleAfter,roleChange:roleBefore!==null&&roleAfter!==null?roleAfter-roleBefore:roleChange,events:publicEvents};
  });
  const score={BLUE:importedSets.filter(set=>set.winner==="BLUE").length,RED:importedSets.filter(set=>set.winner==="RED").length},pog=roster.find(member=>String(member.id)===String(series.pogId));
  return {
    policy:{ratingVersion:ratingVersion||series.ratingSnapshot?.version||"unknown",explanationOnly:true,primaryComparison:"same-role opponent",bottomLaneContext:"ADC and SUPPORT use both direct matchup and 2v2 context",limits:"Final scoreboard and collected objective events cannot prove unrecorded shotcalls, lane trades, rotations, or causal game flow."},
    series:{id:String(series.id||""),seriesNumber:String(series.seriesNumber||series.id||""),finishedAt:n(series.finishedAt),blueTeam:teamName(series,"BLUE"),redTeam:teamName(series,"RED"),score,winner:series.finalWinner,pog:pog?{name:cleanText(pog.name,40),score:n(series.pogScore)}:null},
    sets:setReviews,ratingChanges,
  };
}

export function sanitizeSeriesCommentary(value){
  if(!value||typeof value!=="object")return null;
  const item=(entry,fields)=>Object.fromEntries(fields.map(([key,max])=>[key,cleanText(entry?.[key],max)]));
  const review={
    headline:cleanText(value.headline,120),overview:cleanText(value.overview,1000),
    decisiveFactors:(Array.isArray(value.decisiveFactors)?value.decisiveFactors:[]).slice(0,5).map(text=>cleanText(text,400)).filter(Boolean),
    setReviews:(Array.isArray(value.setReviews)?value.setReviews:[]).slice(0,5).map(entry=>({setNumber:Math.max(1,Math.round(n(entry?.setNumber))),...item(entry,[["title",100],["summary",600]])})).filter(entry=>entry.title||entry.summary),
    matchupReviews:(Array.isArray(value.matchupReviews)?value.matchupReviews:[]).slice(0,5).map(entry=>({role:roles.map(role=>roleKo[role]).includes(entry?.role)?entry.role:"",...item(entry,[["title",100],["summary",600]])})).filter(entry=>entry.role&&(entry.title||entry.summary)),
    notablePlayers:(Array.isArray(value.notablePlayers)?value.notablePlayers:[]).slice(0,6).map(entry=>({name:cleanText(entry?.name,40),side:["BLUE","RED"].includes(entry?.side)?entry.side:"BLUE",summary:cleanText(entry?.summary,500)})).filter(entry=>entry.name&&entry.summary),
    ratingSummary:cleanText(value.ratingSummary,800),dataNotice:cleanText(value.dataNotice,500),
  };
  return review.headline&&review.overview?review:null;
}
