export const SERIES_COMMENTARY_PROMPT_VERSION="2026-09-18.3";

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

const timelineMinute=timestamp=>Number((n(timestamp)/60000).toFixed(2));
const timelineParticipantId=(participant,index)=>{const explicit=maybeNumber(participant?.participantId);return explicit!==null&&explicit>0?Math.round(explicit):index+1};
const oppositeSide=side=>side==="BLUE"?"RED":side==="RED"?"BLUE":"UNKNOWN";
const meaningfulLead=(difference,threshold=250)=>difference>threshold?"BLUE":difference<-threshold?"RED":"EVEN";
const compactTimelinePlayer=entry=>entry?{participantId:entry.participantId,playerId:entry.playerId,name:entry.name,side:entry.side,champion:entry.champion}:null;

function unavailableTimelineEvidence(match,reason="timeline.frames가 없습니다."){
  return {
    available:false,
    coverage:{frameCount:0,goldFrameCount:0,completeGoldFrameCount:0,eventCount:0,firstMinute:null,lastMinute:null,matchDurationMinutes:Number((n(match?.duration)/60).toFixed(1)),coveredDurationRatio:0,mappedParticipants:0,expectedParticipants:(match?.participants||[]).length,participantIdFallbacks:0,filteredCrossTeamAssists:0,droppedUnknownAssists:0},
    confidence:{overall:"unavailable",gold:"unavailable",events:"unavailable"},
    summary:null,teamGold:[],maxLeads:{BLUE:{gold:0,minute:null},RED:{gold:0,minute:null}},biggestSwings:[],leadChanges:[],killClusters:[],turningPoints:[],objectives:[],buildings:[],
    limitations:[reason,"시야, 순간 체력, 스킬·소환사 주문, 팀 호출, 교전별 피해량은 타임라인만으로 확인할 수 없습니다."],
  };
}

export function buildMatchTimelineEvidence({match,mapped=[],teamIdToSide=new Map()}={}){
  const timelineContainer=match?.timeline,timeline=timelineContainer?.info?.frames?timelineContainer.info:timelineContainer,rawFrames=Array.isArray(timeline?.frames)?timeline.frames:[],topLevelEvents=[...(Array.isArray(timeline?.events)?timeline.events:[]),...(timeline!==timelineContainer&&Array.isArray(timelineContainer?.events)?timelineContainer.events:[])];
  if(!rawFrames.length&&!topLevelEvents.length)return unavailableTimelineEvidence(match);

  const participantMap=new Map(),mappedByParticipant=new Map(mapped.map(entry=>[entry.participant,entry]));
  let participantIdFallbacks=0,duplicateParticipantIds=0;
  for(const [index,participant] of (match.participants||[]).entries()){
    const explicit=maybeNumber(participant?.participantId),participantId=timelineParticipantId(participant,index);if(explicit===null||explicit<=0)participantIdFallbacks++;
    const linked=mappedByParticipant.get(participant),side=linked?.side||teamIdToSide.get(n(participant.teamId))||"UNKNOWN",entry={participantId,playerId:linked?String(linked.player.id):"",name:cleanText(linked?.player?.name||linked?.member?.name||`참가자 ${participantId}`,40),side,champion:cleanText(participant.championName||participant.championKey||participant.championId||"Unknown",40),teamId:n(participant.teamId)};
    if(participantMap.has(String(participantId)))duplicateParticipantIds++;else participantMap.set(String(participantId),entry);
  }
  const expectedBySide={BLUE:0,RED:0};for(const entry of participantMap.values())if(expectedBySide[entry.side]!==undefined)expectedBySide[entry.side]++;
  const playerRef=value=>{const participantId=Math.round(n(value));return participantId>0?(participantMap.get(String(participantId))||{participantId,playerId:"",name:`참가자 ${participantId}`,side:"UNKNOWN",champion:"Unknown",teamId:0}):null};
  const frameRows=[];
  for(const frame of rawFrames){
    const timestamp=maybeNumber(frame?.timestamp);if(timestamp===null||timestamp<0)continue;
    const rawParticipantFrames=frame?.participantFrames,values=Array.isArray(rawParticipantFrames)?rawParticipantFrames.map((value,index)=>[value?.participantId??index+1,value]):rawParticipantFrames&&typeof rawParticipantFrames==="object"?Object.entries(rawParticipantFrames).map(([key,value])=>[value?.participantId??key,value]):[];
    const gold={BLUE:0,RED:0},counts={BLUE:0,RED:0};
    for(const [rawId,value] of values){const entry=participantMap.get(String(Math.round(n(rawId)))),totalGold=maybeNumber(value?.totalGold);if(!entry||!gold.hasOwnProperty(entry.side)||totalGold===null||totalGold<0)continue;gold[entry.side]+=Math.round(totalGold);counts[entry.side]++}
    const hasBoth=counts.BLUE>0&&counts.RED>0,complete=hasBoth&&duplicateParticipantIds===0&&expectedBySide.BLUE>0&&expectedBySide.RED>0&&counts.BLUE===expectedBySide.BLUE&&counts.RED===expectedBySide.RED;
    frameRows.push({timestamp,minute:timelineMinute(timestamp),BLUE:gold.BLUE,RED:gold.RED,difference:gold.BLUE-gold.RED,counts,hasBoth,complete});
  }
  frameRows.sort((a,b)=>a.timestamp-b.timestamp);const uniqueFrames=[...new Map(frameRows.map(frame=>[frame.timestamp,frame])).values()],teamGoldFrames=uniqueFrames.filter(frame=>frame.complete);

  let filteredCrossTeamAssists=0,droppedUnknownAssists=0;
  const assistsFor=(ids,side,killerId=0)=>{
    const result=[],seen=new Set();for(const rawId of Array.isArray(ids)?ids:[]){const id=Math.round(n(rawId));if(id<=0||id===killerId||seen.has(id))continue;seen.add(id);const entry=participantMap.get(String(id));if(!entry){droppedUnknownAssists++;continue}if(["BLUE","RED"].includes(side)&&entry.side!==side){filteredCrossTeamAssists++;continue}result.push(entry)}return result;
  };
  const rawEvents=[],seenEvents=new Set();let eventOrder=0;
  const addEvent=(event,fallbackTimestamp=null)=>{const type=String(event?.type||"").toUpperCase();if(!["CHAMPION_KILL","BUILDING_KILL","ELITE_MONSTER_KILL"].includes(type))return;const timestamp=maybeNumber(event.timestamp)??maybeNumber(fallbackTimestamp);if(timestamp===null||timestamp<0)return;const key=[type,timestamp,n(event.killerId),n(event.victimId),n(event.teamId),cleanText(event.monsterType,30),cleanText(event.monsterSubType,40),cleanText(event.buildingType,40),cleanText(event.laneType,30),cleanText(event.towerType,30),n(event.position?.x),n(event.position?.y)].join("|");if(seenEvents.has(key))return;seenEvents.add(key);rawEvents.push({event,type,timestamp,order:eventOrder++})};
  for(const event of topLevelEvents)addEvent(event);
  for(const frame of rawFrames)for(const event of Array.isArray(frame?.events)?frame.events:[])addEvent(event,frame.timestamp);
  rawEvents.sort((a,b)=>a.timestamp-b.timestamp||a.order-b.order);
  const kills=[],objectives=[],buildings=[];
  for(const row of rawEvents){
    const {event,type,timestamp}=row,killerId=Math.round(n(event.killerId)),killer=playerRef(killerId),position=maybeNumber(event.position?.x)!==null&&maybeNumber(event.position?.y)!==null?{x:Math.round(n(event.position.x)),y:Math.round(n(event.position.y))}:null;
    if(type==="CHAMPION_KILL"){
      const victimId=Math.round(n(event.victimId)),victim=playerRef(victimId),side=killer?.side&&killer.side!=="UNKNOWN"?killer.side:oppositeSide(victim?.side),assists=assistsFor(event.assistingParticipantIds,side,killerId);
      kills.push({timestamp,minute:timelineMinute(timestamp),killerId,victimId,killer,victim,side,assists,position,participantIds:new Set([killerId,victimId,...assists.map(entry=>entry.participantId)].filter(id=>id>0))});
    }else if(type==="ELITE_MONSTER_KILL"){
      const side=killer?.side&&killer.side!=="UNKNOWN"?killer.side:teamIdToSide.get(n(event.killerTeamId||event.teamId))||"UNKNOWN",assists=assistsFor(event.assistingParticipantIds,side,killerId);
      objectives.push({timestamp,minute:timelineMinute(timestamp),side,type:cleanText(event.monsterType,30),subType:cleanText(event.monsterSubType,40),killer:compactTimelinePlayer(killer),assists:assists.map(compactTimelinePlayer),position});
    }else{
      const destroyedSide=teamIdToSide.get(n(event.teamId))||"UNKNOWN",side=killer?.side&&killer.side!=="UNKNOWN"?killer.side:oppositeSide(destroyedSide),assists=assistsFor(event.assistingParticipantIds,side,killerId);
      buildings.push({timestamp,minute:timelineMinute(timestamp),side,destroyedSide,type:cleanText(event.buildingType,40),lane:cleanText(event.laneType,30),tower:cleanText(event.towerType,30),killer:compactTimelinePlayer(killer),assists:assists.map(compactTimelinePlayer),position});
    }
  }

  const distance=(left,right)=>left&&right?Math.hypot(left.x-right.x,left.y-right.y):Infinity,clusters=[];
  for(const kill of kills){
    const previous=clusters.at(-1),last=previous?.events.at(-1),gap=last?kill.timestamp-last.timestamp:Infinity,minDistance=previous&&kill.position?Math.min(...previous.events.filter(item=>item.position).map(item=>distance(kill.position,item.position)),Infinity):Infinity,overlap=previous?[...kill.participantIds].some(id=>previous.participantIds.has(id)):false,locationCompatible=Number.isFinite(minDistance)?minDistance<=3500:gap<=20000;
    if(previous&&gap<=45000&&(locationCompatible||overlap)){previous.events.push(kill);previous.end=kill.timestamp;for(const id of kill.participantIds)previous.participantIds.add(id)}else clusters.push({start:kill.timestamp,end:kill.timestamp,events:[kill],participantIds:new Set(kill.participantIds)});
  }
  const frameBefore=timestamp=>{let result=null;for(const frame of teamGoldFrames){if(frame.timestamp>timestamp)break;result=frame}return result},frameAfter=timestamp=>teamGoldFrames.find(frame=>frame.timestamp>=timestamp)||null;
  const conversionRows=[...objectives.map(event=>({...event,kind:"objective",label:[event.type,event.subType].filter(Boolean).join("/")})),...buildings.map(event=>({...event,kind:"building",label:[event.lane,event.tower||event.type].filter(Boolean).join("/")}))].sort((a,b)=>a.timestamp-b.timestamp);
  const clusterRows=clusters.map((cluster,index)=>{
    const killsBySide={BLUE:0,RED:0},involvement=new Map(),touch=(entry,key)=>{if(!entry)return;const id=String(entry.participantId),value=involvement.get(id)||{...compactTimelinePlayer(entry),kills:0,deaths:0,assists:0};value[key]++;involvement.set(id,value)};
    for(const event of cluster.events){if(killsBySide[event.side]!==undefined)killsBySide[event.side]++;touch(event.killer,"kills");touch(event.victim,"deaths");for(const assist of event.assists)touch(assist,"assists")}
    const result=killsBySide.BLUE>killsBySide.RED?"BLUE":killsBySide.RED>killsBySide.BLUE?"RED":"EVEN",before=frameBefore(cluster.start),after=frameAfter(cluster.end),beforeLead=before?meaningfulLead(before.difference):"EVEN",afterLead=after?meaningfulLead(after.difference):"EVEN",gold=before&&after?{beforeMinute:before.minute,afterMinute:after.minute,beforeDifference:before.difference,afterDifference:after.difference,change:after.difference-before.difference,towardSide:after.difference-before.difference>0?"BLUE":after.difference-before.difference<0?"RED":"EVEN",leadChanged:["BLUE","RED"].includes(beforeLead)&&["BLUE","RED"].includes(afterLead)&&beforeLead!==afterLead}:null,conversions=conversionRows.filter(event=>event.timestamp>=cluster.start-5000&&event.timestamp<=cluster.end+90000&&(result==="EVEN"||event.side===result)).map(event=>({kind:event.kind,minute:event.minute,side:event.side,label:event.label,killer:event.killer?.name||""})),positions=cluster.events.map(event=>event.position).filter(Boolean),players=[...involvement.values()].sort((a,b)=>(b.kills+b.assists+b.deaths)-(a.kills+a.assists+a.deaths)||a.participantId-b.participantId),firstDeath=compactTimelinePlayer(cluster.events[0]?.victim),sequence=cluster.events.map(event=>({minute:event.minute,killer:event.killer?.name||`참가자 ${event.killerId}`,victim:event.victim?.name||`참가자 ${event.victimId}`,assists:event.assists.map(entry=>entry.name)}));
    const center=positions.length?{x:Math.round(positions.reduce((sum,item)=>sum+item.x,0)/positions.length),y:Math.round(positions.reduce((sum,item)=>sum+item.y,0)/positions.length)}:null,totalKills=cluster.events.length,importance=(gold?Math.abs(gold.change):0)+totalKills*250+conversions.length*600+(gold?.leadChanged?2000:0);
    return {fightId:`F${String(index+1).padStart(2,"0")}`,startMinute:timelineMinute(cluster.start),endMinute:timelineMinute(cluster.end),durationSeconds:Number(((cluster.end-cluster.start)/1000).toFixed(1)),kills:killsBySide,result,firstDeath,center,gold,conversions,players,sequence,_importance:importance,_totalKills:totalKills};
  });
  const retainedFightIds=new Set([...clusterRows].filter(row=>row._totalKills>=2||row.conversions.length||Math.abs(row.gold?.change||0)>=1000).sort((a,b)=>b._importance-a._importance||a.startMinute-b.startMinute).slice(0,15).map(row=>row.fightId)),killClusters=clusterRows.filter(row=>retainedFightIds.has(row.fightId)).map(({_importance,_totalKills,...row})=>row),turningPoints=[...clusterRows].filter(row=>row._totalKills>=2||row.conversions.length||Math.abs(row.gold?.change||0)>=1000).sort((a,b)=>b._importance-a._importance||a.startMinute-b.startMinute).slice(0,5).sort((a,b)=>a.startMinute-b.startMinute).map(row=>({fightId:row.fightId,startMinute:row.startMinute,endMinute:row.endMinute,result:row.result,kills:row.kills,firstDeath:row.firstDeath,gold:row.gold,conversions:row.conversions,keyPlayers:row.players.slice(0,5)}));

  const maxFor=side=>{const ranked=teamGoldFrames.map(frame=>({gold:side==="BLUE"?frame.difference:-frame.difference,minute:frame.minute})).filter(row=>row.gold>0).sort((a,b)=>b.gold-a.gold||a.minute-b.minute);return ranked[0]||{gold:0,minute:null}},maxLeads={BLUE:maxFor("BLUE"),RED:maxFor("RED")};
  const biggestSwings=[];for(const windowMinutes of [1,2,3]){let best=null;for(let index=0;index<teamGoldFrames.length-1;index++){const start=teamGoldFrames[index],target=start.timestamp+windowMinutes*60000,candidates=teamGoldFrames.slice(index+1).map(frame=>({frame,error:Math.abs(frame.timestamp-target)})).filter(item=>item.error<=30000).sort((a,b)=>a.error-b.error||a.frame.timestamp-b.frame.timestamp);if(!candidates.length)continue;const end=candidates[0].frame,change=end.difference-start.difference,row={windowMinutes,fromMinute:start.minute,toMinute:end.minute,fromDifference:start.difference,toDifference:end.difference,change,amount:Math.abs(change),towardSide:change>0?"BLUE":change<0?"RED":"EVEN"};if(!best||row.amount>best.amount||(row.amount===best.amount&&row.fromMinute<best.fromMinute))best=row}if(best)biggestSwings.push(best)}
  const leadChanges=[];let previousLead=null;for(const frame of teamGoldFrames){const side=meaningfulLead(frame.difference);if(side==="EVEN")continue;if(previousLead&&previousLead.side!==side)leadChanges.push({fromSide:previousLead.side,toSide:side,fromMinute:previousLead.minute,toMinute:frame.minute,fromDifference:previousLead.difference,toDifference:frame.difference});previousLead={side,minute:frame.minute,difference:frame.difference}}

  const firstMinute=uniqueFrames.length?uniqueFrames[0].minute:null,lastMinute=uniqueFrames.length?uniqueFrames.at(-1).minute:null,matchDurationMinutes=n(match.duration)>0?n(match.duration)/60:0,coveredDurationRatio=matchDurationMinutes&&lastMinute!==null?Number(Math.min(1,lastMinute/matchDurationMinutes).toFixed(3)):0,completeRate=uniqueFrames.length?teamGoldFrames.length/uniqueFrames.length:0,mappedParticipants=[...participantMap.values()].filter(entry=>entry.playerId).length,eventMappingComplete=kills.every(event=>["BLUE","RED"].includes(event.side)&&event.victim&&["BLUE","RED"].includes(event.victim.side)),goldConfidence=teamGoldFrames.length>=2?(completeRate>=.8&&coveredDurationRatio>=.85?"high":"partial"):"unavailable",eventConfidence=rawEvents.length?(eventMappingComplete&&mappedParticipants===(match.participants||[]).length?"high":"partial"):"unavailable",overall=goldConfidence==="high"&&["high","unavailable"].includes(eventConfidence)?"high":goldConfidence!=="unavailable"||eventConfidence!=="unavailable"?"medium":"low",limitations=["팀 골드는 양 팀의 모든 참가자 totalGold가 있는 프레임만 사용했습니다.","킬 군집은 45초 이내이며 위치가 가깝거나 참여자가 겹치는 이벤트를 묶은 추정 교전입니다.","시야, 순간 체력, 스킬·소환사 주문, 팀 호출, 교전별 피해량은 없어 개인 책임이나 인과관계를 확정할 수 없습니다."];
  if(participantIdFallbacks)limitations.push(`participantId가 없는 ${participantIdFallbacks}명은 participants 배열 순서+1로 매핑했습니다.`);if(filteredCrossTeamAssists)limitations.push(`이벤트 팀과 다른 어시스트 ${filteredCrossTeamAssists}건을 제외했습니다.`);if(droppedUnknownAssists)limitations.push(`참가자를 찾을 수 없는 어시스트 ${droppedUnknownAssists}건을 제외했습니다.`);if(duplicateParticipantIds)limitations.push(`중복 participantId ${duplicateParticipantIds}건은 첫 참가자만 사용했습니다.`);if(coveredDurationRatio<.85)limitations.push("타임라인이 경기 종료 시점까지 충분히 덮지 않습니다.");
  const finalGold=teamGoldFrames.at(-1)||null;
  return {
    available:true,
    coverage:{frameCount:uniqueFrames.length,goldFrameCount:uniqueFrames.filter(frame=>frame.hasBoth).length,completeGoldFrameCount:teamGoldFrames.length,eventCount:rawEvents.length,killEventCount:kills.length,objectiveEventCount:objectives.length,buildingEventCount:buildings.length,firstMinute,lastMinute,matchDurationMinutes:Number(matchDurationMinutes.toFixed(1)),coveredDurationRatio,mappedParticipants,expectedParticipants:(match.participants||[]).length,participantIdFallbacks,filteredCrossTeamAssists,droppedUnknownAssists},
    confidence:{overall,gold:goldConfidence,events:eventConfidence},
    summary:{goldDifferenceDefinition:"BLUE minus RED",leadChangeThresholdGold:250,finalGold:finalGold?{minute:finalGold.minute,BLUE:finalGold.BLUE,RED:finalGold.RED,difference:finalGold.difference,leader:meaningfulLead(finalGold.difference,0)}:null,maxLeads,leadChangeCount:leadChanges.length,killClusterCount:clusters.length,retainedKillClusterCount:killClusters.length,objectiveCount:objectives.length,buildingCount:buildings.length},
    teamGold:teamGoldFrames.map(({minute,BLUE,RED,difference})=>({minute,BLUE,RED,difference})),maxLeads,biggestSwings,leadChanges,killClusters,turningPoints,
    objectives:objectives.slice(0,30).map(({timestamp,...event})=>event),buildings:buildings.slice(0,30).map(({timestamp,...event})=>event),limitations,
  };
}

function compactTimelineForCommentary(timeline){
  if(!timeline?.available)return timeline;
  const checkpointIndexes=new Set();
  for(const [index,frame] of timeline.teamGold.entries()){
    const rounded=Math.round(frame.minute);
    if(index===0||index===timeline.teamGold.length-1||(rounded%5===0&&Math.abs(frame.minute-rounded)<=.08))checkpointIndexes.add(index);
  }
  const compactPlayer=player=>player?{name:player.name,side:player.side,champion:player.champion}:null;
  return {
    available:true,coverage:timeline.coverage,confidence:timeline.confidence,summary:timeline.summary,
    teamGoldCheckpoints:timeline.teamGold.filter((_,index)=>checkpointIndexes.has(index)),maxLeads:timeline.maxLeads,biggestSwings:timeline.biggestSwings,leadChanges:timeline.leadChanges,
    turningPoints:timeline.turningPoints.map(point=>({...point,firstDeath:compactPlayer(point.firstDeath),keyPlayers:point.keyPlayers.map(player=>({name:player.name,side:player.side,kills:player.kills,deaths:player.deaths,assists:player.assists}))})),
    objectives:timeline.objectives.map(event=>({minute:event.minute,side:event.side,type:event.type,subType:event.subType,killer:event.killer?.name||""})),
    buildings:timeline.buildings.map(event=>({minute:event.minute,side:event.side,destroyedSide:event.destroyedSide,type:event.type,lane:event.lane,tower:event.tower,killer:event.killer?.name||""})),
    limitations:timeline.limitations,
  };
}

export function compactSeriesCommentaryEvidence(evidence){
  if(!evidence||typeof evidence!=="object")return evidence;
  return {...evidence,sets:(evidence.sets||[]).map(set=>({...set,timeline:compactTimelineForCommentary(set.timeline)}))};
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
    if(!match)return {setNumber:n(set.number)||index+1,gameId:String(set.gameId),winner:set.winner,durationMinutes:null,dataAvailable:false,mappingComplete:false,mappedPlayers:0,expectedPlayers:memberById.size,teams:{},players:[],matchups:[],bottomDuo:{},timeline:unavailableTimelineEvidence(null,"경기 데이터가 없습니다.")};
    const mapped=(match.participants||[]).map(participant=>{const player=resolve(participant),id=player?String(player.id):"",member=memberById.get(id),side=sideById.get(id);return player&&member&&side?{participant,player,member,side}:null}).filter(Boolean);
    const bySide=side=>mapped.filter(entry=>entry.side===side),teamTotals=side=>{const entries=bySide(side),sum=key=>entries.reduce((total,entry)=>total+n(entry.participant[key]),0);return {kills:sum("kills"),deaths:sum("deaths"),assists:sum("assists"),damage:sum("damage"),gold:sum("gold"),cs:sum("cs"),vision:sum("vision")}};
    const publicPlayers=mapped.map(entry=>{const team=bySide(entry.side).map(item=>item.participant),snapshot=snapshotById.get(String(entry.player.id)),role=set.roleOverrides?.[String(entry.player.id)]||entry.member.role||entry.participant.role,roleEvent=(entry.player.ratingHistory||[]).find(event=>String(event.gameId)===String(set.gameId)&&String(event.role)===String(role)),rolePower=roleEvent?.roleBefore??(snapshot?.role===role?snapshot?.power:null)??(typeof positionScore==="function"?positionScore(entry.player,role):null)??entry.member.power;return {id:String(entry.player.id),name:cleanText(entry.player.name||entry.member.name,40),side:entry.side,role,roleLabel:roleKo[role]||role,startPower:maybeNumber(rolePower),...participantMetrics(entry.participant,team)}});
    const matchups=roles.map(role=>{const blue=publicPlayers.find(player=>player.side==="BLUE"&&player.role===role),red=publicPlayers.find(player=>player.side==="RED"&&player.role===role);return blue&&red?{role,roleLabel:roleKo[role],blue,red}:null}).filter(Boolean);
    const duo=side=>{const duoPlayers=publicPlayers.filter(player=>player.side===side&&["ADC","SUPPORT"].includes(player.role));return {players:duoPlayers.map(player=>({name:player.name,role:player.roleLabel,startPower:player.startPower})),combinedStartPower:duoPlayers.reduce((total,player)=>total+n(player.startPower),0),kills:duoPlayers.reduce((total,player)=>total+player.kills,0),deaths:duoPlayers.reduce((total,player)=>total+player.deaths,0),assists:duoPlayers.reduce((total,player)=>total+player.assists,0),damage:duoPlayers.reduce((total,player)=>total+player.damage,0),gold:duoPlayers.reduce((total,player)=>total+player.gold,0),cs:duoPlayers.reduce((total,player)=>total+player.cs,0),vision:duoPlayers.reduce((total,player)=>total+player.vision,0)}};
    const teamSideVotes=new Map();for(const entry of mapped){const teamId=n(entry.participant.teamId),votes=teamSideVotes.get(teamId)||{BLUE:0,RED:0};votes[entry.side]++;teamSideVotes.set(teamId,votes)}
    const teamIdToSide=new Map();for(const [teamId,votes] of teamSideVotes)if(Boolean(votes.BLUE)!==Boolean(votes.RED))teamIdToSide.set(teamId,votes.BLUE?"BLUE":"RED");
    const matchTeamIds=[...new Set((match.participants||[]).map(participant=>n(participant.teamId)).filter(Boolean))];if(matchTeamIds.length===2&&teamIdToSide.size===1){const knownTeam=matchTeamIds.find(teamId=>teamIdToSide.has(teamId)),otherTeam=matchTeamIds.find(teamId=>teamId!==knownTeam);if(knownTeam!==undefined&&otherTeam!==undefined)teamIdToSide.set(otherTeam,oppositeSide(teamIdToSide.get(knownTeam)))}
    const objectives=(match.epicObjectives||[]).map(event=>({minute:Number((n(event.timestamp)/60000).toFixed(1)),type:cleanText(event.monsterType,30),subType:cleanText(event.monsterSubType,40),side:teamIdToSide.get(n(event.teamId))||"UNKNOWN"}));
    const timeline=buildMatchTimelineEvidence({match,mapped,teamIdToSide});
    return {setNumber:n(set.number)||index+1,gameId:String(set.gameId),winner:set.winner,durationMinutes:Number((n(match.duration)/60).toFixed(1)),dataAvailable:true,mappingComplete:mapped.length===memberById.size,mappedPlayers:mapped.length,expectedPlayers:memberById.size,teams:{BLUE:teamTotals("BLUE"),RED:teamTotals("RED")},players:publicPlayers,matchups,bottomDuo:{BLUE:duo("BLUE"),RED:duo("RED")},objectives,timeline};
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
  const score={BLUE:importedSets.filter(set=>set.winner==="BLUE").length,RED:importedSets.filter(set=>set.winner==="RED").length},pog=roster.find(member=>String(member.id)===String(series.pogId)),timelineCoverage={setsTotal:setReviews.length,setsAvailable:setReviews.filter(set=>set.timeline?.available).length,setsWithCompleteGold:setReviews.filter(set=>n(set.timeline?.coverage?.completeGoldFrameCount)>0).length,totalFrames:setReviews.reduce((total,set)=>total+n(set.timeline?.coverage?.frameCount),0),totalCompleteGoldFrames:setReviews.reduce((total,set)=>total+n(set.timeline?.coverage?.completeGoldFrameCount),0),totalEvents:setReviews.reduce((total,set)=>total+n(set.timeline?.coverage?.eventCount),0),confidenceBySet:setReviews.map(set=>({setNumber:set.setNumber,overall:set.timeline?.confidence?.overall||"unavailable",gold:set.timeline?.confidence?.gold||"unavailable",events:set.timeline?.confidence?.events||"unavailable"}))};
  return {
    policy:{ratingVersion:ratingVersion||series.ratingSnapshot?.version||"unknown",explanationOnly:true,primaryComparison:"same-role opponent",bottomLaneContext:"ADC and SUPPORT use both direct matchup and 2v2 context",limits:"Scoreboard, periodic timeline frames, and recorded events cannot prove unrecorded shotcalls, vision, momentary health, combat damage, or causal game flow."},
    series:{id:String(series.id||""),seriesNumber:String(series.seriesNumber||series.id||""),finishedAt:n(series.finishedAt),blueTeam:teamName(series,"BLUE"),redTeam:teamName(series,"RED"),score,winner:series.finalWinner,pog:pog?{name:cleanText(pog.name,40),score:n(series.pogScore)}:null},
    timelineCoverage,sets:setReviews,ratingChanges,
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
