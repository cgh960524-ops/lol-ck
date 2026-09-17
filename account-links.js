// Account identity only: alternate accounts must never replace solo-rank evidence.
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const identity=(name,tag)=>`${name||''}#${String(tag||'').replace(/^#/,'')}`.replace(/\s/g,'').toLowerCase();
export function parseRiotId(value){
  const parts=String(value||'').trim().split('#');
  if(parts.length!==2||!parts[0].trim()||!parts[1].trim()||parts[0].length>64||parts[1].length>32)fail('아이디#태그 형식으로 입력해주세요.');
  return {gameName:parts[0].trim(),tagLine:parts[1].trim()};
}
export function sameAccount(a,b){
  return Boolean(a.puuid&&b.puuid&&a.puuid===b.puuid)||Boolean(a.gameName&&a.tagLine&&b.gameName&&b.tagLine&&identity(a.gameName,a.tagLine)===identity(b.gameName,b.tagLine));
}
export function accountOwner(players,playerId){
  const main=players.find(p=>!p.archived&&String(p.id)===String(playerId));
  if(!main)fail('등록된 플레이어를 찾을 수 없습니다.',404);
  return main;
}
export function linkAccount(players,playerId,resolved){
  const main=accountOwner(players,playerId);
  if(!resolved?.puuid||!resolved.gameName||!resolved.tagLine)fail('계정 정보를 확인하지 못했습니다.',502);
  const account={puuid:resolved.puuid,gameName:resolved.gameName,tagLine:resolved.tagLine};
  for(const p of players.filter(p=>!p.archived)){
    if(sameAccount(account,{puuid:p.puuid,gameName:p.name,tagLine:String(p.tag||'').replace(/^#/,'')}))
      fail(p===main?'이미 솔로랭크 기준 본계정입니다.':`${p.name}의 본계정으로 등록되어 있어 연결할 수 없습니다.`,409);
    if(p!==main&&(p.playAliases||[]).some(a=>sameAccount(a,account)))fail(`${p.name}에게 이미 연결된 계정입니다.`,409);
  }
  const aliases=main.playAliases||[],index=aliases.findIndex(a=>sameAccount(a,account));
  main.playAliases=index<0?[...aliases,account]:aliases.map((a,i)=>i===index?account:a);
  return main;
}
export function unlinkAccount(players,playerId,puuid){
  const main=accountOwner(players,playerId);
  if(!puuid)fail('해제할 계정 정보가 필요합니다.');
  main.playAliases=(main.playAliases||[]).filter(a=>a.puuid!==puuid);
  return main;
}
