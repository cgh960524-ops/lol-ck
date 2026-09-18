import test from "node:test";
import assert from "node:assert/strict";
import {buildSeriesCommentaryEvidence,compactSeriesCommentaryEvidence,findFinishedSeries,sanitizeSeriesCommentary,seriesCommentaryKey,validateSeriesCommentaryTransition} from "../series-commentary.js";

function timelineEvidenceFixture({legacyParticipantIds=false}={}){
  const roles=["TOP","JUNGLE","MID","ADC","SUPPORT"],names=["Malphite","Qiyana","Yasuo","Samira","Pantheon","Kayle","Elise","Galio","Aphelios","Thresh"],players=Array.from({length:10},(_,index)=>({id:index+1,name:names[index],ratingHistory:[]})),member=(id,side)=>({id,name:names[id-1],role:roles[(id-1)%5],power:1500,side}),series={id:99,seriesNumber:"CKS-TIMELINE",finished:true,finishedAt:1,finalWinner:"RED",blueCaptainId:1,redCaptainId:6,pogId:9,pogScore:88,blue:Array.from({length:5},(_,index)=>member(index+1,"BLUE")),red:Array.from({length:5},(_,index)=>member(index+6,"RED")),sets:[{number:1,gameId:"8384824997",winner:"RED",imported:true}]};
  const participant=id=>({...(legacyParticipantIds?{}:{participantId:id}),playerId:id,teamId:id<=5?100:200,role:"UNTRUSTED_LANE",win:id>5,championName:names[id-1],kills:0,deaths:0,assists:0,damage:1000,gold:10000,cs:100,vision:10}),orderedIds=legacyParticipantIds?[1,2,3,4,5,6,7,8,9,10]:[6,1,7,2,8,3,9,4,10,5],participants=orderedIds.map(participant);
  const frame=(minute,blueGold,redGold)=>{const participantFrames={};for(const [side,start,total] of [["BLUE",1,blueGold],["RED",6,redGold]]){const base=Math.floor(total/5),remainder=total-base*5;for(let offset=0;offset<5;offset++){const id=start+offset;participantFrames[id]={participantId:id,totalGold:base+(offset===0?remainder:0),currentGold:0,xp:0,level:1,minionsKilled:0,jungleMinionsKilled:0,position:{x:id*100,y:id*100},teamScore:0,side}}}return {timestamp:minute*60000,participantFrames}};
  const kill=(timestamp,killerId,victimId,assistingParticipantIds,x,y)=>({type:"CHAMPION_KILL",timestamp,killerId,victimId,assistingParticipantIds,position:{x,y}}),building=(timestamp,killerId,teamId,towerType)=>({type:"BUILDING_KILL",timestamp,killerId,teamId,buildingType:"TOWER_BUILDING",laneType:"MID_LANE",towerType,assistingParticipantIds:[],position:{x:7000,y:7000}}),objective=(timestamp,killerId,monsterType,monsterSubType,assistingParticipantIds)=>({type:"ELITE_MONSTER_KILL",timestamp,killerId,monsterType,monsterSubType,assistingParticipantIds,position:{x:5000,y:10000}});
  const events=[
    kill(16*60000+52000,7,2,[8,9,10,1],13548,2584),kill(16*60000+57000,9,3,[6,7,8,10],13136,3624),kill(16*60000+59000,6,5,[8,9,10],12955,1818),building(17*60000+10000,9,100,"OUTER_TURRET"),
    building(20*60000+51000,9,100,"OUTER_TURRET"),kill(20*60000+52218,9,3,[7,8,10],7426,7518),kill(20*60000+52251,4,7,[2,3,5],7138,7538),kill(20*60000+56262,9,5,[7,8,10],6758,6820),kill(20*60000+58767,9,4,[8,10],6989,7155),kill(21*60000+2686,6,2,[],5902,9169),kill(21*60000+34875,9,1,[6,8,10],4883,10161),objective(21*60000+41467,8,"BARON_NASHOR","",[1,6,9,10]),kill(21*60000+48661,9,5,[6,8,10],4608,9912),objective(22*60000+28987,7,"DRAGON","FIRE_DRAGON",[8,9]),
  ];
  const frames=[frame(0,2500,2500),frame(16,33075,28516),frame(17,34947,33593),frame(18,37029,36017),frame(19,39496,37731),frame(20,42166,39567),frame(21,44258,42840),frame(22,45208,46368)];frames[3].participantFrames=Object.values(frames[3].participantFrames);frames[6].events=[structuredClone(events[5])];
  const match={gameId:"8384824997",duration:23*60,participants,timeline:{frames,events}};
  return {players,series,matches:[match],build:()=>buildSeriesCommentaryEvidence({series,players,matches:[match],prepareMatches:(_players,value)=>value,playerResolver:value=>mp=>value.find(player=>player.id===mp.playerId)})};
}

test("series commentary keys and completed lookup stay scoped",()=>{
  assert.equal(seriesCommentaryKey("../../CKS-20260918-001"),"______CKS-20260918-001");
  const series={id:10,seriesNumber:"CKS-20260918-001",finished:true};
  assert.equal(findFinishedSeries({seriesState:{active:series,history:[]}},"CKS-20260918-001"),series);
  assert.equal(findFinishedSeries({seriesState:{active:{id:11,finished:false},history:[series]}},"10"),series);
  assert.equal(findFinishedSeries({seriesState:{active:null,history:[]}},"10"),null);
});

test("series evidence preserves matchup, bottom duo and fixed rating changes",()=>{
  const players=[
    {id:1,name:"Blue ADC",ratingHistory:[{seriesId:"CKS-1",gameId:"100",time:1,role:"ADC",win:true,before:1500,after:1504,change:4,roleBefore:1510,roleAfter:1517,roleChange:7,opponentId:3,opponentPower:1650,expected:.4,actualMatchup:.55,residual:.15,quality:.8,duoContextApplied:true,duoChange:2}]},
    {id:2,name:"Blue SUP",ratingHistory:[{seriesId:"CKS-1",gameId:"100",time:1,role:"SUPPORT",win:true,roleBefore:1777,roleAfter:1779,roleChange:2}]},{id:3,name:"Red ADC",ratingHistory:[]},{id:4,name:"Red SUP",ratingHistory:[]},
  ];
  const series={id:1,seriesNumber:"CKS-1",finished:true,finishedAt:1,finalWinner:"BLUE",blueCaptainId:1,redCaptainId:3,pogId:1,pogScore:77,blue:[{id:1,name:"Blue ADC",role:"ADC",power:1510},{id:2,name:"Blue SUP",role:"TOP",power:1490}],red:[{id:3,name:"Red ADC",role:"ADC",power:1650},{id:4,name:"Red SUP",role:"SUPPORT",power:1550}],sets:[{number:1,gameId:"100",winner:"BLUE",imported:true,roleOverrides:{2:"SUPPORT"}}],ratingSnapshot:{version:"4.1",players:[{id:1,role:"ADC",power:1510,overall:1500},{id:2,role:"TOP",power:1490,overall:1480},{id:3,role:"ADC",power:1650,overall:1640},{id:4,role:"SUPPORT",power:1550,overall:1540}]},powerAfter:{1:1504,2:1481,3:1637,4:1538}};
  const participant=(playerId,teamId,role,win,kills,deaths,assists,damage,gold,cs,vision)=>({playerId,teamId,role,win,championName:`Champion${playerId}`,kills,deaths,assists,damage,gold,cs,vision});
  const matches=[{gameId:"100",duration:1800,participants:[participant(1,100,"ADC",true,8,2,7,22000,13000,220,12),participant(2,100,"SUPPORT",true,1,3,18,6000,8000,30,65),participant(3,200,"ADC",false,5,5,4,18000,12000,205,9),participant(4,200,"SUPPORT",false,0,6,9,5000,7200,25,52)]}];
  const evidence=buildSeriesCommentaryEvidence({series,players,matches,ratingVersion:"4.1",prepareMatches:(_players,value)=>value,playerResolver:value=>mp=>value.find(player=>player.id===mp.playerId)});
  assert.deepEqual(evidence.series.score,{BLUE:1,RED:0});
  assert.equal(evidence.sets[0].matchups.find(row=>row.role==="ADC").blue.name,"Blue ADC");
  assert.equal(evidence.sets[0].bottomDuo.BLUE.combinedStartPower,3287);
  assert.equal(evidence.ratingChanges.find(row=>row.id==="1").overallChange,4);
  assert.equal(evidence.ratingChanges.find(row=>row.id==="1").events[0].opponent,"Red ADC");
  assert.equal(evidence.sets[0].players.find(row=>row.id==="2").startPower,1777);
  assert.equal(evidence.policy.explanationOnly,true);
  assert.equal(evidence.sets[0].timeline.available,false);
});

test("timeline evidence finds deterministic gold swings, fights and conversions",()=>{
  const evidence=timelineEvidenceFixture().build(),set=evidence.sets[0],timeline=set.timeline;
  assert.deepEqual(evidence.timelineCoverage,{setsTotal:1,setsAvailable:1,setsWithCompleteGold:1,totalFrames:8,totalCompleteGoldFrames:8,totalEvents:14,confidenceBySet:[{setNumber:1,overall:"high",gold:"high",events:"high"}]});
  assert.equal(set.mappingComplete,true);
  assert.equal(set.players.find(player=>player.id==="1").role,"TOP","series roster roles take priority over untrusted match lane labels");
  assert.equal(timeline.available,true);
  assert.deepEqual(timeline.coverage,{frameCount:8,goldFrameCount:8,completeGoldFrameCount:8,eventCount:14,killEventCount:10,objectiveEventCount:2,buildingEventCount:2,firstMinute:0,lastMinute:22,matchDurationMinutes:23,coveredDurationRatio:.957,mappedParticipants:10,expectedParticipants:10,participantIdFallbacks:0,filteredCrossTeamAssists:2,droppedUnknownAssists:0});
  assert.deepEqual(timeline.maxLeads,{BLUE:{gold:4559,minute:16},RED:{gold:1160,minute:22}});
  assert.deepEqual(timeline.biggestSwings.find(row=>row.windowMinutes===1),{windowMinutes:1,fromMinute:16,toMinute:17,fromDifference:4559,toDifference:1354,change:-3205,amount:3205,towardSide:"RED"});
  assert.deepEqual(timeline.biggestSwings.find(row=>row.windowMinutes===2),{windowMinutes:2,fromMinute:20,toMinute:22,fromDifference:2599,toDifference:-1160,change:-3759,amount:3759,towardSide:"RED"});
  assert.ok(timeline.leadChanges.some(row=>row.fromSide==="BLUE"&&row.toSide==="RED"&&row.toMinute===22));

  const firstCrack=timeline.killClusters.find(fight=>fight.startMinute===16.87),decisive=timeline.killClusters.find(fight=>fight.startMinute===20.87);
  assert.deepEqual(firstCrack.kills,{BLUE:0,RED:3});
  assert.equal(firstCrack.firstDeath.name,"Qiyana");
  assert.ok(firstCrack.conversions.some(event=>event.kind==="building"&&event.side==="RED"));
  assert.deepEqual(decisive.kills,{BLUE:1,RED:6});
  assert.equal(decisive.gold.change,-3759);
  assert.equal(decisive.gold.leadChanged,true);
  assert.equal(decisive.players.find(player=>player.name==="Aphelios").kills,5);
  assert.equal(decisive.players.find(player=>player.name==="Pantheon").deaths,2);
  assert.ok(decisive.conversions.some(event=>event.label==="BARON_NASHOR"));
  assert.ok(timeline.turningPoints.some(point=>point.fightId===decisive.fightId&&point.gold.leadChanged));

  const baron=timeline.objectives.find(event=>event.type==="BARON_NASHOR");
  assert.deepEqual(baron.assists.map(player=>player.name),["Kayle","Aphelios","Thresh"],"cross-team assist IDs are removed");
  assert.ok(timeline.limitations.some(text=>text.includes("다른 어시스트 2건")));
  assert.deepEqual(timelineEvidenceFixture().build().sets[0].timeline,timeline,"timeline evidence is deterministic");
  const promptTimeline=compactSeriesCommentaryEvidence(evidence).sets[0].timeline;
  assert.equal(promptTimeline.killClusters,undefined,"the model receives turning points instead of every fight sequence");
  assert.equal(promptTimeline.turningPoints.length,timeline.turningPoints.length);
  assert.ok(promptTimeline.teamGoldCheckpoints.length<timeline.teamGold.length);
});

test("timeline participant mapping falls back to participant array order only for legacy matches",()=>{
  const timeline=timelineEvidenceFixture({legacyParticipantIds:true}).build().sets[0].timeline;
  assert.equal(timeline.coverage.participantIdFallbacks,10);
  assert.equal(timeline.coverage.completeGoldFrameCount,8);
  assert.equal(timeline.killClusters.find(fight=>fight.startMinute===16.87).firstDeath.name,"Qiyana");
  assert.ok(timeline.limitations.some(text=>text.includes("배열 순서+1")));
});

test("timeline gold analysis excludes incomplete team frames without losing event evidence",()=>{
  const fixture=timelineEvidenceFixture();for(const frame of fixture.matches[0].timeline.frames){if(Array.isArray(frame.participantFrames))frame.participantFrames=frame.participantFrames.filter(item=>item.participantId!==10);else delete frame.participantFrames[10]}
  const timeline=fixture.build().sets[0].timeline;
  assert.equal(timeline.coverage.goldFrameCount,8);
  assert.equal(timeline.coverage.completeGoldFrameCount,0);
  assert.deepEqual(timeline.teamGold,[]);
  assert.equal(timeline.confidence.gold,"unavailable");
  assert.equal(timeline.confidence.events,"high");
  assert.equal(timeline.coverage.killEventCount,10);
});

test("series commentary output is bounded and rejects an empty response",()=>{
  assert.equal(sanitizeSeriesCommentary({}),null);
  const review=sanitizeSeriesCommentary({headline:" A ",overview:" B ",decisiveFactors:[" C "],setReviews:[{setNumber:1,title:"S",summary:"sum"}],matchupReviews:[{role:"정글",title:"M",summary:"match"}],notablePlayers:[{name:"P",side:"RED",summary:"good"}],ratingSummary:"R",dataNotice:"N"});
  assert.equal(review.headline,"A");
  assert.equal(review.matchupReviews[0].role,"정글");
  assert.equal(review.notablePlayers[0].side,"RED");
});

test("automatic commentary accepts only a verified finish transition",()=>{
  const roleList=["TOP","JUNGLE","MID","ADC","SUPPORT"],players=Array.from({length:10},(_,index)=>({id:index+1,name:`P${index+1}`}));
  const team=(start,side)=>roleList.map((role,index)=>({id:start+index,name:`P${start+index}`,role,power:1500+index,side}));
  const before={id:1234567890,seriesNumber:"CKS-20260918-999",createdAt:1234567890,blue:team(1,"BLUE"),red:team(6,"RED"),blueCaptainId:1,redCaptainId:6,sets:[{number:1,gameId:"900000001",winner:"BLUE",imported:true},{number:2,gameId:"900000002",winner:"BLUE",imported:true}],finished:false};
  const after={...structuredClone(before),finished:true,finishedAt:1234567999,finalWinner:"BLUE",pogId:1,pogScore:80};
  const participant=(playerId,teamId,win)=>({playerId,teamId,win}),matches=["900000001","900000002"].map(gameId=>({gameId,participants:[...Array.from({length:5},(_,index)=>participant(index+1,100,true)),...Array.from({length:5},(_,index)=>participant(index+6,200,false))]}));
  const previousState={players,seriesState:{active:before,history:[]}},nextSeriesState={active:after,history:[structuredClone(after)]},resolveParticipant=value=>players.find(player=>player.id===value.playerId);
  const valid=validateSeriesCommentaryTransition({previousState,nextSeriesState,matches,resolveParticipant});assert.equal(valid.ok,true);assert.match(valid.fingerprintInput,/900000002/);assert.doesNotMatch(valid.fingerprintInput,/CKS-20260918-999|1234567890/);
  const beforeOne={...structuredClone(before),sets:structuredClone(before.sets.slice(0,1))},afterOne={...structuredClone(beforeOne),finished:true,finishedAt:1234567999,finalWinner:"BLUE",pogId:1,pogScore:80};
  assert.equal(validateSeriesCommentaryTransition({previousState:{players,seriesState:{active:beforeOne,history:[]}},nextSeriesState:{active:afterOne,history:[structuredClone(afterOne)]},matches,resolveParticipant}).ok,true);
  const changed=structuredClone(after);changed.sets[1].winner="RED";changed.finalWinner="BLUE";
  assert.equal(validateSeriesCommentaryTransition({previousState,nextSeriesState:{active:changed,history:[structuredClone(changed)]},matches,resolveParticipant}).code,"sets_changed_on_finish");
  assert.equal(validateSeriesCommentaryTransition({previousState,nextSeriesState,matches,resolveParticipant:value=>value.playerId===10?null:resolveParticipant(value)}).code,"incomplete_player_mapping");
});
