import test from "node:test";
import assert from "node:assert/strict";
import {buildSeriesCommentaryEvidence,findFinishedSeries,sanitizeSeriesCommentary,seriesCommentaryKey,validateSeriesCommentaryTransition} from "../series-commentary.js";

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
