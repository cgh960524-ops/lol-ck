import { createServer } from "node:http";
import { verifyKey } from "discord-interactions";
import { waitUntil } from "@vercel/functions";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadJson, saveJson, stateFiles } from "./storage.mjs";
import { staticAssets } from "./static-assets.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const { matches: dataFile, appState: appStateFile, runtime: runtimeConfigFile } = stateFiles(root);
const uploadToken = process.env.UPLOADER_TOKEN || "";
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".svg":"image/svg+xml", ".txt":"text/plain; charset=utf-8" };

const json = (res,status,body) => { res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}); res.end(JSON.stringify(body)); };
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
const readRawBody = async req => { const chunks=[]; let size=0; for await (const chunk of req) { size+=chunk.length; if(size>1_000_000) throw Object.assign(new Error("요청 데이터가 너무 큽니다."),{status:413}); chunks.push(chunk); } return Buffer.concat(chunks); };
const readBody = async req => { const chunks=[]; let size=0; for await (const chunk of req) { size+=chunk.length; if(size>6_000_000) throw Object.assign(new Error("요청 데이터가 너무 큽니다."),{status:413}); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}"); };
async function loadMatches(){ const value=await loadJson("internal-matches",dataFile,[]);return Array.isArray(value)?value:[] }
async function saveMatches(matches){ await saveJson("internal-matches",dataFile,matches) }
async function loadAppState(){ const value=await loadJson("app-state",appStateFile,{version:1,players:[],seriesState:{active:null,history:[]}});return value&&typeof value==="object"?value:{version:1,players:[],seriesState:{active:null,history:[]}} }
async function saveAppState(value){await saveJson("app-state",appStateFile,value)}
async function loadRuntimeConfig(){return loadJson("runtime-config",runtimeConfigFile,{})}
async function saveRuntimeConfig(config){await saveJson("runtime-config",runtimeConfigFile,config)}
async function registerDiscordHallOfFameCommand(){
  const applicationId=String(process.env.DISCORD_APPLICATION_ID||"").trim(),botToken=String(process.env.DISCORD_BOT_TOKEN||"").trim(),guildId=String(process.env.DISCORD_GUILD_ID||"1434891063327461481").trim();
  if(!applicationId||!botToken)throw Object.assign(new Error("DISCORD_APPLICATION_ID 또는 DISCORD_BOT_TOKEN이 설정되지 않았습니다."),{status:503});
  const hallPayload={name:"명예의전당",description:"응CK 내전의 부문별 명예의전당 순위를 확인합니다.",type:1,options:[{type:3,name:"부문",description:"보고 싶은 명예의전당 부문을 선택하세요.",required:true,choices:discordHallCategoryOptions.map(({name,value})=>({name,value}))}]},cancelPayload={name:"내전취소",description:"활성 내전 모집 또는 지정한 모집 ID를 취소합니다.",type:1,options:[{type:3,name:"모집id",description:"예: ck-recruitment:mtt6q0gn-if26eg:0 (비우면 현재 모집)",required:false}]},register=async(payload,url)=>{const response=await fetch(url,{method:"POST",headers:{Authorization:`Bot ${botToken}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});if(!response.ok)throw Object.assign(new Error(`Discord 명령어 등록 실패 (${response.status})`),{status:502,details:await response.text()});return response.json()},globalCommand=await register(hallPayload,`https://discord.com/api/v10/applications/${applicationId}/commands`),guildCommand=guildId?await register(hallPayload,`https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`):null,cancelCommand=guildId?await register(cancelPayload,`https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`):await register(cancelPayload,`https://discord.com/api/v10/applications/${applicationId}/commands`);
  return {ok:true,id:globalCommand.id,name:globalCommand.name,guildId,guildCommandId:guildCommand?.id||null,cancelCommandId:cancelCommand.id};
}
const discordWebhookUrl=process.env.DISCORD_WEBHOOK_URL||"";
const publicAppUrl=process.env.PUBLIC_APP_URL||"https://lol-ck.vercel.app/";
const discordPlayerRegistrationChannelId=process.env.DISCORD_PLAYER_REGISTRATION_CHANNEL_ID||"1547004141363142747";
const roleKo={TOP:"탑",JUNGLE:"정글",MID:"미드",ADC:"원딜",SUPPORT:"서폿"};
const discordSafe=value=>String(value??"").replace(/([\\`*_{}\[\]()<>#+\-.!|])/g,"\\$1").slice(0,1000);
const seriesCaptain=(series,side)=>{const team=side==="BLUE"?series?.blue:series?.red,id=side==="BLUE"?series?.blueCaptainId:series?.redCaptainId;return (team||[]).find(player=>String(player.id)===String(id))||[...(team||[])].sort((a,b)=>(Number(b.power)||0)-(Number(a.power)||0))[0]||{name:side}};
const seriesTeamName=(series,side)=>`${seriesCaptain(series,side).name} 팀`;
const rosterText=(series,side)=>(side==="BLUE"?series.blue:series.red).map(player=>`${roleKo[player.role]||player.role} · ${discordSafe(player.name)} (${Math.round(Number(player.power)||0).toLocaleString()})`).join("\n").slice(0,1024);
async function sendDiscord(payload){
  if(!discordWebhookUrl)return;
  try{const response=await fetch(discordWebhookUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,username:"응CK 연구소"})});if(!response.ok)throw new Error(`Discord webhook ${response.status}: ${(await response.text()).slice(0,200)}`)}catch(error){console.error("Discord notification failed:",error.message)}
}
function scoreOf(series){return {blue:(series.sets||[]).filter(set=>set.imported&&set.winner==="BLUE").length,red:(series.sets||[]).filter(set=>set.imported&&set.winner==="RED").length}}
async function notifySeriesChanges(previous,next){
  if(!discordWebhookUrl)return;
  const before=previous?.seriesState?.active,after=next?.seriesState?.active;
  if(after&&String(after.id)!==String(before?.id))await sendDiscord({embeds:[{title:"⚔️ 새로운 내전이 시작됐습니다",description:`**${discordSafe(seriesTeamName(after,"BLUE"))} VS ${discordSafe(seriesTeamName(after,"RED"))}**`,color:3447003,fields:[{name:`🔵 ${discordSafe(seriesTeamName(after,"BLUE"))}`,value:rosterText(after,"BLUE"),inline:true},{name:`🔴 ${discordSafe(seriesTeamName(after,"RED"))}`,value:rosterText(after,"RED"),inline:true}],url:publicAppUrl,timestamp:new Date().toISOString()}]});
  if(after){
    const previousSets=new Set((before?.sets||[]).filter(set=>set.imported).map(set=>String(set.gameId)));
    for(const set of (after.sets||[]).filter(set=>set.imported&&!previousSets.has(String(set.gameId)))){
      const score=scoreOf(after),match=(await loadMatches()).find(item=>String(item.gameId)===String(set.gameId)),winner=seriesTeamName(after,set.winner),participants=match?.participants||[],winningSide=participants.find(player=>player.win)?.teamId,winningPlayers=participants.filter(player=>player.teamId===winningSide),mvp=[...winningPlayers].sort((a,b)=>(Number(b.damage)||0)-(Number(a.damage)||0))[0],kills=teamId=>participants.filter(player=>player.teamId===teamId).reduce((sum,player)=>sum+(Number(player.kills)||0),0),teamIds=[...new Set(participants.map(player=>player.teamId))];
      const stats=match?`킬 ${kills(teamIds[0])} : ${kills(teamIds[1])} · ${Math.round((Number(match.duration)||0)/60)}분${mvp?`\n승리팀 딜량 1위 · ${discordSafe(mvp.gameName)} ${Math.round(Number(mvp.damage)||0).toLocaleString()}`:""}`:"경기 데이터 집계 완료";
      await sendDiscord({embeds:[{title:`✅ ${set.number}세트 · ${discordSafe(winner)} 승리`,description:`현재 스코어 **${score.blue} : ${score.red}**\n${stats}`,color:set.winner==="BLUE"?3447003:15158332,fields:[{name:"게임 ID",value:discordSafe(set.gameId),inline:true},{name:"결과 보기",value:`[응CK 연구소 열기](${publicAppUrl})`,inline:true}],timestamp:new Date().toISOString()}]});
    }
  }
  if(after?.finished&&!before?.finished){
    const score=scoreOf(after),winner=seriesTeamName(after,after.finalWinner),pog=[...(after.blue||[]),...(after.red||[])].find(player=>String(player.id)===String(after.pogId));
    await sendDiscord({content:"🏆 **내전 시리즈 최종 결과**",embeds:[{title:`${discordSafe(winner)} 최종 승리`,description:`**${discordSafe(seriesTeamName(after,"BLUE"))} ${score.blue} : ${score.red} ${discordSafe(seriesTeamName(after,"RED"))}**\n\n🏅 POG · **${discordSafe(pog?.name||"-")}** (${Number(after.pogScore||0).toFixed(1)}점)`,color:15844367,url:publicAppUrl,timestamp:new Date().toISOString()}]});
  }
}
async function verifyDiscordRequest(req,raw){
  const publicKey=String(process.env.DISCORD_PUBLIC_KEY||"").trim(),signature=String(req.headers["x-signature-ed25519"]||""),timestamp=String(req.headers["x-signature-timestamp"]||"");
  if(!/^[0-9a-f]{64}$/i.test(publicKey)||!/^[0-9a-f]{128}$/i.test(signature)||!timestamp){console.error("Discord signature metadata invalid",{publicKeyLength:publicKey.length,signatureLength:signature.length,hasTimestamp:Boolean(timestamp),rawLength:raw.length,bodyType:typeof req.body});return false}
  try{const valid=await verifyKey(raw,signature,timestamp,publicKey);if(!valid)console.error("Discord signature mismatch",{rawLength:raw.length,bodyType:typeof req.body});return valid}catch(error){console.error("Discord signature exception",error.message);return false}
}
const discordReply=(content,extra={})=>({type:4,data:{content,flags:64,...extra}});
const optionValue=(interaction,name)=>interaction.data?.options?.find(option=>option.name===name)?.value;
const discordTierScore={UNRANKED:1000,IRON:800,BRONZE:950,SILVER:1100,GOLD:1250,PLATINUM:1420,EMERALD:1580,DIAMOND:1780,MASTER:2050,GRANDMASTER:2200,CHALLENGER:2380};
const discordTierKo={UNRANKED:"언랭크",IRON:"아이언",BRONZE:"브론즈",SILVER:"실버",GOLD:"골드",PLATINUM:"플래티넘",EMERALD:"에메랄드",DIAMOND:"다이아몬드",MASTER:"마스터",GRANDMASTER:"그랜드마스터",CHALLENGER:"챌린저"};
const discordDivisionNumber={I:"1",II:"2",III:"3",IV:"4"};
const discordInternalWeight=games=>games<=0?0:games===1?.25:games===2?.42:games===3?.55:games<=5?.7:games<=7?.82:games<=10?.9:games<20?.93:.95;
const discordBasePower=player=>(discordTierScore[player.tier]||1000)+(Number(player.form)||0);
function discordEffectiveRoleData(player,role){const actual=player.internalRoles?.[role],prior=player.rolePriors?.[role],games=actual?.games||0,priorGames=prior?.gamesEquivalent||0;if(!priorGames)return actual;return {games:games+priorGames,rating:Math.round(((actual?.rating||prior.rating)*games+prior.rating*priorGames)/Math.max(1,games+priorGames))}}
function discordPlayerPower(player,assigned=player.role){const games=player.internalGames||0,weight=discordInternalWeight(games),roleData=discordEffectiveRoleData(player,assigned),roleGames=roleData?.games||0,confidence=roleGames/(roleGames+8),position=assigned==="SUPPORT"?-35:assigned===player.role?70:assigned===player.secondary?-20:-160+120*confidence,overall=player.internalRating||discordBasePower(player),internal=roleGames?roleData.rating*confidence+overall*(1-confidence):overall;return Math.round(discordBasePower(player)*(1-weight)+internal*weight+position+(Number(player.internalChampionScore)||0))}
const hofSum=(games,key)=>games.reduce((total,{mp})=>total+(Number(mp[key])||0),0);
const hofIdentity=(gameName,tagLine)=>normName(`${gameName||""}#${tagLine||""}`);
const hofClamp=value=>Math.max(0,Math.min(1,Number(value)||0));
function discordHofBehavior({mp,match}){const team=(match.participants||[]).filter(player=>player.teamId===mp.teamId),sum=key=>team.reduce((total,player)=>total+(Number(player[key])||0),0),deathBurden=hofClamp((Number(mp.deaths)||0)/Math.max(1,sum("deaths"))/.2),kp=hofClamp((Number(mp.kills)+Number(mp.assists))/Math.max(1,sum("kills"))),playerEfficiency=(Number(mp.damage)||0)/Math.max(1,Number(mp.gold)||0),teamEfficiency=sum("damage")/Math.max(1,sum("gold")),efficiency=hofClamp(playerEfficiency/Math.max(.01,teamEfficiency)/1.5),vision=hofClamp((Number(mp.vision)||0)/Math.max(1,sum("vision"))/.2),exposure=hofClamp((Number(mp.damageTaken)||0)/Math.max(1,sum("damageTaken"))/.2),contribution=hofClamp(kp*.45+efficiency*.35+vision*.2),chaos=(deathBurden*.4+(1-kp)*.25+(1-efficiency)*.15+(1-vision)*.1+exposure*.1)*100,safety=((1-deathBurden)*.45+kp*.2+efficiency*.15+vision*.1+(1-hofClamp((Number(mp.deaths)||0)/8))*.1)*100*(.55+contribution*.45);return {chaos,safety}}
const discordHallCategoryOptions=[{name:"오브젝트 학살자",value:"objective"},{name:"스틸의 신",value:"steal"},{name:"철벽",value:"wall"},{name:"맵의 지배자",value:"vision"},{name:"구원의 손",value:"support"},{name:"움직임 봉쇄",value:"cc"},{name:"가성비의 제왕",value:"efficiency"},{name:"철거반장",value:"demolition"},{name:"돌발행동 장인",value:"chaos"},{name:"안전제일 콘돔장인",value:"safety"},{name:"주사위 6도란",value:"soloKills"},{name:"주사위 1도란",value:"soloDeaths"}];
function discordHallOfFame(players,matches){
  const active=players.filter(player=>!player.archived),findPlayer=mp=>active.find(player=>(player.playAliases||[]).some(alias=>alias.puuid===mp.puuid||hofIdentity(alias.gameName,alias.tagLine)===hofIdentity(mp.gameName,mp.tagLine)))||active.find(player=>player.puuid===mp.puuid)||active.find(player=>hofIdentity(player.name,String(player.tag||"").replace(/^#/,""))===hofIdentity(mp.gameName,mp.tagLine)),grouped=new Map(active.map(player=>[String(player.id),{player,games:[]}]))
  for(const match of matches)for(const mp of match.participants||[]){const player=findPlayer(mp);if(player)grouped.get(String(player.id))?.games.push({mp,match})}
  const rows=[...grouped.values()].map(({player,games})=>{const metricGames=games.filter(({mp})=>["objectiveDamage","damageTaken","mitigated","ccTime","wardsPlaced","wardsKilled","turretDamage"].some(key=>Number(mp[key])>0)),count=metricGames.length,minutes=Math.max(1,metricGames.reduce((total,item)=>total+(Number(item.match.duration)||0),0)/60),deaths=hofSum(metricGames,"deaths"),utility=metricGames.reduce((total,{mp})=>total+(Number(mp.healsOnTeammates)||0)+(Number(mp.shieldsOnTeammates)||0)+(Number(mp.unitsHealed)>1?Number(mp.healing)||0:0),0),behavior=metricGames.reduce((total,item)=>{const value=discordHofBehavior(item);return {chaos:total.chaos+value.chaos,safety:total.safety+value.safety}},{chaos:0,safety:0});return {name:player.name,games:count,objective:count?(hofSum(metricGames,"objectiveDamage")*.5+hofSum(metricGames,"turretDamage")*.3+(hofSum(metricGames,"turretKills")+hofSum(metricGames,"inhibitorKills"))*200)/count:0,steal:hofSum(metricGames,"objectivesStolen")+hofSum(metricGames,"objectivesStolenAssists")*.5,wall:count?(hofSum(metricGames,"damageTaken")+hofSum(metricGames,"mitigated")*.7)/minutes*Math.max(.55,1.15-deaths/count/20):0,vision:count?(hofSum(metricGames,"vision")+hofSum(metricGames,"wardsKilled")*5+hofSum(metricGames,"controlWards")*3)/minutes:0,support:count?utility/minutes:0,cc:count?(hofSum(metricGames,"ccTime")+hofSum(metricGames,"totalCcTime")*.25)/minutes:0,efficiency:count?hofSum(metricGames,"damage")/Math.max(1,hofSum(metricGames,"gold"))*1000:0,demolition:count?(hofSum(metricGames,"turretDamage")+hofSum(metricGames,"turretKills")*1500)/count:0,chaos:count?behavior.chaos/count:0,safety:count?behavior.safety/count:0,soloKills:hofSum(metricGames,"soloKills"),soloDeaths:hofSum(metricGames,"soloDeaths")}});
  const eligible=rows.filter(row=>row.games>=5),definitions=[
    ["☠ 오브젝트 학살자","objective",value=>Math.round(value).toLocaleString()],["◎ 스틸의 신","steal",value=>`${value.toFixed(1)}회`],["◆ 철벽","wall",value=>Math.round(value).toLocaleString()],["◉ 맵의 지배자","vision",value=>value.toFixed(1)],["♡ 구원의 손","support",value=>Math.round(value).toLocaleString()],["▣ 움직임 봉쇄","cc",value=>`${value.toFixed(1)}초`],["◇ 가성비의 제왕","efficiency",value=>Math.round(value).toLocaleString()],["⚒ 철거반장","demolition",value=>Math.round(value).toLocaleString()],["⚡ 돌발행동 장인","chaos",value=>`${value.toFixed(1)}점`],["♨ 안전제일 콘돔장인","safety",value=>`${value.toFixed(1)}점`],["⚔ 주사위 6도란","soloKills",value=>`${value}회`],["☠ 주사위 1도란","soloDeaths",value=>`${value}회`]
  ];
  return {eligible:eligible.length,fields:definitions.map(([name,key,format])=>{const ranked=eligible.filter(row=>row[key]>0).sort((a,b)=>b[key]-a[key]||b.games-a.games).slice(0,5);return {key,name,value:ranked.length?ranked.map((row,index)=>`${index+1}. **${discordSafe(row.name)}** · ${format(row[key])}`).join("\n"):"집계 기준을 충족한 기록이 없습니다."}})};
}
const normName=value=>String(value||"").normalize("NFKC").replace(/^@/,"").replace(/\s/g,"").toLowerCase();
function discordPlayerNames(player){
  return [player.name,`${player.name||""}${player.tag||""}`,player.nickname,player.alias,...(Array.isArray(player.nicknames)?player.nicknames:[]),...(Array.isArray(player.aliases)?player.aliases:[])].filter(Boolean);
}
function findDiscordPlayer(players,query){
  const needle=normName(query);if(!needle)return null;
  const searchable=players.filter(player=>!player.archived).map(player=>({player,names:discordPlayerNames(player).map(normName)}));
  const exact=searchable.filter(entry=>entry.names.includes(needle));if(exact.length===1)return exact[0].player;if(exact.length>1)return null;
  const partial=searchable.filter(entry=>entry.names.some(name=>needle.length>=2&&name.length>=2&&(name.includes(needle)||needle.includes(name))));
  return partial.length===1?partial[0].player:null;
}
const findRegisteredRiotAccount=(players,data)=>players.find(player=>!player.archived&&(player.puuid===data.puuid||normName(`${player.name||""}${player.tag||""}`)===normName(`${data.gameName||""}#${data.tagLine||""}`)));
const discordDisplayName=interaction=>String(interaction.member?.nick||interaction.member?.user?.global_name||interaction.user?.global_name||interaction.member?.user?.username||interaction.user?.username||"Discord 사용자").trim();
const discordUserId=interaction=>String(interaction.member?.user?.id||interaction.user?.id||"");
function upsertDiscordPlayer(state,data,alias){
  const players=Array.isArray(state.players)?state.players:(state.players=[]),existing=players.find(player=>player.puuid===data.puuid),nextId=players.length?Math.max(0,...players.map(player=>Number(player.id)||0))+1:1,id=existing?.id||nextId;
  const player={...(existing||{}),id,name:data.gameName,tag:`#${data.tagLine}`,tier:data.tier,division:data.division,lp:data.lp,soloWins:Number(data.wins)||0,soloLosses:Number(data.losses)||0,soloRefreshedAt:Date.now(),role:data.role,secondary:data.secondary,form:data.form,color:existing?.color||"#4f7df3",selected:existing?.selected||false,archived:false,most:data.most,dataDragonVersion:data.dataDragonVersion,recentWinRate:data.recentWinRate,recentGames:data.recentGames,puuid:data.puuid};
  const aliasKey=normName(alias);for(const other of players)if(other!==existing&&Array.isArray(other.nicknames))other.nicknames=other.nicknames.filter(name=>normName(name)!==aliasKey);
  player.nicknames=Array.isArray(existing?.nicknames)?[...existing.nicknames]:[];if(alias&&!discordPlayerNames(player).map(normName).includes(aliasKey))player.nicknames.push(alias);
  if(existing)Object.assign(existing,player);else players.push(player);return {player,updated:Boolean(existing)};
}
function nextKstStart(period,hour,minute){const now=new Date(),parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now).filter(part=>part.type!=="literal").map(part=>[part.type,Number(part.value)])),hour24=(Number(hour)%12)+(period==="오후"?12:0);let target=Date.UTC(parts.year,parts.month-1,parts.day,hour24-9,Number(minute)||0,0);if(target<=now.getTime())target+=86_400_000;return Math.floor(target/1000)}
function recruitmentPayload(recruitment){
  const members=recruitment.participants||[],full=members.length>=10,lines=members.map((member,index)=>`${index+1}. **${discordSafe(member.discordName)}**${member.playerName?` → ${discordSafe(member.playerName)}`:" · ⚠️ 플레이어 미연결"}`).join("\n")||"아직 참가 신청자가 없습니다.";
  const clock=recruitment.startAt?`<t:${recruitment.startAt}:F>`:discordSafe(recruitment.startTime),countdown=recruitment.startAt?`⏱️ **<t:${recruitment.startAt}:R> 시작**\n`:"";
  return {content:`🎮 **${discordSafe(recruitment.startTime)} 내전 참가 모집**`,embeds:[{title:`선착순 참가 신청 · ${members.length}/10명`,description:`${countdown}시작 시각 ${clock}\n\n${lines}\n\n${full?"✅ 참가 인원이 확정됐습니다.":"아래 버튼을 눌러 참가하거나 취소할 수 있습니다."}`,color:full?5763719:3447003,url:publicAppUrl,fields:[{name:"시작 시간",value:clock,inline:true},{name:"남은 시간",value:recruitment.startAt?`<t:${recruitment.startAt}:R>`:"-",inline:true}],footer:{text:`ck-recruitment:${recruitment.id}:${recruitment.startAt||0}`}}],components:[{type:1,components:[{type:2,style:3,label:full?"참가 마감":"참가 신청",custom_id:`ck_join:${recruitment.id}`,disabled:full},{type:2,style:2,label:"참가 취소",custom_id:`ck_leave:${recruitment.id}`}]}]};
}
function cancelledRecruitmentPayload(recruitment){return {content:"🛑 **내전 참가 모집이 취소됐습니다.**",embeds:[{title:"모집 취소",description:`${discordSafe(recruitment.startTime||"예정된")} 내전 참가 신청이 방장에 의해 종료됐습니다.`,color:10038562,url:publicAppUrl}],components:[{type:1,components:[{type:2,style:2,label:"취소된 모집",custom_id:`ck_join:${recruitment.id}`,disabled:true}]}]}}
async function handlePlayerRegistrationComponent(interaction){
  const [action,userId]=String(interaction.data?.custom_id||"").split(":"),clickerId=discordUserId(interaction);
  if(!userId||userId!==clickerId)return discordReply("이 등록 요청은 명령어를 실행한 본인만 확인할 수 있습니다.");
  const state=await loadAppState(),pending=state.discordPlayerRegistrations?.[userId];
  if(!pending)return {type:7,data:{content:"만료되었거나 이미 처리된 등록 요청입니다.",embeds:[],components:[]}};
  delete state.discordPlayerRegistrations[userId];
  if(action==="ck_player_cancel"){state.updatedAt=Date.now();await saveAppState(state);return {type:7,data:{content:`❌ **${discordSafe(pending.data.gameName)}#${discordSafe(pending.data.tagLine)}** 등록을 취소했습니다.`,embeds:[],components:[]}}}
  if(action!=="ck_player_confirm")return discordReply("지원하지 않는 등록 요청입니다.");
  const duplicate=findRegisteredRiotAccount(state.players||[],pending.data);if(duplicate){state.updatedAt=Date.now();await saveAppState(state);return {type:7,data:{content:`⚠️ **${discordSafe(duplicate.name)}${discordSafe(duplicate.tag)}** 계정은 이미 등록되어 있어 변경하지 않았습니다.`,embeds:[],components:[]}}}
  const {player,updated}=upsertDiscordPlayer(state,pending.data,pending.alias);state.updatedAt=Date.now();await saveAppState(state);
  return {type:7,data:{content:`✅ **${discordSafe(player.name)}${discordSafe(player.tag)}** ${updated?"정보 갱신":"플레이어 등록"} 완료`,embeds:[{title:updated?"플레이어 정보 갱신 완료":"플레이어 등록 완료",description:`Discord 별칭 · **${discordSafe(pending.alias)}**\n현재 티어 · ${discordTierKo[player.tier]||player.tier}${discordDivisionNumber[player.division]||""}\n주/부 포지션 · ${roleKo[player.role]||player.role} / ${roleKo[player.secondary]||player.secondary}\n초기 롤력 · **${discordPlayerPower(player).toLocaleString()}**`,color:5814783,url:publicAppUrl}],components:[]}};
}
async function handleRecruitmentComponent(interaction){
  const [action,id]=String(interaction.data?.custom_id||"").split(":"),state=await loadAppState();let recruitment=state.discordRecruitment;
  if((state.discordCancelledRecruitmentIds||[]).includes(id))return {type:7,data:cancelledRecruitmentPayload({id,startTime:"해당",participants:[],cancelled:true})};
  if(recruitment&&String(recruitment.id)!==id)return discordReply("새 모집으로 교체되어 종료된 참가 신청입니다.");
  if(!recruitment){const embed=interaction.message?.embeds?.[0],footer=String(embed?.footer?.text||""),startAt=Number(footer.split(":")[2])||0,startTime=startAt?new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",hour:"numeric",minute:"2-digit",hour12:true}).format(new Date(startAt*1000)):embed?.fields?.find(field=>field.name==="시작 시간")?.value;if(!startTime)return discordReply("종료되었거나 새 모집으로 교체된 참가 신청입니다.");recruitment={id,startTime,startAt,participants:[],createdAt:Date.now(),updatedAt:Date.now()};(state.players||[]).forEach(player=>{player.selected=false})}
  if(recruitment.cancelled)return {type:7,data:cancelledRecruitmentPayload(recruitment)};
  const userId=discordUserId(interaction),discordName=discordDisplayName(interaction),participants=Array.isArray(recruitment.participants)?recruitment.participants:[];
  if(action==="ck_leave"){
    const index=participants.findIndex(member=>member.discordId===userId);if(index<0)return discordReply("현재 참가 명단에 없습니다.");
    const [removed]=participants.splice(index,1),player=state.players.find(item=>String(item.id)===String(removed.playerId));if(player)player.selected=false;
  }else if(action==="ck_join"){
    if(participants.some(member=>member.discordId===userId))return discordReply("이미 참가 신청이 완료됐습니다.");
    if(participants.length>=10)return discordReply("선착순 10명이 모두 확정됐습니다.");
    const candidates=[interaction.member?.nick,interaction.member?.user?.global_name,interaction.member?.user?.username,interaction.user?.global_name,interaction.user?.username].filter(Boolean),player=candidates.map(name=>findDiscordPlayer(state.players||[],name)).find(Boolean);
    if(player){player.selected=true;player.nicknames=Array.isArray(player.nicknames)?player.nicknames:[];if(discordName&&!discordPlayerNames(player).map(normName).includes(normName(discordName)))player.nicknames.push(discordName)}
    participants.push({discordId:userId,discordName,playerId:player?.id||null,playerName:player?.name||"",joinedAt:Date.now()});
  }else return discordReply("지원하지 않는 참가 신청입니다.");
  recruitment.participants=participants;recruitment.updatedAt=Date.now();state.discordRecruitment=recruitment;state.updatedAt=Date.now();await saveAppState(state);
  return {type:7,data:recruitmentPayload(recruitment)};
}
function discordTeamLines(series,side){return (side==="BLUE"?series.blue:series.red).map(player=>`${roleKo[player.role]||player.role} · ${player.name} · ${Math.round(Number(player.power)||0).toLocaleString()}`).join("\n").slice(0,1024)}
async function handleDiscordInteraction(interaction){
  if(interaction.type===1)return {type:1};
  if(interaction.type===3)return String(interaction.data?.custom_id||"").startsWith("ck_player_")?handlePlayerRegistrationComponent(interaction):handleRecruitmentComponent(interaction);
  if(interaction.type!==2)return discordReply("지원하지 않는 요청입니다.");
  const command=interaction.data?.name;
  if(command==="내전"){
    const period=String(optionValue(interaction,"오전오후")||""),hour=Number(optionValue(interaction,"시간")),minute=Number(optionValue(interaction,"분")||0);if(!["오전","오후"].includes(period)||hour<1||hour>12||minute<0||minute>59)return discordReply("오전/오후와 시작 시간을 올바르게 선택해주세요.");
    const startAt=nextKstStart(period,hour,minute),startTime=`${period} ${hour}:${String(minute).padStart(2,"0")}`,recruitment={id:`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,startTime,startAt,participants:[],createdAt:Date.now(),updatedAt:Date.now()};waitUntil((async()=>{const state=await loadAppState();(state.players||[]).forEach(player=>{player.selected=false});await saveAppState({...state,discordRecruitment:recruitment,updatedAt:Date.now()})})());return {type:4,data:recruitmentPayload(recruitment)};
  }
  const state=await loadAppState(),players=Array.isArray(state.players)?state.players:[],seriesState=state.seriesState||{active:null,history:[]};
  if(command==="플레이어등록"){
    if(String(interaction.channel_id)!==discordPlayerRegistrationChannelId)return discordReply("이 명령어는 **#롤-플레이어등록** 채널에서만 사용할 수 있습니다.");
    const gameName=String(optionValue(interaction,"롤닉네임")||"").trim(),tagLine=String(optionValue(interaction,"태그")||"").trim().replace(/^#/,"");
    if(!gameName||!tagLine)return discordReply("롤 닉네임과 태그를 모두 입력해주세요.");
    const alias=discordDisplayName(interaction),data=await getPlayerData(`${gameName}#${tagLine}`,5),duplicate=findRegisteredRiotAccount(players,data);if(duplicate)return discordReply(`⚠️ **${discordSafe(duplicate.name)}${discordSafe(duplicate.tag)}** 계정은 이미 플레이어 목록에 등록되어 있습니다. 기존 정보는 변경하지 않았습니다.`);
    const userId=discordUserId(interaction),tierLabel=`${discordTierKo[data.tier]||data.tier}${discordDivisionNumber[data.division]||""}`;
    state.discordPlayerRegistrations=state.discordPlayerRegistrations&&typeof state.discordPlayerRegistrations==="object"?state.discordPlayerRegistrations:{};state.discordPlayerRegistrations[userId]={data,alias,createdAt:Date.now()};state.updatedAt=Date.now();await saveAppState(state);
    return {type:4,data:{content:`**${discordSafe(data.gameName)}#${discordSafe(data.tagLine)} ${discordSafe(tierLabel)}**가 맞습니까?`,embeds:[{title:"플레이어 정보 확인",description:`롤 닉네임 · **${discordSafe(data.gameName)}**\n태그 · **#${discordSafe(data.tagLine)}**\n현재 티어 · **${discordSafe(tierLabel)}**\n등록할 Discord 별칭 · **${discordSafe(alias)}**\n\n정보가 맞다면 아래 버튼을 눌러주세요.`,color:15844367}],components:[{type:1,components:[{type:2,style:3,label:"맞습니다 · 등록",custom_id:`ck_player_confirm:${userId}`},{type:2,style:4,label:"아닙니다 · 취소",custom_id:`ck_player_cancel:${userId}`}]}]}};
  }
  if(command==="내전취소"){const rawId=String(optionValue(interaction,"모집id")||"").trim(),targetId=(rawId.match(/ck-recruitment:([^:]+)/)?.[1]||rawId).trim(),recruitment=state.discordRecruitment;if(!targetId&&(!recruitment||recruitment.cancelled))return discordReply("현재 활성화된 내전 참가 모집이 없습니다.");if(targetId&&recruitment&&String(recruitment.id)!==targetId){state.discordCancelledRecruitmentIds=[...new Set([...(state.discordCancelledRecruitmentIds||[]),targetId])].slice(-50);state.updatedAt=Date.now();await saveAppState(state);return discordReply(`모집 ID **${discordSafe(targetId)}**를 취소 목록에 등록했습니다. 해당 모집 버튼은 더 이상 참가를 받지 않습니다.`)}const cancelled=recruitment||{id:targetId,startTime:"해당",participants:[]};for(const member of cancelled.participants||[]){const player=players.find(item=>String(item.id)===String(member.playerId));if(player)player.selected=false}state.discordCancelledRecruitmentIds=[...new Set([...(state.discordCancelledRecruitmentIds||[]),cancelled.id])].slice(-50);state.discordRecruitment=null;state.updatedAt=Date.now();await saveAppState(state);return {type:4,data:cancelledRecruitmentPayload(cancelled)}}
  if(command==="내전모집")return {type:4,data:{content:"🎮 **응CK 내전 참가자를 모집합니다!**",embeds:[{title:"내전 참가 신청",description:"아래 버튼을 눌러 응CK 연구소에서 참가자를 선택해주세요. 10명이 확정되면 팀 대안과 예상 승률을 만들 수 있습니다.",color:3447003}],components:[{type:1,components:[{type:2,style:5,label:"참가자 선택하기",url:publicAppUrl}]}]}};
  if(command==="참가자"){const selected=players.filter(player=>player.selected);return discordReply(selected.length?`**현재 선택 ${selected.length}/10명**\n${selected.map((player,index)=>`${index+1}. ${player.name} · 롤력 ${discordPlayerPower(player).toLocaleString()}`).join("\n")}`:"현재 선택된 참가자가 없습니다.")}
  if(command==="현재내전"){const series=seriesState.active;if(!series)return discordReply("현재 진행 중인 내전이 없습니다.");const score=scoreOf(series);return {type:4,data:{embeds:[{title:`${seriesTeamName(series,"BLUE")} ${score.blue} : ${score.red} ${seriesTeamName(series,"RED")}`,color:3447003,fields:[{name:`🔵 ${seriesTeamName(series,"BLUE")}`,value:discordTeamLines(series,"BLUE"),inline:true},{name:`🔴 ${seriesTeamName(series,"RED")}`,value:discordTeamLines(series,"RED"),inline:true}],url:publicAppUrl}],components:[{type:1,components:[{type:2,style:5,label:"응CK 연구소 열기",url:publicAppUrl}]}]}}
  }
  if(command==="롤력"){const query=optionValue(interaction,"닉네임"),player=findDiscordPlayer(players,query);if(!player)return discordReply(`'${query}'와 정확히 일치하는 플레이어 또는 별칭을 찾지 못했습니다.`);const aliasMatched=!discordPlayerNames(player).slice(0,2).map(normName).includes(normName(query));return {type:4,data:{embeds:[{title:`${player.name}${player.tag||""}`,description:`${aliasMatched?`별칭 **${query}**으로 연결\n`:""}롤력 **${discordPlayerPower(player).toLocaleString()}**\n내전 ${Number(player.internalGames)||0}경기 · KDA ${Number(player.internalKda||0).toFixed(2)}\n주 포지션 ${roleKo[player.role]||player.role} · 부 포지션 ${roleKo[player.secondary]||player.secondary}`,color:5814783,url:publicAppUrl}]}}
  }
  if(command==="리더보드"){const ranked=[...players].filter(player=>!player.archived).sort((a,b)=>discordPlayerPower(b)-discordPlayerPower(a)).slice(0,10);return {type:4,data:{embeds:[{title:"🏆 응CK 롤력 리더보드",description:ranked.map((player,index)=>`${index+1}. **${player.name}** · ${discordPlayerPower(player).toLocaleString()} (${Number(player.internalGames)||0}경기)`).join("\n")||"집계 데이터가 없습니다.",color:15844367,url:publicAppUrl}]}}
  }
  if(command==="명예의전당"){const category=String(optionValue(interaction,"부문")||""),hall=discordHallOfFame(players,await loadMatches()),selected=hall.fields.find(field=>field.key===category);if(!selected)return discordReply("보고 싶은 명예의전당 부문을 다시 선택해주세요.");return {type:4,data:{embeds:[{title:`🏛️ ${selected.name}`,description:`${selected.value}\n\n확장 지표가 있는 내전 5경기 이상 · 대상 ${hall.eligible}명`,color:15844367,url:`${publicAppUrl}#leaderboard`}]}}
  }
  if(command==="최근결과"){const series=[...(seriesState.history||[])].filter(item=>item.finished).sort((a,b)=>(Number(b.finishedAt)||0)-(Number(a.finishedAt)||0))[0];if(!series)return discordReply("완료된 내전 시리즈가 없습니다.");const score=scoreOf(series),pog=[...(series.blue||[]),...(series.red||[])].find(player=>String(player.id)===String(series.pogId));return {type:4,data:{embeds:[{title:"최근 내전 결과",description:`**${seriesTeamName(series,"BLUE")} ${score.blue} : ${score.red} ${seriesTeamName(series,"RED")}**\n승리 · ${seriesTeamName(series,series.finalWinner)}\n🏅 POG · ${pog?.name||"-"} (${Number(series.pogScore||0).toFixed(1)}점)`,color:15844367,url:publicAppUrl}]}}
  }
  return discordReply("알 수 없는 명령어입니다.");
}
async function finishDeferredDiscordInteraction(interaction){
  try{
    const result=await handleDiscordInteraction(interaction),data=result?.data||{content:"처리가 완료됐습니다."},base=`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID||interaction.application_id}/${interaction.token}`;
    delete data.flags;const response=await fetch(`${base}/messages/@original`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    if(!response.ok)console.error("Discord deferred response failed",response.status,(await response.text()).slice(0,300));
  }catch(error){
    console.error("Discord deferred interaction failed",error);
    try{const base=`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID||interaction.application_id}/${interaction.token}`,response=await fetch(`${base}/messages/@original`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:`처리에 실패했습니다 · ${String(error?.message||"서버 오류가 발생했습니다.").slice(0,300)}`,embeds:[],components:[]})});if(!response.ok)console.error("Discord deferred error response failed",response.status)}catch(responseError){console.error("Discord deferred error response exception",responseError)}
  }
}
const requireUploaderAuth=req=>{if(!uploadToken)throw Object.assign(new Error("서버에 UPLOADER_TOKEN이 설정되지 않았습니다."),{status:503});if(String(req.headers.authorization||"")!==`Bearer ${uploadToken}`)throw Object.assign(new Error("업로더 인증키가 올바르지 않습니다."),{status:401})};
function validateMatch(match){
  if(!match || !/^\d{6,12}$/.test(String(match.gameId||""))) throw Object.assign(new Error("올바른 게임 ID가 아닙니다."),{status:400});
  if(!Array.isArray(match.participants) || match.participants.length!==10) throw Object.assign(new Error("참가자 10명의 경기 데이터가 필요합니다."),{status:400});
  const roles=new Set(["TOP","JUNGLE","MID","ADC","SUPPORT"]);
  const participants=match.participants.map(p=>({ puuid:String(p.puuid||""), gameName:String(p.gameName||"").slice(0,40), tagLine:String(p.tagLine||"").slice(0,12), teamId:Number(p.teamId), win:Boolean(p.win), role:roles.has(p.role)?p.role:"MID", championId:Number(p.championId)||null, championKey:String(p.championKey||"").replace(/[^A-Za-z0-9]/g,"").slice(0,30), championName:String(p.championName||"Unknown").slice(0,40), kills:Number(p.kills)||0, deaths:Number(p.deaths)||0, assists:Number(p.assists)||0, damage:Number(p.damage)||0, gold:Number(p.gold)||0, vision:Number(p.vision)||0, cs:Number(p.cs)||0, damageTaken:Number(p.damageTaken)||0, mitigated:Number(p.mitigated)||0, turretDamage:Number(p.turretDamage)||0, objectiveDamage:Number(p.objectiveDamage)||0, healing:Number(p.healing)||0, unitsHealed:Number(p.unitsHealed)||0, healsOnTeammates:Number(p.healsOnTeammates)||0, shieldsOnTeammates:Number(p.shieldsOnTeammates)||0, ccTime:Number(p.ccTime)||0, totalCcTime:Number(p.totalCcTime)||0, wardsPlaced:Number(p.wardsPlaced)||0, wardsKilled:Number(p.wardsKilled)||0, controlWards:Number(p.controlWards)||0, turretKills:Number(p.turretKills)||0, inhibitorKills:Number(p.inhibitorKills)||0, objectivesStolen:Number(p.objectivesStolen)||0, objectivesStolenAssists:Number(p.objectivesStolenAssists)||0, soloKills:Number(p.soloKills)||0, soloDeaths:Number(p.soloDeaths)||0 }));
  if(participants.some(p=>![100,200].includes(p.teamId)||!p.gameName)) throw Object.assign(new Error("참가자 데이터 형식이 올바르지 않습니다."),{status:400});
  return { gameId:String(match.gameId), gameCreation:Number(match.gameCreation)||Date.now(), duration:Number(match.duration)||0, gameMode:String(match.gameMode||"CUSTOM"), gameType:String(match.gameType||"CUSTOM_GAME"), queueId:Number(match.queueId)||0, participants, uploadedAt:Date.now() };
}
const riotFetch = async (url,key) => { for(let attempt=0;attempt<3;attempt++){ const response=await fetch(url,{headers:{"X-Riot-Token":key}}); if(response.ok)return response.json(); if(response.status===429&&attempt<2){await wait((Number(response.headers.get("retry-after"))||1.2)*1000);continue} const error=new Error(response.status===404?"플레이어 또는 전적을 찾을 수 없습니다.":response.status===401||response.status===403?"Riot API 키가 만료되었거나 올바르지 않습니다.":response.status===429?"API 호출 한도를 초과했습니다.":"Riot API 요청에 실패했습니다."); error.status=response.status; error.details=await response.text(); throw error; } };
const riotParticipantExtras=p=>({damageTaken:Number(p.totalDamageTaken)||0,mitigated:Number(p.damageSelfMitigated)||0,turretDamage:Number(p.damageDealtToTurrets)||0,objectiveDamage:Number(p.damageDealtToObjectives)||0,healing:Number(p.totalHeal)||0,unitsHealed:Number(p.totalUnitsHealed)||0,ccTime:Number(p.timeCCingOthers)||0,totalCcTime:Number(p.totalTimeCCDealt)||0,wardsPlaced:Number(p.wardsPlaced)||0,wardsKilled:Number(p.wardsKilled)||0,controlWards:Number(p.detectorWardsPlaced??p.visionWardsBoughtInGame)||0,turretKills:Number(p.turretKills)||0,inhibitorKills:Number(p.inhibitorKills)||0,healsOnTeammates:Number(p.totalHealsOnTeammates)||0,shieldsOnTeammates:Number(p.totalDamageShieldedOnTeammates)||0,objectivesStolen:Number(p.objectivesStolen)||0,objectivesStolenAssists:Number(p.objectivesStolenAssists)||0});
async function enrichRecentMatches(requestedCount){
  const riotApiKey=process.env.RIOT_API_KEY||(await loadRuntimeConfig()).riotApiKey;if(!riotApiKey)throw Object.assign(new Error("서버에 Riot API 키가 설정되지 않았습니다."),{status:503});
  const matches=await loadMatches(),targets=[...matches].sort((a,b)=>(Number(b.gameCreation)||0)-(Number(a.gameCreation)||0)).slice(0,Math.max(1,Math.min(30,Number(requestedCount)||15)));let enriched=0,failed=[];
  for(const match of targets){try{const raw=await riotFetch(`https://asia.api.riotgames.com/lol/match/v5/matches/KR_${encodeURIComponent(match.gameId)}`,riotApiKey);for(const participant of match.participants){const source=(raw.info?.participants||[]).find(p=>p.puuid&&p.puuid===participant.puuid)||(raw.info?.participants||[]).find(p=>normName(`${p.riotIdGameName||p.gameName||p.summonerName}#${p.riotIdTagline||p.tagLine||""}`)===normName(`${participant.gameName}#${participant.tagLine}`));if(source)Object.assign(participant,riotParticipantExtras(source))}match.enrichedAt=Date.now();enriched++}catch(error){failed.push({gameId:match.gameId,error:error.message})}await wait(80)}
  if(enriched)await saveMatches(matches);return {ok:true,requested:targets.length,enriched,failed};
}
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
    if(pathname==="/api/discord/interactions"&&req.method==="POST"){
      const raw=req.body!==undefined?Buffer.from(Buffer.isBuffer(req.body)?req.body:typeof req.body==="string"?req.body:JSON.stringify(req.body)):await readRawBody(req);if(!await verifyDiscordRequest(req,raw))return json(res,401,{error:"invalid request signature"});
      let interaction;try{interaction=JSON.parse(raw.toString("utf8"))}catch{throw Object.assign(new Error("올바른 Discord 요청이 아닙니다."),{status:400})}
      const deferredCommand=interaction.type===2&&["내전취소","플레이어등록"].includes(interaction.data?.name),deferredComponent=interaction.type===3&&/^ck_(join|leave|player_confirm|player_cancel):/.test(String(interaction.data?.custom_id||""));
      if(deferredCommand||deferredComponent){json(res,200,{type:deferredComponent?6:5});waitUntil(finishDeferredDiscordInteraction(interaction));return}
      return json(res,200,await handleDiscordInteraction(interaction));
    }
    if(pathname==="/api/health")return json(res,200,{ok:true,uploaderAuth:Boolean(uploadToken),serverStorage:process.env.BLOB_READ_WRITE_TOKEN?"vercel-blob":"local-file"});
    if(pathname==="/api/discord/register-hall-of-fame"&&req.method==="POST"){requireUploaderAuth(req);return json(res,200,await registerDiscordHallOfFameCommand())}
    if(pathname==="/api/discord/cancel-recruitment"&&req.method==="POST"){requireUploaderAuth(req);const body=await readBody(req),rawId=String(body.recruitmentId||"").trim(),targetId=(rawId.match(/ck-recruitment:([^:]+)/)?.[1]||rawId).trim();if(!targetId)throw Object.assign(new Error("모집 ID가 필요합니다."),{status:400});const state=await loadAppState(),active=state.discordRecruitment;if(active&&String(active.id)===targetId){for(const member of active.participants||[]){const player=(state.players||[]).find(item=>String(item.id)===String(member.playerId));if(player)player.selected=false}state.discordRecruitment=null}state.discordCancelledRecruitmentIds=[...new Set([...(state.discordCancelledRecruitmentIds||[]),targetId])].slice(-50);state.updatedAt=Date.now();await saveAppState(state);return json(res,200,{ok:true,recruitmentId:targetId,removedActive:Boolean(active&&String(active.id)===targetId)})}
    if(pathname==="/api/player")return json(res,200,await getPlayerData(url.searchParams.get("riotId")||"",url.searchParams.get("matches")));
    if(pathname==="/api/internal-matches"&&req.method==="GET")return json(res,200,await loadMatches());
    if(pathname==="/api/app-state"&&req.method==="GET")return json(res,200,await loadAppState());
    if(pathname==="/api/app-state"&&(req.method==="POST"||req.method==="PUT")){
      const body=await readBody(req),players=Array.isArray(body.players)?body.players.slice(0,200):[],seriesState=body.seriesState&&typeof body.seriesState==="object"?body.seriesState:{active:null,history:[]};
      const previous=await loadAppState(),state={version:1,players,seriesState,ladderChoice:body.ladderChoice||null,discordRecruitment:previous.discordRecruitment||null,discordCancelledRecruitmentIds:previous.discordCancelledRecruitmentIds||[],discordPlayerRegistrations:previous.discordPlayerRegistrations||{},updatedAt:Date.now()};await saveAppState(state);await notifySeriesChanges(previous,state);return json(res,200,{ok:true,updatedAt:state.updatedAt});
    }
    if(pathname==="/api/internal-match"&&req.method==="GET"){const match=(await loadMatches()).find(m=>m.gameId===url.searchParams.get("id"));if(!match)throw Object.assign(new Error("서버에 없는 경기입니다. 방장 PC의 응CK 업로더로 먼저 전송해주세요."),{status:404});return json(res,200,match)}
    if(pathname==="/api/internal-matches/enrich"&&req.method==="POST"){requireUploaderAuth(req);const body=await readBody(req);return json(res,200,await enrichRecentMatches(body.count))}
    if(pathname==="/api/uploader/riot-key"&&req.method==="POST"){
      requireUploaderAuth(req);const body=await readBody(req),riotApiKey=String(body.riotApiKey||"").trim();if(!/^RGAPI-[A-Za-z0-9-]{20,}$/.test(riotApiKey))throw Object.assign(new Error("올바른 Riot API 키 형식이 아닙니다."),{status:400});const config=await loadRuntimeConfig();config.riotApiKey=riotApiKey;config.updatedAt=Date.now();await saveRuntimeConfig(config);return json(res,200,{ok:true,configured:true});
    }
    if(pathname==="/api/internal-matches/upload"&&req.method==="POST"){
      requireUploaderAuth(req);
      const match=validateMatch(await readBody(req)),matches=await loadMatches(),index=matches.findIndex(m=>m.gameId===match.gameId);if(index>=0)matches[index]=match;else matches.push(match);await saveMatches(matches);return json(res,index>=0?200:201,{ok:true,replaced:index>=0,gameId:match.gameId,total:matches.length});
    }
    const file=pathname==="/"?"index.html":pathname.slice(1),data=staticAssets[file];if(data===undefined){res.writeHead(404).end("Not Found");return}res.writeHead(200,{"Content-Type":types[extname(file)]||"application/octet-stream","Cache-Control":"no-store"});res.end(data);
  }catch(error){console.error(error.details||error);json(res,error.status||500,{error:error.message||"서버 오류가 발생했습니다."})}
}

if(!process.env.VERCEL)createServer(handleRequest).listen(port,host,()=>console.log(`응CK연구소: http://${host}:${port}`));
