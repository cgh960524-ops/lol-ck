import test from "node:test";
import assert from "node:assert/strict";
import {createMatchStore,createPostgresMatchRepository,mergeStoredMatch} from "../match-store.mjs";

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

test("match summaries keep only compact team totals and support paging",async()=>{
  const first={...baseMatch("1000000001"),gameCreation:100,participants:[{teamId:100,kills:4,gold:12000,win:true},{teamId:100,kills:3,gold:11000,win:true},{teamId:200,kills:2,gold:10000,win:false}]},second={...baseMatch("1000000002"),gameCreation:200,participants:[{teamId:100,kills:1,gold:9000,win:false},{teamId:200,kills:8,gold:15000,win:true}]};
  const store=createMatchStore({mode:"blob",loadBlob:async()=>[first,second],saveBlob:async()=>{}}),page=await store.summaries({limit:1});
  assert.equal(page.length,1);assert.equal(page[0].gameId,"1000000002");assert.deepEqual(page[0].team100,{kills:1,gold:9000,win:false});assert.deepEqual(page[0].team200,{kills:8,gold:15000,win:true});assert.equal(Object.hasOwn(page[0],"participants"),false);assert.equal(Object.hasOwn(page[0],"timeline"),false);
});

test("shadow mode keeps the successful Blob write when PostgreSQL fails",async()=>{
  let saved=[],logged=0;
  const postgresRepository={async upsert(){throw new Error("db unavailable")}},store=createMatchStore({mode:"shadow",loadBlob:async()=>saved,saveBlob:async value=>{saved=structuredClone(value)},postgresRepository,logger:{error(){logged++}}});
  const result=await store.upsert([baseMatch()]);assert.equal(result.total,1);assert.equal(saved.length,1);assert.equal(logged,1);
});

test("postgres mode bypasses Blob and delegates row-level operations",async()=>{
  let blobReads=0,blobWrites=0,upserts=0;
  const postgresRepository={async list(){return [baseMatch()]},async get(){return baseMatch()},async summaries(){return [{gameId:"1000000001"}]},async leaderboardStats(){return [{puuid:"player-1",games:1}]},async count(){return 1},async upsert(matches){upserts++;return {received:matches.length,total:1,replaced:[true],replacedCount:1}}},store=createMatchStore({mode:"postgres",loadBlob:async()=>{blobReads++;return []},saveBlob:async()=>{blobWrites++},postgresRepository});
  assert.equal((await store.list()).length,1);assert.equal((await store.get("1000000001")).gameId,"1000000001");assert.equal((await store.summaries()).length,1);assert.equal((await store.leaderboardStats())[0].games,1);assert.equal((await store.upsert([baseMatch()])).total,1);assert.equal(upserts,1);assert.equal(blobReads,0);assert.equal(blobWrites,0);
});

test("postgres repository passes JSONB values without pre-stringifying",async()=>{
  const jsonValues=[],queries=[],builders=[];
  const tx=(first,...values)=>{
    if(Array.isArray(first?.raw)){
      const text=first.join("?");queries.push({text,values});
      if(text.includes("SELECT m.game_id"))return [];
      if(text.includes("SELECT count(*)"))return [{count:1}];
      return [];
    }
    builders.push({first,values});return {first,values};
  };
  tx.json=value=>{jsonValues.push(value);return {type:"jsonb",value}};
  const sql=Object.assign(tx,{begin:async callback=>callback(tx)}),match=baseMatch();
  await createPostgresMatchRepository(sql).upsert([match]);
  const matchRows=builders.find(builder=>builder.values.includes("payload")).first;
  assert.equal(typeof matchRows[0].payload,"object");assert.deepEqual(matchRows[0].epic_objectives,[]);
  const participantRows=builders.find(builder=>builder.values.includes("data")).first;
  assert.deepEqual(participantRows[0].data,match.participants[0]);
  assert.deepEqual(jsonValues,[match.timeline.frames,match.timeline.events,match.timeline]);
  const timelineQuery=queries.find(query=>query.text.includes("INSERT INTO match_timelines"));
  assert.ok(timelineQuery);assert.deepEqual(timelineQuery.values.slice(2,5).map(parameter=>parameter.type),["jsonb","jsonb","jsonb"]);
});

test("postgres summaries aggregate scalar columns without loading JSON payloads",async()=>{
  let queryText="";
  const sql=(first,...values)=>{queryText=Array.isArray(first?.raw)?first.join("?"):"";return [{game_id:"1000000003",game_creation:300,duration:1800,timeline_collected:true,uploaded_at:400,team_100_kills:12,team_100_gold:32000,team_100_win:true,team_200_kills:7,team_200_gold:28000,team_200_win:false}]};
  const rows=await createPostgresMatchRepository(sql).summaries({limit:20,offset:0});
  assert.match(queryText,/sum\(mp\.kills\)/);assert.doesNotMatch(queryText,/m\.payload/);assert.doesNotMatch(queryText,/mp\.data/);
  assert.deepEqual(rows,[{gameId:"1000000003",gameCreation:300,duration:1800,timelineCollected:true,uploadedAt:400,team100:{kills:12,gold:32000,win:true},team200:{kills:7,gold:28000,win:false}}]);
});

test("blob leaderboard stats aggregate only the values needed by ranking cards",async()=>{
  const matches=[{...baseMatch("1000000004"),duration:1200,participants:[{puuid:"player-1",gameName:"A",tagLine:"KR1",win:true,kills:4,deaths:2,assists:8,damage:18000,gold:11000,objectiveDamage:3000,damageTaken:9000,mitigated:2000,ccTime:12,wardsPlaced:9,unitsHealed:2,healing:700,healsOnTeammates:300,shieldsOnTeammates:200}]},{...baseMatch("1000000005"),duration:1500,participants:[{puuid:"player-1",gameName:"A",tagLine:"KR1",win:false,kills:2,deaths:5,assists:3,damage:12000,gold:9000}]}];
  const store=createMatchStore({mode:"blob",loadBlob:async()=>matches,saveBlob:async()=>{}}),rows=await store.leaderboardStats(),row=rows[0];
  assert.equal(rows.length,1);assert.equal(row.games,2);assert.equal(row.wins,1);assert.equal(row.kills,6);assert.equal(row.deaths,7);assert.equal(row.metricGames,1);assert.equal(row.metricDeaths,2);assert.equal(row.utilityHealing,700);assert.equal(Object.hasOwn(row,"participants"),false);
});

test("postgres leaderboard stats use scalar aggregates without loading participant JSON",async()=>{
  let queryText="";
  const sql=(first,...values)=>{queryText=Array.isArray(first?.raw)?first.join("?"):"";return [{puuid:"player-1",gameName:"A",tagLine:"KR1",games:2,wins:1,kills:6,deaths:7,assists:11,damage:30000,duration:2700,metricGames:1,metricDuration:1200,metricDeaths:2,utilityHealing:700}]};
  const [row]=await createPostgresMatchRepository(sql).leaderboardStats();
  assert.match(queryText,/sum\(mp\.deaths\) FILTER/);assert.match(queryText,/sum\(mp\.healing\) FILTER/);assert.doesNotMatch(queryText,/m\.payload/);assert.doesNotMatch(queryText,/mp\.data/);assert.equal(row.metricDeaths,2);assert.equal(row.utilityHealing,700);
});
