import {getDatabase} from "./db.mjs";

const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
// Let postgres.js encode JS objects for jsonb columns. Passing an
// already-stringified object stores a JSON string rather than the intended
// JSON object.
const optionalNumber=value=>value===undefined||value===null||value===""||!Number.isFinite(Number(value))?null:Number(value);

export function mergeStoredMatch(previous,next){
  if(!previous||own(next,"timeline"))return next;
  if(!previous.timeline||typeof previous.timeline!=="object")return next;
  return {...next,timeline:previous.timeline,timelineSource:String(previous.timelineSource||next.timelineSource||""),timelineCollected:true};
}

function withoutTimeline(match){
  if(!match||!own(match,"timeline"))return match;
  const copy={...match};delete copy.timeline;return copy;
}

function matchFromRow(row,includeTimeline=true){
  if(!row)return null;
  const match={...(row.payload||{}),participants:Array.isArray(row.participants)?row.participants:[]};
  if(includeTimeline&&row.timeline&&typeof row.timeline==="object")match.timeline=row.timeline;
  return match;
}

function matchSummary(match){
  const participants=Array.isArray(match?.participants)?match.participants:[],team=id=>participants.filter(player=>Number(player.teamId)===id),total=(rows,key)=>rows.reduce((sum,row)=>sum+(Number(row?.[key])||0),0),team100=team(100),team200=team(200);
  return {gameId:String(match?.gameId||""),gameCreation:Number(match?.gameCreation)||0,duration:Number(match?.duration)||0,timelineCollected:Boolean(match?.timelineCollected||match?.timeline),uploadedAt:Number(match?.uploadedAt)||0,team100:{kills:total(team100,"kills"),gold:total(team100,"gold"),win:Boolean(team100[0]?.win)},team200:{kills:total(team200,"kills"),gold:total(team200,"gold"),win:Boolean(team200[0]?.win)}};
}

async function queryPostgresMatchSummaries(sql,{gameIds=null,limit=500,offset=0}={}){
  const safeLimit=Math.max(1,Math.min(1000,Number(limit)||500)),safeOffset=Math.max(0,Number(offset)||0),where=Array.isArray(gameIds)?(gameIds.length?sql`WHERE m.game_id IN ${sql(gameIds.map(String))}`:sql`WHERE false`):sql``;
  const rows=await sql`
    SELECT m.game_id,m.game_creation,m.duration,m.timeline_collected,m.uploaded_at,
      COALESCE(sum(mp.kills) FILTER (WHERE mp.team_id=100),0)::bigint AS team_100_kills,
      COALESCE(sum(mp.gold) FILTER (WHERE mp.team_id=100),0)::bigint AS team_100_gold,
      COALESCE(bool_or(mp.win) FILTER (WHERE mp.team_id=100),false) AS team_100_win,
      COALESCE(sum(mp.kills) FILTER (WHERE mp.team_id=200),0)::bigint AS team_200_kills,
      COALESCE(sum(mp.gold) FILTER (WHERE mp.team_id=200),0)::bigint AS team_200_gold,
      COALESCE(bool_or(mp.win) FILTER (WHERE mp.team_id=200),false) AS team_200_win
    FROM matches m
    LEFT JOIN match_participants mp ON mp.game_id=m.game_id
    ${where}
    GROUP BY m.game_id,m.game_creation,m.duration,m.timeline_collected,m.uploaded_at
    ORDER BY m.game_creation DESC,m.game_id DESC
    LIMIT ${safeLimit} OFFSET ${safeOffset}
  `;
  return rows.map(row=>({gameId:String(row.game_id),gameCreation:Number(row.game_creation)||0,duration:Number(row.duration)||0,timelineCollected:Boolean(row.timeline_collected),uploadedAt:Number(row.uploaded_at)||0,team100:{kills:Number(row.team_100_kills)||0,gold:Number(row.team_100_gold)||0,win:Boolean(row.team_100_win)},team200:{kills:Number(row.team_200_kills)||0,gold:Number(row.team_200_gold)||0,win:Boolean(row.team_200_win)}}));
}

const leaderboardNumberFields=["games","wins","kills","deaths","assists","damage","duration","metricGames","metricDuration","metricDeaths","objectiveDamage","turretDamage","turretKills","inhibitorKills","objectivesStolen","objectivesStolenAssists","damageTaken","mitigated","vision","wardsKilled","controlWards","healing","unitsHealed","utilityHealing","healsOnTeammates","shieldsOnTeammates","ccTime","totalCcTime","wardsPlaced","gold"];
const normalizeLeaderboardRow=row=>Object.fromEntries(Object.entries({...row}).map(([key,value])=>[key,leaderboardNumberFields.includes(key)?Number(value)||0:value]));

async function queryPostgresLeaderboardStats(sql){
  const rows=await sql`
    SELECT mp.puuid,mp.game_name AS "gameName",mp.tag_line AS "tagLine",
      count(*)::integer AS games,count(*) FILTER (WHERE mp.win)::integer AS wins,
      sum(mp.kills)::bigint AS kills,sum(mp.deaths)::bigint AS deaths,sum(mp.assists)::bigint AS assists,
      sum(mp.damage)::bigint AS damage,sum(m.duration)::bigint AS duration,
      count(*) FILTER (WHERE mp.objective_damage IS NOT NULL OR mp.damage_taken IS NOT NULL OR mp.mitigated IS NOT NULL OR mp.cc_time IS NOT NULL OR mp.wards_placed IS NOT NULL)::integer AS "metricGames",
      COALESCE(sum(m.duration) FILTER (WHERE mp.objective_damage IS NOT NULL OR mp.damage_taken IS NOT NULL OR mp.mitigated IS NOT NULL OR mp.cc_time IS NOT NULL OR mp.wards_placed IS NOT NULL),0)::bigint AS "metricDuration",
      COALESCE(sum(mp.deaths) FILTER (WHERE mp.objective_damage IS NOT NULL OR mp.damage_taken IS NOT NULL OR mp.mitigated IS NOT NULL OR mp.cc_time IS NOT NULL OR mp.wards_placed IS NOT NULL),0)::bigint AS "metricDeaths",
      COALESCE(sum(mp.objective_damage),0)::bigint AS "objectiveDamage",COALESCE(sum(mp.turret_damage),0)::bigint AS "turretDamage",
      sum(mp.turret_kills)::bigint AS "turretKills",sum(mp.inhibitor_kills)::bigint AS "inhibitorKills",sum(mp.objectives_stolen)::bigint AS "objectivesStolen",sum(mp.objectives_stolen_assists)::bigint AS "objectivesStolenAssists",
      COALESCE(sum(mp.damage_taken),0)::bigint AS "damageTaken",COALESCE(sum(mp.mitigated),0)::bigint AS mitigated,sum(mp.vision)::bigint AS vision,COALESCE(sum(mp.wards_killed),0)::bigint AS "wardsKilled",COALESCE(sum(mp.control_wards),0)::bigint AS "controlWards",
      COALESCE(sum(mp.healing),0)::bigint AS healing,COALESCE(sum(mp.units_healed),0)::bigint AS "unitsHealed",COALESCE(sum(mp.healing) FILTER (WHERE mp.units_healed>1),0)::bigint AS "utilityHealing",COALESCE(sum(mp.heals_on_teammates),0)::bigint AS "healsOnTeammates",COALESCE(sum(mp.shields_on_teammates),0)::bigint AS "shieldsOnTeammates",
      COALESCE(sum(mp.cc_time),0)::bigint AS "ccTime",COALESCE(sum(mp.total_cc_time),0)::bigint AS "totalCcTime",COALESCE(sum(mp.wards_placed),0)::bigint AS "wardsPlaced",sum(mp.gold)::bigint AS gold
    FROM match_participants mp JOIN matches m ON m.game_id=mp.game_id
    GROUP BY mp.puuid,mp.game_name,mp.tag_line
  `;
  return rows.map(normalizeLeaderboardRow);
}

function blobLeaderboardStats(matches){
  const grouped=new Map(),metricKeys=["objectiveDamage","damageTaken","mitigated","ccTime","wardsPlaced"];
  for(const match of matches||[])for(const player of match.participants||[]){const key=String(player.puuid||`${player.gameName||""}#${player.tagLine||""}`).toLowerCase(),row=grouped.get(key)||{puuid:String(player.puuid||""),gameName:String(player.gameName||""),tagLine:String(player.tagLine||"")};for(const field of leaderboardNumberFields)if(row[field]===undefined)row[field]=0;const metric=metricKeys.some(field=>Object.prototype.hasOwnProperty.call(player,field));row.games++;row.wins+=Number(Boolean(player.win));row.kills+=Number(player.kills)||0;row.deaths+=Number(player.deaths)||0;row.assists+=Number(player.assists)||0;row.damage+=Number(player.damage)||0;row.duration+=Number(match.duration)||0;if(metric){row.metricGames++;row.metricDuration+=Number(match.duration)||0;row.metricDeaths+=Number(player.deaths)||0}for(const field of ["objectiveDamage","turretDamage","turretKills","inhibitorKills","objectivesStolen","objectivesStolenAssists","damageTaken","mitigated","vision","wardsKilled","controlWards","healing","unitsHealed","healsOnTeammates","shieldsOnTeammates","ccTime","totalCcTime","wardsPlaced","gold"])row[field]+=Number(player[field])||0;if((Number(player.unitsHealed)||0)>1)row.utilityHealing+=Number(player.healing)||0;grouped.set(key,row)}
  return [...grouped.values()];
}

async function queryPostgresMatches(sql,{gameIds=null,includeTimeline=true}={}){
  const timelineSelect=includeTimeline?sql`, t.timeline`:sql``;
  const timelineJoin=includeTimeline?sql`LEFT JOIN match_timelines t ON t.game_id=m.game_id`:sql``;
  const where=Array.isArray(gameIds)?(gameIds.length?sql`WHERE m.game_id IN ${sql(gameIds)}`:sql`WHERE false`):sql``;
  const rows=await sql`
    SELECT m.game_id,m.payload,
      COALESCE(p.participants,'[]'::jsonb) AS participants
      ${timelineSelect}
    FROM matches m
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(mp.data ORDER BY mp.slot) AS participants
      FROM match_participants mp WHERE mp.game_id=m.game_id
    ) p ON true
    ${timelineJoin}
    ${where}
    ORDER BY m.ordinal ASC
  `;
  return rows.map(row=>matchFromRow(row,includeTimeline));
}

const participantColumns=["game_id","slot","participant_id","puuid","game_name","tag_line","team_id","win","role","champion_id","champion_key","champion_name","kills","deaths","assists","damage","gold","vision","cs","damage_taken","mitigated","turret_damage","objective_damage","healing","units_healed","heals_on_teammates","shields_on_teammates","cc_time","total_cc_time","wards_placed","wards_killed","control_wards","turret_kills","inhibitor_kills","objectives_stolen","objectives_stolen_assists","solo_kills","solo_deaths","triple_kills","quadra_kills","penta_kills","data"];

function participantRow(gameId,participant,index){
  const number=(key)=>Number(participant?.[key])||0;
  return {game_id:gameId,slot:index+1,participant_id:optionalNumber(participant?.participantId),puuid:String(participant?.puuid||""),game_name:String(participant?.gameName||""),tag_line:String(participant?.tagLine||""),team_id:number("teamId"),win:Boolean(participant?.win),role:String(participant?.role||"MID"),champion_id:optionalNumber(participant?.championId),champion_key:String(participant?.championKey||""),champion_name:String(participant?.championName||""),kills:number("kills"),deaths:number("deaths"),assists:number("assists"),damage:number("damage"),gold:number("gold"),vision:number("vision"),cs:number("cs"),damage_taken:optionalNumber(participant?.damageTaken),mitigated:optionalNumber(participant?.mitigated),turret_damage:optionalNumber(participant?.turretDamage),objective_damage:optionalNumber(participant?.objectiveDamage),healing:optionalNumber(participant?.healing),units_healed:optionalNumber(participant?.unitsHealed),heals_on_teammates:optionalNumber(participant?.healsOnTeammates),shields_on_teammates:optionalNumber(participant?.shieldsOnTeammates),cc_time:optionalNumber(participant?.ccTime),total_cc_time:optionalNumber(participant?.totalCcTime),wards_placed:optionalNumber(participant?.wardsPlaced),wards_killed:optionalNumber(participant?.wardsKilled),control_wards:optionalNumber(participant?.controlWards),turret_kills:number("turretKills"),inhibitor_kills:number("inhibitorKills"),objectives_stolen:number("objectivesStolen"),objectives_stolen_assists:number("objectivesStolenAssists"),solo_kills:number("soloKills"),solo_deaths:number("soloDeaths"),triple_kills:number("tripleKills"),quadra_kills:number("quadraKills"),penta_kills:number("pentaKills"),data:participant||{}};
}

function baseMatchRow(match){
  const payload={...match};delete payload.participants;delete payload.timeline;
  return {game_id:String(match.gameId),game_creation:Number(match.gameCreation)||Date.now(),duration:Number(match.duration)||0,game_mode:String(match.gameMode||"CUSTOM"),game_type:String(match.gameType||"CUSTOM_GAME"),queue_id:Number(match.queueId)||0,has_timeline:Boolean(match.timeline&&typeof match.timeline==="object"),timeline_collected:Boolean(match.timelineCollected||match.timeline),timeline_source:String(match.timelineSource||""),timeline_error:String(match.timelineError||""),epic_objectives:Array.isArray(match.epicObjectives)?match.epicObjectives:[],uploaded_at:Number(match.uploadedAt)||Date.now(),payload};
}

export function createPostgresMatchRepository(sql=getDatabase()){
  return {
    async list(options={}){return queryPostgresMatches(sql,options)},
    async get(gameId,{includeTimeline=true}={}){return (await queryPostgresMatches(sql,{gameIds:[String(gameId)],includeTimeline}))[0]||null},
    async summaries(options={}){return queryPostgresMatchSummaries(sql,options)},
    async leaderboardStats(){return queryPostgresLeaderboardStats(sql)},
    async count(){const [row]=await sql`SELECT count(*)::integer AS count FROM matches`;return Number(row?.count)||0},
    async upsert(incoming){
      const matches=(Array.isArray(incoming)?incoming:[]).filter(Boolean);
      if(!matches.length)return {received:0,total:await this.count(),replaced:[],replacedCount:0};
      const ids=[...new Set(matches.map(match=>String(match.gameId)))];
      return sql.begin(async tx=>{
        const previous=await queryPostgresMatches(tx,{gameIds:ids,includeTimeline:true}),previousById=new Map(previous.map(match=>[String(match.gameId),match])),mergedById=new Map();
        for(const match of matches){const gameId=String(match.gameId);mergedById.set(gameId,mergeStoredMatch(mergedById.get(gameId)||previousById.get(gameId),match))}
        // Stable lock order prevents two overlapping bulk uploads from
        // deadlocking when they contain the same game ids in different order.
        const merged=[...mergedById.values()].sort((left,right)=>String(left.gameId).localeCompare(String(right.gameId),"en")),baseRows=merged.map(baseMatchRow);
        await tx`
          INSERT INTO matches ${tx(baseRows,"game_id","game_creation","duration","game_mode","game_type","queue_id","has_timeline","timeline_collected","timeline_source","timeline_error","epic_objectives","uploaded_at","payload")}
          ON CONFLICT (game_id) DO UPDATE SET
            game_creation=EXCLUDED.game_creation,duration=EXCLUDED.duration,game_mode=EXCLUDED.game_mode,
            game_type=EXCLUDED.game_type,queue_id=EXCLUDED.queue_id,
            has_timeline=(matches.has_timeline OR EXCLUDED.has_timeline),
            timeline_collected=(CASE WHEN matches.has_timeline AND NOT EXCLUDED.has_timeline THEN true ELSE EXCLUDED.timeline_collected END),
            timeline_source=(CASE WHEN matches.has_timeline AND NOT EXCLUDED.has_timeline THEN matches.timeline_source ELSE EXCLUDED.timeline_source END),
            timeline_error=EXCLUDED.timeline_error,epic_objectives=EXCLUDED.epic_objectives,uploaded_at=EXCLUDED.uploaded_at,
            payload=(CASE WHEN matches.has_timeline AND NOT EXCLUDED.has_timeline THEN EXCLUDED.payload || jsonb_build_object('timelineCollected',true,'timelineSource',matches.timeline_source) ELSE EXCLUDED.payload END),
            updated_at=now()
        `;
        await tx`DELETE FROM match_participants WHERE game_id IN ${tx(ids)}`;
        const participantRows=merged.flatMap(match=>(Array.isArray(match.participants)?match.participants:[]).map((participant,index)=>participantRow(String(match.gameId),participant,index)));
        if(participantRows.length)await tx`INSERT INTO match_participants ${tx(participantRows,...participantColumns)}`;
        for(const match of merged){
          if(!own(match,"timeline"))continue;
          if(!match.timeline||typeof match.timeline!=="object"){
            await tx`DELETE FROM match_timelines WHERE game_id=${String(match.gameId)}`;
            continue;
          }
          const timeline=match.timeline;
          await tx`
            INSERT INTO match_timelines (game_id,frame_interval,frames,events,timeline)
            VALUES (${String(match.gameId)},${Number(timeline.frameInterval)||60000},${tx.json(Array.isArray(timeline.frames)?timeline.frames:[])}::jsonb,${tx.json(Array.isArray(timeline.events)?timeline.events:[])}::jsonb,${tx.json(timeline)}::jsonb)
            ON CONFLICT (game_id) DO UPDATE SET frame_interval=EXCLUDED.frame_interval,frames=EXCLUDED.frames,events=EXCLUDED.events,timeline=EXCLUDED.timeline,updated_at=now()
          `;
        }
        const [countRow]=await tx`SELECT count(*)::integer AS count FROM matches`,replaced=matches.map(match=>previousById.has(String(match.gameId)));
        return {received:matches.length,total:Number(countRow?.count)||0,replaced,replacedCount:replaced.filter(Boolean).length};
      });
    },
  };
}

function createBlobRepository(loadBlob,saveBlob){
  return {
    async list({includeTimeline=true}={}){const value=await loadBlob(),matches=Array.isArray(value)?value:[];return includeTimeline?matches:matches.map(withoutTimeline)},
    async get(gameId,{includeTimeline=true}={}){const match=(await this.list({includeTimeline:true})).find(item=>String(item.gameId)===String(gameId))||null;return includeTimeline?match:withoutTimeline(match)},
    async summaries({gameIds=null,limit=500,offset=0}={}){const ids=Array.isArray(gameIds)?new Set(gameIds.map(String)):null,matches=(await this.list({includeTimeline:false})).filter(match=>!ids||ids.has(String(match.gameId))).sort((left,right)=>(Number(right.gameCreation)||0)-(Number(left.gameCreation)||0));return matches.slice(Math.max(0,Number(offset)||0),Math.max(0,Number(offset)||0)+Math.max(1,Math.min(1000,Number(limit)||500))).map(matchSummary)},
    async leaderboardStats(){return blobLeaderboardStats(await this.list({includeTimeline:false}))},
    async count(){return (await this.list()).length},
    async upsert(incoming){const matches=await this.list(),byId=new Map(matches.map((match,index)=>[String(match.gameId),{match,index}])),replaced=[];for(const next of incoming){const key=String(next.gameId),entry=byId.get(key);replaced.push(Boolean(entry));if(entry){entry.match=mergeStoredMatch(entry.match,next);matches[entry.index]=entry.match}else{byId.set(key,{match:next,index:matches.length});matches.push(next)}}await saveBlob(matches);return {received:incoming.length,total:matches.length,replaced,replacedCount:replaced.filter(Boolean).length}},
    async replaceAll(matches){await saveBlob(matches);return {received:matches.length,total:matches.length,replaced:[],replacedCount:0}},
  };
}

export function createMatchStore({mode=process.env.MATCH_STORE_MODE||"blob",loadBlob,saveBlob,postgresRepository,logger=console}={}){
  const selected=String(mode||"blob").trim().toLowerCase();
  if(!["blob","shadow","postgres"].includes(selected))throw new Error(`지원하지 않는 MATCH_STORE_MODE입니다: ${selected}`);
  if(typeof loadBlob!=="function"||typeof saveBlob!=="function")throw new TypeError("loadBlob과 saveBlob 함수가 필요합니다.");
  const blob=createBlobRepository(loadBlob,saveBlob);
  let postgresRepo=postgresRepository||null;
  const pg=()=>postgresRepo||(postgresRepo=createPostgresMatchRepository());
  const shadow=async operation=>{try{await operation(pg())}catch(error){logger?.error?.("PostgreSQL shadow write failed",error)}};
  return {
    mode:selected,
    async list(options={}){return selected==="postgres"?pg().list(options):blob.list(options)},
    async get(gameId,options={}){return selected==="postgres"?pg().get(gameId,options):blob.get(gameId,options)},
    async summaries(options={}){return selected==="postgres"?pg().summaries(options):blob.summaries(options)},
    async leaderboardStats(){return selected==="postgres"?pg().leaderboardStats():blob.leaderboardStats()},
    async count(){return selected==="postgres"?pg().count():blob.count()},
    async upsert(matches){
      const incoming=Array.isArray(matches)?matches:[];
      if(selected==="postgres")return pg().upsert(incoming);
      const result=await blob.upsert(incoming);
      if(selected==="shadow")await shadow(repository=>repository.upsert(incoming));
      return result;
    },
    async replaceAll(matches){
      const incoming=Array.isArray(matches)?matches:[];
      if(selected==="postgres")return pg().upsert(incoming);
      const result=await blob.replaceAll(incoming);
      if(selected==="shadow")await shadow(repository=>repository.upsert(incoming));
      return result;
    },
  };
}
