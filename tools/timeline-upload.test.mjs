import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Readable} from "node:stream";

function request(handler,url,{method="GET",body,headers={}}={}){
  return new Promise((resolve,reject)=>{
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.url=url;req.method=method;req.headers={host:"localhost",...headers};
    const chunks=[];const res={writeHead(status,responseHeaders){res.status=status;res.headers=responseHeaders},end(chunk){if(chunk)chunks.push(Buffer.from(chunk));const text=Buffer.concat(chunks).toString("utf8");resolve({status:res.status,body:text?JSON.parse(text):null})}};
    Promise.resolve(handler(req,res)).catch(reject);
  });
}

const participants=Array.from({length:10},(_,index)=>({participantId:index+1,puuid:`puuid-${index+1}`,gameName:`Player ${index+1}`,tagLine:"KR1",teamId:index<5?100:200,win:index>=5,role:["TOP","JUNGLE","MID","ADC","SUPPORT"][index%5],championId:index+1,championName:`Champion ${index+1}`}));
const match=gameId=>({gameId,gameCreation:1_750_000_000_000,duration:1800,gameMode:"CUSTOM",gameType:"CUSTOM_GAME",queueId:0,participants});
const frame=(timestamp,totalGold=500)=>({timestamp,participantFrames:Array.from({length:10},(_,index)=>({participantId:index+1,currentGold:100,totalGold:totalGold+index,xp:200,level:2,minionsKilled:3,jungleMinionsKilled:1,position:{x:1000+index,y:2000+index},teamScore:0}))});

test("uploader timeline is bounded, persisted, preserved when omitted, and replaced by a later timeline",async()=>{
  const tempRoot=await mkdtemp(join(tmpdir(),"eungck-timeline-upload-")),dataFile=join(tempRoot,"matches.json");
  process.env.VERCEL="1";process.env.DATA_FILE=dataFile;process.env.APP_STATE_FILE=join(tempRoot,"app-state.json");process.env.RUNTIME_CONFIG_FILE=join(tempRoot,"runtime.json");process.env.UPLOADER_TOKEN="test-upload-token";delete process.env.BLOB_READ_WRITE_TOKEN;
  try{
    const {handleRequest}=await import(`../server.mjs?timeline-upload-test=${Date.now()}`),headers={authorization:"Bearer test-upload-token"},gameId="1234567890",largeTimeline={frames:Array.from({length:181},(_,index)=>frame((180-index)*60_000,1000+index)),events:[...Array.from({length:2_001},(_,index)=>({timestamp:(2_001-index)*1000,type:"CHAMPION_KILL",killerId:6,victimId:1,assistingParticipantIds:[7,7,12],killerTeamId:200,monsterType:"none!",monsterSubType:"",buildingType:"",towerType:"",laneType:"mid_lane",position:{x:999_999,y:-999_999}})),{timestamp:1,type:"ITEM_PURCHASED"}]};
    const created=await request(handleRequest,"/api/internal-matches/upload",{method:"POST",headers,body:{...match(gameId),timelineSource:" LCU\n",timeline:largeTimeline}});assert.equal(created.status,201);
    let saved=JSON.parse(await readFile(dataFile,"utf8"))[0];assert.equal(saved.participants[0].participantId,1);assert.equal(saved.participants[9].participantId,10);assert.equal(saved.timelineCollected,true);assert.equal(saved.timelineSource,"LCU");assert.equal(saved.timeline.frameInterval,60_000);assert.equal(saved.timeline.frames.length,180);assert.equal(saved.timeline.frames[0].timestamp,60_000);assert.equal(saved.timeline.events.length,2_000);assert.equal(saved.timeline.events[0].teamId,200);assert.equal(saved.timeline.events[0].assistingParticipantIds.length,1);assert.deepEqual(saved.timeline.events[0].position,{x:100_000,y:-100_000});assert.equal(saved.timeline.events[0].laneType,"MID_LANE");

    const failedGameId="1234567891",arrayUpdate=await request(handleRequest,"/api/internal-matches/upload",{method:"POST",headers,body:{matches:[{...match(gameId),timeline:null,timelineCollected:false,timelineSource:"RETRY",timelineError:"timeout\n retry"},{...match(failedGameId),timeline:null,timelineCollected:false,timelineSource:"LCU",timelineError:"not found"}]}});assert.equal(arrayUpdate.status,200);
    const afterArray=JSON.parse(await readFile(dataFile,"utf8"));saved=afterArray.find(item=>item.gameId===gameId);const failed=afterArray.find(item=>item.gameId===failedGameId);assert.equal(saved.timeline.frames.length,180);assert.equal(saved.timelineCollected,true);assert.equal(saved.timelineSource,"LCU");assert.equal(saved.timelineError,"timeout retry");assert.equal(failed.timelineCollected,false);assert.equal(failed.timelineError,"not found");assert.equal(Object.prototype.hasOwnProperty.call(failed,"timeline"),false);

    const replacement={frameInterval:999_999,frames:[frame(0,700)],events:[]},bulkUpdate=await request(handleRequest,"/api/internal-matches/upload-bulk",{method:"POST",headers,body:{matches:[{...match(gameId),timelineSource:"LCU2",timeline:replacement}]}});assert.equal(bulkUpdate.status,200);
    saved=JSON.parse(await readFile(dataFile,"utf8")).find(item=>item.gameId===gameId);assert.equal(saved.timeline.frameInterval,300_000);assert.equal(saved.timeline.frames.length,1);assert.equal(saved.timeline.frames[0].participantFrames[0].totalGold,700);assert.deepEqual(saved.timeline.events,[]);

    const previousConsoleError=console.error;let rejected;try{console.error=()=>{};rejected=await request(handleRequest,"/api/internal-matches/upload",{method:"POST",headers,body:{...match(gameId),timeline:{frameInterval:60_000,frames:[],events:[]}}})}finally{console.error=previousConsoleError}assert.equal(rejected.status,400);assert.match(rejected.body.error,/프레임/);
    saved=JSON.parse(await readFile(dataFile,"utf8")).find(item=>item.gameId===gameId);assert.equal(saved.timeline.frames[0].participantFrames[0].totalGold,700);
  }finally{await rm(tempRoot,{recursive:true,force:true})}
});
