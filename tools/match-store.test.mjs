import test from "node:test";
import assert from "node:assert/strict";
import {createMatchStore,mergeStoredMatch} from "../match-store.mjs";

const baseMatch=(gameId="1000000001")=>({gameId,gameCreation:1,duration:1200,participants:[{participantId:1,gameName:"A",teamId:100}],timelineCollected:true,timelineSource:"LCU",timeline:{frameInterval:60000,frames:[{timestamp:0,participantFrames:[]}],events:[]}});

test("blob match store preserves an existing timeline when an upload omits it",async()=>{
  let saved=[baseMatch()];
  const store=createMatchStore({mode:"blob",loadBlob:async()=>structuredClone(saved),saveBlob:async value=>{saved=structuredClone(value)}});
  const incoming={...baseMatch()};delete incoming.timeline;incoming.timelineCollected=false;incoming.timelineSource="RETRY";
  const result=await store.upsert([incoming]);
  assert.deepEqual(result.replaced,[true]);assert.equal(result.total,1);
  const match=await store.get("1000000001");
  assert.equal(match.timeline.frames.length,1);assert.equal(match.timelineCollected,true);assert.equal(match.timelineSource,"LCU");
  const compact=await store.list({includeTimeline:false});assert.equal(Object.hasOwn(compact[0],"timeline"),false);assert.equal(compact[0].timelineCollected,true);
});

test("blob match store replaces an explicitly supplied timeline and handles duplicate ids",async()=>{
  let saved=[];
  const store=createMatchStore({mode:"blob",loadBlob:async()=>structuredClone(saved),saveBlob:async value=>{saved=structuredClone(value)}}),first=baseMatch(),second={...baseMatch(),duration:1300,timeline:{frameInterval:30000,frames:[{timestamp:0,participantFrames:[]}],events:[]}};
  const result=await store.upsert([first,second]);assert.equal(result.total,1);assert.equal(saved[0].duration,1300);assert.equal(saved[0].timeline.frameInterval,30000);
  assert.equal(mergeStoredMatch(first,{...second,timeline:null}).timeline,null);
});

test("shadow mode keeps the successful Blob write when PostgreSQL fails",async()=>{
  let saved=[],logged=0;
  const postgresRepository={async upsert(){throw new Error("db unavailable")}},store=createMatchStore({mode:"shadow",loadBlob:async()=>saved,saveBlob:async value=>{saved=structuredClone(value)},postgresRepository,logger:{error(){logged++}}});
  const result=await store.upsert([baseMatch()]);assert.equal(result.total,1);assert.equal(saved.length,1);assert.equal(logged,1);
});

test("postgres mode bypasses Blob and delegates row-level operations",async()=>{
  let blobReads=0,blobWrites=0,upserts=0;
  const postgresRepository={async list(){return [baseMatch()]},async get(){return baseMatch()},async count(){return 1},async upsert(matches){upserts++;return {received:matches.length,total:1,replaced:[true],replacedCount:1}}},store=createMatchStore({mode:"postgres",loadBlob:async()=>{blobReads++;return []},saveBlob:async()=>{blobWrites++},postgresRepository});
  assert.equal((await store.list()).length,1);assert.equal((await store.get("1000000001")).gameId,"1000000001");assert.equal((await store.upsert([baseMatch()])).total,1);assert.equal(upserts,1);assert.equal(blobReads,0);assert.equal(blobWrites,0);
});
