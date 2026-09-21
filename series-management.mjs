import {randomUUID} from 'node:crypto';
export const SERIES_ROLES=['TOP','JUNGLE','MID','ADC','SUPPORT'];
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
export function seriesCopies(seriesState,reference){const id=String(reference||'');return [...(seriesState?.history||[]),...(seriesState?.active?[seriesState.active]:[])].filter(series=>String(series.id)===id||String(series.seriesNumber)===id)}
export function validateSeriesRoles(series,overrides){
 if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))fail('포지션 배치가 올바르지 않습니다.');
 const members=[...(series.blue||[]),...(series.red||[])],ids=members.map(member=>String(member.id));
 if(members.length!==10||new Set(ids).size!==10||Object.keys(overrides).length!==10||Object.keys(overrides).some(id=>!ids.includes(id)))fail('참가자 10명의 포지션을 모두 지정해주세요.');
 for(const team of [series.blue,series.red])if(!same([...team.map(member=>overrides[String(member.id)])].sort(),[...SERIES_ROLES].sort()))fail('각 팀에는 포지션별로 한 명씩 배치해야 합니다.');
 return Object.fromEntries(ids.map(id=>[id,overrides[id]]));
}
const entries=state=>[...(state?.history||[]),...(state?.active?[state.active]:[])];
const roster=series=>[...(series.blue||[]).map(member=>['BLUE',String(member.id),member.role]),...(series.red||[]).map(member=>['RED',String(member.id),member.role])].sort((a,b)=>a[1].localeCompare(b[1]));
export function assertNoUntrackedSeriesManagement(previous,next){
 const old=previous||{},incoming=next||{},before=entries(old),after=entries(incoming),deleted=new Set(old.deletedSeriesNumbers||[]);
 for(const item of after){if(deleted.has(String(item.seriesNumber||'')))fail('삭제된 시리즈 번호는 재사용할 수 없습니다.',409)}
 for(const item of before){const matches=after.filter(candidate=>String(candidate.id)===String(item.id));if(!matches.length)fail('시리즈 삭제는 Discord 로그인 후 전용 기능으로 진행해주세요.',403);
  for(const candidate of matches){if(!same(roster(item),roster(candidate)))fail('시리즈 팀 배치는 전용 편집 기능으로만 수정할 수 있습니다.',403);
   for(const set of candidate.sets||[])if(!(item.sets||[]).some(oldSet=>Number(oldSet.number)===Number(set.number))&&Object.keys(set.roleOverrides||{}).length)fail('새 세트의 포지션 지정은 로그인 후 진행해주세요.',403);
   for(const set of item.sets||[]){const current=(candidate.sets||[]).find(value=>Number(value.number)===Number(set.number));if(!current)fail('기존 세트는 삭제할 수 없습니다.',403);
    if(!same(set.roleOverrides||{},current.roleOverrides||{}))fail('세트 포지션 편집은 Discord 로그인 후 진행해주세요.',403);
    if(set.imported&&!same([set.gameId,set.winner,set.imported],[current.gameId,current.winner,current.imported]))fail('기록된 세트는 임의로 변경할 수 없습니다.',403)
   }
  }
 }
 for(const item of after.filter(candidate=>!before.some(oldItem=>String(oldItem.id)===String(candidate.id))))for(const set of item.sets||[])if(Object.keys(set.roleOverrides||{}).length)fail('새 시리즈의 포지션 지정은 로그인 후 진행해주세요.',403);
}
export function seriesAuditEntry(actor,action,series,detail={}){return {id:randomUUID(),at:Date.now(),actor:{id:String(actor.id),name:String(actor.name)},action,seriesId:String(series.id),seriesNumber:String(series.seriesNumber||series.id),...detail}}
