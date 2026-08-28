import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadJson, saveJson, stateFiles } from "./storage.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const { matches: dataFile, appState: appStateFile, runtime: runtimeConfigFile } = stateFiles(root);
const uploadToken = process.env.UPLOADER_TOKEN || "";
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".svg":"image/svg+xml" };

const json = (res,status,body) => { res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}); res.end(JSON.stringify(body)); };
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
const readBody = async req => { const chunks=[]; let size=0; for await (const chunk of req) { size+=chunk.length; if(size>6_000_000) throw Object.assign(new Error("요청 데이터가 너무 큽니다."),{status:413}); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}"); };
async function loadMatches(){ const value=await loadJson("internal-matches",dataFile,[]);return Array.isArray(value)?value:[] }
async function saveMatches(matches){ await saveJson("internal-matches",dataFile,matches) }
async function loadAppState(){ const value=await loadJson("app-state",appStateFile,{version:1,players:[],seriesState:{active:null,history:[]}});return value&&typeof value==="object"?value:{version:1,players:[],seriesState:{active:null,history:[]}} }
async function saveAppState(value){await saveJson("app-state",appStateFile,value)}
async function loadRuntimeConfig(){return loadJson("runtime-config",runtimeConfigFile,{})}
async function saveRuntimeConfig(config){await saveJson("runtime-config",runtimeConfigFile,config)}
const requireUploaderAuth=req=>{if(!uploadToken)throw Object.assign(new Error("서버에 UPLOADER_TOKEN이 설정되지 않았습니다."),{status:503});if(String(req.headers.authorization||"")!==`Bearer ${uploadToken}`)throw Object.assign(new Error("업로더 인증키가 올바르지 않습니다."),{status:401})};
function validateMatch(match){
  if(!match || !/^\d{6,12}$/.test(String(match.gameId||""))) throw Object.assign(new Error("올바른 게임 ID가 아닙니다."),{status:400});
  if(!Array.isArray(match.participants) || match.participants.length!==10) throw Object.assign(new Error("참가자 10명의 경기 데이터가 필요합니다."),{status:400});
  const roles=new Set(["TOP","JUNGLE","MID","ADC","SUPPORT"]);
  const participants=match.participants.map(p=>({ puuid:String(p.puuid||""), gameName:String(p.gameName||"").slice(0,40), tagLine:String(p.tagLine||"").slice(0,12), teamId:Number(p.teamId), win:Boolean(p.win), role:roles.has(p.role)?p.role:"MID", championName:String(p.championName||"Unknown").slice(0,40), kills:Number(p.kills)||0, deaths:Number(p.deaths)||0, assists:Number(p.assists)||0, damage:Number(p.damage)||0, gold:Number(p.gold)||0, vision:Number(p.vision)||0, cs:Number(p.cs)||0 }));
  if(participants.some(p=>![100,200].includes(p.teamId)||!p.gameName)) throw Object.assign(new Error("참가자 데이터 형식이 올바르지 않습니다."),{status:400});
  return { gameId:String(match.gameId), gameCreation:Number(match.gameCreation)||Date.now(), duration:Number(match.duration)||0, gameMode:String(match.gameMode||"CUSTOM"), gameType:String(match.gameType||"CUSTOM_GAME"), queueId:Number(match.queueId)||0, participants, uploadedAt:Date.now() };
}
const riotFetch = async (url,key) => { for(let attempt=0;attempt<3;attempt++){ const response=await fetch(url,{headers:{"X-Riot-Token":key}}); if(response.ok)return response.json(); if(response.status===429&&attempt<2){await wait((Number(response.headers.get("retry-after"))||1.2)*1000);continue} const error=new Error(response.status===404?"플레이어 또는 전적을 찾을 수 없습니다.":response.status===401||response.status===403?"Riot API 키가 만료되었거나 올바르지 않습니다.":response.status===429?"API 호출 한도를 초과했습니다.":"Riot API 요청에 실패했습니다."); error.status=response.status; error.details=await response.text(); throw error; } };
const roleMap={TOP:"TOP",JUNGLE:"JUNGLE",MIDDLE:"MID",BOTTOM:"ADC",UTILITY:"SUPPORT"};
async function getPlayerData(riotId,requestedCount){
  const riotApiKey=process.env.RIOT_API_KEY||(await loadRuntimeConfig()).riotApiKey;
  if(!riotApiKey) throw Object.assign(new Error("서버에 Riot API 키가 설정되지 않았습니다. 응CK 업로더에서 먼저 저장해주세요."),{status:503});
  const split=riotId.lastIndexOf("#"); if(split<1)throw Object.assign(new Error("Riot ID를 게임이름#태그 형식으로 입력해주세요."),{status:400});
  const gameName=riotId.slice(0,split).trim(),tagLine=riotId.slice(split+1).trim();
  const account=await riotFetch(`https://asia.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,riotApiKey),matchCount=Math.max(5,Math.min(60,Number(requestedCount)||40));
  const [entries,matchIds,versions]=await Promise.all([riotFetch(`https://kr.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(account.puuid)}`,riotApiKey),riotFetch(`https://asia.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(account.puuid)}/ids?queue=420&start=0&count=${matchCount}`,riotApiKey),fetch("https://ddragon.leagueoflegends.com/api/versions.json").then(r=>r.json()).catch(()=>["16.15.1"])]);
  const matches=[]; for(let i=0;i<matchIds.length;i+=5){matches.push(...await Promise.all(matchIds.slice(i,i+5).map(id=>riotFetch(`https://asia.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(id)}`,riotApiKey))));if(i+5<matchIds.length)await wait(400)}
  const games=matches.map(m=>m.info.participants.find(p=>p.puuid===account.puuid)).filter(Boolean),roles=new Map(),champions=new Map();
  for(const game of games){const role=roleMap[game.teamPosition];if(role)roles.set(role,(roles.get(role)||0)+1);const c=champions.get(game.championName)||{name:game.championName,games:0,wins:0,kills:0,deaths:0,assists:0};c.games++;c.wins+=Number(game.win);c.kills+=game.kills;c.deaths+=game.deaths;c.assists+=game.assists;champions.set(game.championName,c)}
  const roleRanking=[...roles.entries()].sort((a,b)=>b[1]-a[1]),most=[...champions.values()].sort((a,b)=>b.games-a.games||b.wins-a.wins).slice(0,3).map(c=>({...c,winRate:Math.round(c.wins/c.games*100),kda:Number(((c.kills+c.assists)/Math.max(1,c.deaths)).toFixed(2))})),solo=entries.find(e=>e.queueType==="RANKED_SOLO_5x5"),wins=games.filter(g=>g.win).length,mainRole=roleRanking[0]?.[0]||"MID",subRole=roleRanking.find(([r])=>r!==mainRole)?.[0]||(mainRole==="SUPPORT"?"MID":"SUPPORT");
  return {gameName:account.gameName,tagLine:account.tagLine,puuid:account.puuid,tier:solo?.tier||"UNRANKED",division:solo?.rank||"",lp:solo?.leaguePoints||0,wins:solo?.wins||0,losses:solo?.losses||0,role:mainRole,secondary:subRole,roleGames:Object.fromEntries(roleRanking),recentGames:games.length,recentWinRate:games.length?Math.round(wins/games.length*100):0,form:games.length?Math.round((wins/games.length-.5)*120):0,most,dataDragonVersion:versions[0]};
}

export async function handleRequest(req,res){
  const url=new URL(req.url,`http://${req.headers.host||"localhost"}`),pathname=url.pathname;
  try{
    if(pathname==="/api/health")return json(res,200,{ok:true,uploaderAuth:Boolean(uploadToken),serverStorage:process.env.BLOB_READ_WRITE_TOKEN?"vercel-blob":"local-file"});
    if(pathname==="/api/player")return json(res,200,await getPlayerData(url.searchParams.get("riotId")||"",url.searchParams.get("matches")));
    if(pathname==="/api/internal-matches"&&req.method==="GET")return json(res,200,await loadMatches());
    if(pathname==="/api/app-state"&&req.method==="GET")return json(res,200,await loadAppState());
    if(pathname==="/api/app-state"&&(req.method==="POST"||req.method==="PUT")){
      const body=await readBody(req),players=Array.isArray(body.players)?body.players.slice(0,200):[],seriesState=body.seriesState&&typeof body.seriesState==="object"?body.seriesState:{active:null,history:[]};
      const state={version:1,players,seriesState,ladderChoice:body.ladderChoice||null,updatedAt:Date.now()};await saveAppState(state);return json(res,200,{ok:true,updatedAt:state.updatedAt});
    }
    if(pathname==="/api/internal-match"&&req.method==="GET"){const match=(await loadMatches()).find(m=>m.gameId===url.searchParams.get("id"));if(!match)throw Object.assign(new Error("서버에 없는 경기입니다. 방장 PC의 응CK 업로더로 먼저 전송해주세요."),{status:404});return json(res,200,match)}
    if(pathname==="/api/uploader/riot-key"&&req.method==="POST"){
      requireUploaderAuth(req);const body=await readBody(req),riotApiKey=String(body.riotApiKey||"").trim();if(!/^RGAPI-[A-Za-z0-9-]{20,}$/.test(riotApiKey))throw Object.assign(new Error("올바른 Riot API 키 형식이 아닙니다."),{status:400});const config=await loadRuntimeConfig();config.riotApiKey=riotApiKey;config.updatedAt=Date.now();await saveRuntimeConfig(config);return json(res,200,{ok:true,configured:true});
    }
    if(pathname==="/api/internal-matches/upload"&&req.method==="POST"){
      requireUploaderAuth(req);
      const match=validateMatch(await readBody(req)),matches=await loadMatches(),index=matches.findIndex(m=>m.gameId===match.gameId);if(index>=0)matches[index]=match;else matches.push(match);await saveMatches(matches);return json(res,index>=0?200:201,{ok:true,replaced:index>=0,gameId:match.gameId,total:matches.length});
    }
    const file=pathname==="/"?"index.html":pathname.slice(1);if(file.includes("..")){res.writeHead(403).end("Forbidden");return}const data=await readFile(join(root,file));res.writeHead(200,{"Content-Type":types[extname(file)]||"application/octet-stream","Cache-Control":"no-store"});res.end(data);
  }catch(error){console.error(error.details||error);json(res,error.status||500,{error:error.message||"서버 오류가 발생했습니다."})}
}

if(!process.env.VERCEL)createServer(handleRequest).listen(port,host,()=>console.log(`응CK연구소: http://${host}:${port}`));
