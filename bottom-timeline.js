// Compact, deterministic bottom-lane evidence derived from the Riot timeline.
// The summary is stored with the match so rating recalculation never has to
// read the much larger timeline JSON again.
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const roleOf=participant=>String(participant?.role||"").toUpperCase();
const participantId=(participant,index)=>Math.round(n(participant?.participantId))||index+1;
const isBottomPosition=position=>position&&n(position.x)>=9000&&n(position.y)<=7000;

export const BOTTOM_TIMELINE_SUMMARY_VERSION="bottom-lane-v1";

export function buildBottomTimelineSummary(input){
  const timeline=input?.info?.frames?input.info:input,frames=Array.isArray(timeline?.frames)?timeline.frames:[],events=Array.isArray(timeline?.events)?timeline.events:[];
  if(!frames.length)return null;
  const checkpoint=minute=>{
    const target=minute*60000,frame=[...frames].filter(item=>Array.isArray(item?.participantFrames)).sort((left,right)=>Math.abs(n(left.timestamp)-target)-Math.abs(n(right.timestamp)-target))[0];
    if(!frame||Math.abs(n(frame.timestamp)-target)>90000)return null;
    const players=frame.participantFrames.map((value,index)=>({participantId:Math.round(n(value?.participantId))||index+1,gold:Math.round(n(value?.totalGold)),cs:Math.round(n(value?.minionsKilled)),xp:Math.round(n(value?.xp)),level:Math.round(n(value?.level))})).filter(value=>value.participantId>0).sort((left,right)=>left.participantId-right.participantId);
    return players.length>=10?{minute:Number((n(frame.timestamp)/60000).toFixed(2)),players}:null;
  };
  const checkpoints={10:checkpoint(10),15:checkpoint(15)};
  const earlyKills=events.filter(event=>String(event?.type||"").toUpperCase()==="CHAMPION_KILL"&&n(event.timestamp)<=15*60000&&isBottomPosition(event.position)).map(event=>({
    minute:Number((n(event.timestamp)/60000).toFixed(2)),killerId:Math.round(n(event.killerId)),victimId:Math.round(n(event.victimId)),assistingParticipantIds:[...new Set((event.assistingParticipantIds||[]).map(value=>Math.round(n(value))).filter(Boolean))],position:{x:Math.round(n(event.position?.x)),y:Math.round(n(event.position?.y))},
  })).filter(event=>event.killerId&&event.victimId);
  if(!checkpoints[10]&&!checkpoints[15]&&!earlyKills.length)return null;
  return {version:BOTTOM_TIMELINE_SUMMARY_VERSION,checkpoints,earlyKills,confidence:checkpoints[10]&&checkpoints[15]?"high":"partial"};
}

const valueAt=(checkpoint,id,key)=>checkpoint?.players?.find(player=>player.participantId===id)?.[key]??null;
const scaled=(value,scale)=>Math.tanh(n(value)/scale);

export function evaluateBottomTimeline(match){
  const summary=match?.ratingTimeline||buildBottomTimelineSummary(match?.timeline);
  if(!summary)return null;
  const participants=(match.participants||[]).map((participant,index)=>({...participant,_participantId:participantId(participant,index)})),teams=[...new Set(participants.map(participant=>n(participant.teamId)).filter(Boolean))];
  if(teams.length!==2)return null;
  const lineByTeam=new Map();
  for(const teamId of teams){
    const adc=participants.find(participant=>n(participant.teamId)===teamId&&roleOf(participant)==="ADC"),support=participants.find(participant=>n(participant.teamId)===teamId&&roleOf(participant)==="SUPPORT"),jungle=participants.find(participant=>n(participant.teamId)===teamId&&roleOf(participant)==="JUNGLE");
    if(!adc||!support||!jungle)return null;
    lineByTeam.set(teamId,{teamId,adc,support,jungle,ids:new Set([adc._participantId,support._participantId]),pureKills:0,jungleKills:0,botDeathsToJungle:0,players:new Map([[adc._participantId,{pureKills:0,pureDeaths:0,pureAssists:0,jungleDeaths:0}],[support._participantId,{pureKills:0,pureDeaths:0,pureAssists:0,jungleDeaths:0}]])});
  }
  const teamForId=id=>participants.find(participant=>participant._participantId===id)?.teamId||0,roleForId=id=>roleOf(participants.find(participant=>participant._participantId===id));
  for(const event of summary.earlyKills||[]){
    const killerTeam=n(teamForId(event.killerId)),victimTeam=n(teamForId(event.victimId)),attack=lineByTeam.get(killerTeam),defend=lineByTeam.get(victimTeam);if(!attack||!defend||!defend.ids.has(event.victimId))continue;
    const attackers=[event.killerId,...(event.assistingParticipantIds||[])].filter(id=>n(teamForId(id))===killerTeam),pure=attackers.length>0&&attackers.every(id=>["ADC","SUPPORT"].includes(roleForId(id))),jungler=attackers.some(id=>roleForId(id)==="JUNGLE");
    if(pure){attack.pureKills++;const killer=attack.players.get(event.killerId);if(killer)killer.pureKills++;for(const id of event.assistingParticipantIds||[]){const helper=attack.players.get(id);if(helper)helper.pureAssists++}const victim=defend.players.get(event.victimId);if(victim)victim.pureDeaths++}
    if(jungler){attack.jungleKills++;defend.botDeathsToJungle++;const victim=defend.players.get(event.victimId);if(victim)victim.jungleDeaths++}
  }
  const result={version:summary.version,confidence:summary.confidence,teams:{},players:{}};
  for(const teamId of teams){
    const own=lineByTeam.get(teamId),opponent=lineByTeam.get(teams.find(value=>value!==teamId)),diffAt=(minute,key)=>{
      const frame=summary.checkpoints?.[minute],sum=line=>[line.adc,line.support].reduce((total,participant)=>total+n(valueAt(frame,participant._participantId,key)),0);return frame?sum(own)-sum(opponent):0;
    };
    const gold10=diffAt(10,"gold"),gold15=diffAt(15,"gold"),cs10=diffAt(10,"cs"),cs15=diffAt(15,"cs"),xp10=diffAt(10,"xp"),xp15=diffAt(15,"xp"),pureKillDiff=own.pureKills-opponent.pureKills,pressureDiff=own.botDeathsToJungle-opponent.botDeathsToJungle,recovery=gold15-gold10;
    const duoSignal=clamp(.26*scaled(gold10,1200)+.18*scaled(gold15,1600)+.06*scaled(cs10,30)+.06*scaled(cs15,45)+.04*scaled(xp10,1500)+.04*scaled(xp15,2000)+.22*scaled(pureKillDiff,2)+.22*scaled(pressureDiff,2)+.22*scaled(recovery,1200),-1,1);
    result.teams[teamId]={teamId,gold10,gold15,cs10,cs15,xp10,xp15,pureKills:own.pureKills,jungleKills:own.jungleKills,botDeathsToJungle:own.botDeathsToJungle,pureKillDiff,pressureDiff,recovery,signal:Number(duoSignal.toFixed(4))};
    for(const [id,personal] of own.players){
      const participant=participants.find(value=>value._participantId===id),opposingRole=participants.find(value=>n(value.teamId)!==teamId&&roleOf(value)===roleOf(participant)),opposing=opposingRole?opponent.players.get(opposingRole._participantId):null;
      const personalEvent=(personal.pureKills+.35*personal.pureAssists-personal.pureDeaths)-((opposing?.pureKills||0)+.35*(opposing?.pureAssists||0)-(opposing?.pureDeaths||0)),personalSignal=clamp(.72*duoSignal+.28*scaled(personalEvent,2),-1,1),limit=roleOf(participant)==="ADC"?40:20;
      result.players[id]={participantId:id,teamId,role:roleOf(participant),signal:Number(personalSignal.toFixed(4)),change:Number(clamp(personalSignal*80,-limit,limit).toFixed(2)),...personal};
    }
  }
  return result;
}
