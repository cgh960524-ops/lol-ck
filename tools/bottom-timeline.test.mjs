import test from "node:test";
import assert from "node:assert/strict";
import {buildBottomTimelineSummary,evaluateBottomTimeline} from "../bottom-timeline.js";

const roles=["TOP","JUNGLE","MID","ADC","SUPPORT"];
const participants=Array.from({length:10},(_,index)=>({participantId:index+1,teamId:index<5?100:200,role:roles[index%5]}));
const frame=(minute,blueBottomGold,redBottomGold)=>({timestamp:minute*60000,participantFrames:Array.from({length:10},(_,index)=>({participantId:index+1,totalGold:[4,5].includes(index+1)?blueBottomGold/2:[9,10].includes(index+1)?redBottomGold/2:3000,minionsKilled:50,xp:3000,level:6}))});
const kill=(minute,killerId,victimId,assistingParticipantIds)=>({type:"CHAMPION_KILL",timestamp:minute*60000,killerId,victimId,assistingParticipantIds,position:{x:12000,y:2000}});

test("bottom timeline summary keeps only lane checkpoints and early bottom kills",()=>{
  const timeline={frames:[frame(10,8000,7000),frame(15,11000,10500)],events:[kill(5,4,9,[5]),kill(16,4,9,[5])]};
  const summary=buildBottomTimelineSummary(timeline);
  assert.equal(summary.checkpoints[10].players.length,10);
  assert.equal(summary.earlyKills.length,1);
  assert.ok(JSON.stringify(summary).length<JSON.stringify(timeline).length);
});

test("pure 2v2 lead is positive and mirrored for the opposing bottom lane",()=>{
  const timeline={frames:[frame(10,8000,7000),frame(15,11000,10500)],events:[kill(5,4,9,[5]),kill(8,4,10,[5])]};
  const result=evaluateBottomTimeline({participants,timeline});
  assert.ok(result.teams[100].signal>0);
  assert.equal(result.teams[100].signal,-result.teams[200].signal);
  assert.ok(result.players[4].change>0);
  assert.ok(result.players[9].change<0);
});
