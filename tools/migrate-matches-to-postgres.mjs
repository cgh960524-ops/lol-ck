import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {closeDatabase,getDatabase} from "../db.mjs";
import {createPostgresMatchRepository} from "../match-store.mjs";
import {loadJson,stateFiles} from "../storage.mjs";

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const args=process.argv.slice(2),sourceArg=args.find(value=>value.startsWith("--source="))?.slice(9)||process.env.MATCH_MIGRATION_SOURCE_URL||"";

function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(!value||typeof value!=="object")return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])]));
}

const stableSort=(values,key)=>[...(Array.isArray(values)?values:[])].sort((left,right)=>key(left).localeCompare(key(right),"en"));
function semanticMatch(match){
  const copy=structuredClone(match),roleOrder={TOP:1,JUNGLE:2,MID:3,ADC:4,SUPPORT:5};
  // This timestamp describes ingestion, not the game, and may legitimately
  // differ when an old export has been imported more than once.
  delete copy.uploadedAt;
  copy.participants=stableSort(copy.participants,participant=>`${String(Number(participant?.participantId)||99).padStart(2,"0")}|${String(Number(participant?.teamId)||0)}|${String(roleOrder[participant?.role]||9)}|${participant?.puuid||participant?.gameName||""}`);
  copy.epicObjectives=stableSort(copy.epicObjectives,event=>`${String(Number(event?.timestamp)||0).padStart(12,"0")}|${event?.monsterType||""}|${event?.monsterSubType||""}|${event?.teamId||0}|${event?.killerPuuid||""}`).map(event=>({...event,assistingPuuids:stableSort(event?.assistingPuuids,value=>String(value))}));
  if(copy.timeline&&typeof copy.timeline==="object"){
    copy.timeline.frames=stableSort(copy.timeline.frames,frame=>String(Number(frame?.timestamp)||0).padStart(12,"0")).map(frame=>({...frame,participantFrames:stableSort(frame?.participantFrames,item=>String(Number(item?.participantId)||99).padStart(2,"0"))}));
    copy.timeline.events=stableSort(copy.timeline.events,event=>`${String(Number(event?.timestamp)||0).padStart(12,"0")}|${event?.type||""}|${event?.killerId||0}|${event?.victimId||0}|${event?.teamId||0}|${event?.monsterType||""}|${event?.buildingType||""}`).map(event=>({...event,assistingParticipantIds:stableSort(event?.assistingParticipantIds,value=>String(Number(value)||0).padStart(2,"0"))}));
  }
  return canonical(copy);
}

const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function digestMap(matches){return new Map(matches.map(match=>[String(match.gameId),hash(semanticMatch(match))]))}

async function readStoredStructure(sql){
  const [row]=await sql`
    SELECT
      (SELECT count(*)::integer FROM matches) AS match_count,
      (SELECT count(*)::integer FROM match_participants) AS participant_count,
      (SELECT count(*)::integer FROM match_timelines) AS timeline_count,
      (SELECT count(*)::integer FROM matches WHERE jsonb_typeof(payload) IS DISTINCT FROM 'object') AS invalid_match_payload_count,
      (SELECT count(*)::integer FROM matches WHERE jsonb_typeof(epic_objectives) IS DISTINCT FROM 'array') AS invalid_epic_objectives_count,
      (SELECT count(*)::integer FROM match_participants WHERE jsonb_typeof(data) IS DISTINCT FROM 'object') AS invalid_participant_data_count,
      (SELECT count(*)::integer FROM match_timelines WHERE jsonb_typeof(timeline) IS DISTINCT FROM 'object') AS invalid_timeline_count,
      (SELECT count(*)::integer FROM match_timelines WHERE jsonb_typeof(frames) IS DISTINCT FROM 'array') AS invalid_timeline_frames_count,
      (SELECT count(*)::integer FROM match_timelines WHERE jsonb_typeof(events) IS DISTINCT FROM 'array') AS invalid_timeline_events_count
  `;
  return Object.fromEntries(Object.entries(row||{}).map(([key,value])=>[key,Number(value)||0]));
}

async function loadSource(){
  if(sourceArg){
    const sourceUrl=new URL(sourceArg);sourceUrl.searchParams.set("timeline","1");const response=await fetch(sourceUrl,{headers:{accept:"application/json"},signal:AbortSignal.timeout(60_000)});
    if(!response.ok)throw new Error(`원본 경기 API를 읽지 못했습니다. (HTTP ${response.status})`);
    const value=await response.json();if(!Array.isArray(value))throw new Error("원본 경기 API 응답이 배열이 아닙니다.");return value;
  }
  const {matches:file}=stateFiles(root),value=await loadJson("internal-matches",file,[]);
  if(!Array.isArray(value))throw new Error("기존 경기 저장소 데이터가 배열이 아닙니다.");return value;
}

async function main(){
  if(!String(process.env.DATABASE_URL||"").trim())throw new Error("DATABASE_URL이 없습니다. Neon/Vercel에서 발급한 PostgreSQL 연결 문자열을 환경 변수로 설정해 주세요.");
  const source=await loadSource(),sourceIds=source.map(match=>String(match?.gameId||""));
  if(sourceIds.some(id=>!id))throw new Error("원본 데이터에 gameId가 없는 경기가 있습니다.");
  if(new Set(sourceIds).size!==sourceIds.length)throw new Error("원본 데이터에 중복 gameId가 있습니다. 먼저 중복을 정리해 주세요.");

  const sql=getDatabase(),migration=await readFile(join(root,"migrations","001_match_store.sql"),"utf8");
  await sql.unsafe(migration);
  const repository=createPostgresMatchRepository(sql),chunkSize=25;
  for(let index=0;index<source.length;index+=chunkSize){
    const end=Math.min(source.length,index+chunkSize);await repository.upsert(source.slice(index,end));
    console.log(`경기 업서트 ${end}/${source.length}`);
  }

  const stored=await repository.list({includeTimeline:true}),structure=await readStoredStructure(sql),storedById=new Map(stored.map(match=>[String(match.gameId),match])),sourceHashes=digestMap(source),storedHashes=digestMap(stored),errors=[];
  const expectedParticipantCount=source.reduce((total,match)=>total+(Array.isArray(match?.participants)?match.participants.length:0),0),expectedTimelineCount=source.filter(match=>Boolean(match?.timeline)).length;
  if(stored.length!==source.length)errors.push(`경기 수 불일치: 원본 ${source.length}, DB 조회 ${stored.length}`);
  if(structure.match_count!==source.length)errors.push(`matches 행 수 불일치: 원본 ${source.length}, DB ${structure.match_count}`);
  if(structure.participant_count!==expectedParticipantCount)errors.push(`match_participants 행 수 불일치: 원본 ${expectedParticipantCount}, DB ${structure.participant_count}`);
  if(structure.timeline_count!==expectedTimelineCount)errors.push(`match_timelines 행 수 불일치: 원본 ${expectedTimelineCount}, DB ${structure.timeline_count}`);
  if(structure.invalid_match_payload_count)errors.push(`matches.payload JSONB 객체가 아닌 행 ${structure.invalid_match_payload_count}건`);
  if(structure.invalid_epic_objectives_count)errors.push(`matches.epic_objectives JSONB 배열이 아닌 행 ${structure.invalid_epic_objectives_count}건`);
  if(structure.invalid_participant_data_count)errors.push(`match_participants.data JSONB 객체가 아닌 행 ${structure.invalid_participant_data_count}건`);
  if(structure.invalid_timeline_count)errors.push(`match_timelines.timeline JSONB 객체가 아닌 행 ${structure.invalid_timeline_count}건`);
  if(structure.invalid_timeline_frames_count)errors.push(`match_timelines.frames JSONB 배열이 아닌 행 ${structure.invalid_timeline_frames_count}건`);
  if(structure.invalid_timeline_events_count)errors.push(`match_timelines.events JSONB 배열이 아닌 행 ${structure.invalid_timeline_events_count}건`);
  for(const match of source){
    const id=String(match.gameId),dbMatch=storedById.get(id);
    if(!dbMatch){errors.push(`${id}: DB에 없음`);continue}
    if(Boolean(match.timeline)!==Boolean(dbMatch.timeline))errors.push(`${id}: 타임라인 존재 여부 불일치`);
    if(sourceHashes.get(id)!==storedHashes.get(id))errors.push(`${id}: 의미상 JSON 해시 불일치`);
  }
  for(const match of stored)if(!sourceHashes.has(String(match.gameId)))errors.push(`${match.gameId}: DB에만 존재`);
  if(errors.length){for(const error of errors.slice(0,30))console.error(`검증 실패 · ${error}`);if(errors.length>30)console.error(`외 ${errors.length-30}건`);throw new Error(`마이그레이션 검증 실패 (${errors.length}건)`)}
  const aggregateHash=hash([...sourceHashes].sort(([left],[right])=>left.localeCompare(right,"en")));
  console.log(`검증 완료 · 경기 ${structure.match_count}건 · 참가자 ${structure.participant_count}건 · 타임라인 ${structure.timeline_count}건 · 해시 ${aggregateHash}`);
}

try{await main()}catch(error){console.error(`경기 DB 마이그레이션 실패: ${error.message}`);process.exitCode=1}finally{await closeDatabase().catch(()=>{})}
