// Team construction policy only. Does not change player ratings or preferences.
const CRITICAL=new Set(['JUNGLE','SUPPORT']);
const id=p=>String(p.id);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const isPreferred=(p,role)=>role===p.role||role===p.secondary;
export function preferenceWeights(pool,engine){
  const scores=pool.map(p=>engine.overallScore(p));
  // Relative to these ten players; equal scores receive identical protection.
  return new Map(pool.map((p,i)=>[id(p),1+3*scores.filter(score=>score>scores[i]).length/Math.max(1,pool.length-1)]));
}
export function rolePreferenceCost(p,role,priority=1){
  if(p.lockedRole||role===p.role)return 0;
  if(role===p.secondary)return 35*priority;
  const confidence=clamp(Number(p.ratingV2?.roles?.[role]?.confidence)||0,0,1);
  return (280+120*(1-confidence))*priority;
}
export function placementLabel(p){
  if(p.lockedRole)return '포지션 고정';
  if(p.assigned===p.role)return '주 포지션';
  if(p.assigned===p.secondary)return '부 포지션';
  if(CRITICAL.has(p.assigned))return '주·부포 외 예외 배치';
  const r=p.ratingV2?.roles?.[p.assigned];
  return r?.games?'주·부포 외 · 내전 '+r.games+'경기':'주·부포 외 배치';
}
function combinations(arr,k,start=0,prefix=[],out=[]){
  if(prefix.length===k){out.push(prefix);return out;}
  for(let i=start;i<=arr.length-(k-prefix.length);i++)combinations(arr,k,i+1,[...prefix,arr[i]],out);
  return out;
}
function assignmentOptions(team,engine,weights){
  let minimum=Infinity,options=[];
  function visit(members,remaining,penalty,criticalOff,total){
    if(criticalOff>minimum)return;
    if(!remaining.length){
      if(criticalOff<minimum){minimum=criticalOff;options=[];}
      options.push({members,total,penalty,criticalOff,key:members.map(p=>id(p)).join(',')});return;
    }
    const role=engine.ROLES[members.length];
    for(const p of remaining){
      if(p.lockedRole&&p.lockedRole!==role)continue;
      const power=engine.positionScore(p,role),member={id:p.id,player:p,assigned:role,power};
      visit([...members,member],remaining.filter(x=>id(x)!==id(p)),penalty+rolePreferenceCost(p,role,weights.get(id(p))),criticalOff+Number(CRITICAL.has(role)&&!isPreferred(p,role)),total+power);
    }
  }
  visit([],team,0,0,0);
  // Keep multiple role arrangements per partition, not one power-maximized team.
  return options.sort((a,b)=>a.penalty-b.penalty||a.key.localeCompare(b.key)).slice(0,24);
}
function candidate(blue,red,engine){
  const laneDiffs=blue.members.map((p,i)=>p.power-red.members[i].power),prediction=engine.predictTeams(blue.members,red.members);
  const blueLanes=laneDiffs.filter(d=>d>75).length,redLanes=laneDiffs.filter(d=>d<-75).length;
  const spread=laneDiffs.reduce((s,d)=>s+Math.min(400,Math.abs(d)),0),worstGap=Math.max(...laneDiffs.map(Math.abs));
  const balanceCost=Math.abs(prediction.blueWinRate-.5)*7000+spread*.75+worstGap*.65+Math.abs(blueLanes-redLanes)*220;
  const preferenceCost=blue.penalty+red.penalty;
  return {blue,red,laneDiffs,blueLanes,redLanes,...prediction,balanceCost,preferenceCost,cost:balanceCost+preferenceCost,key:blue.key+'|'+red.key};
}
export function teamPreferenceSummary(members){
  const critical=members.filter(p=>CRITICAL.has(p.assigned));
  return {criticalPreferred:critical.filter(p=>isPreferred(p,p.assigned)).length,criticalSlots:critical.length,criticalOff:critical.filter(p=>!isPreferred(p,p.assigned)).length,preferred:members.filter(p=>isPreferred(p,p.assigned)).length,total:members.length};
}
export function buildTeamAlternatives(input,engine){
  const pool=input.filter(p=>!p.archived).slice().sort((a,b)=>id(a).localeCompare(id(b),undefined,{numeric:true}));
  if(pool.length!==10||new Set(pool.map(id)).size!==10||pool.some(p=>p.lockedRole&&!engine.ROLES.includes(p.lockedRole)))return [];
  for(const role of engine.ROLES)if(pool.filter(p=>p.lockedRole===role).length>2)return [];
  const weights=preferenceWeights(pool,engine),partitions=[];let minimumCritical=Infinity;
  for(const rest of combinations(pool.slice(1),4)){
    const left=[pool[0],...rest],ids=new Set(left.map(id)),right=pool.filter(p=>!ids.has(id(p)));
    const blues=assignmentOptions(left,engine,weights),reds=assignmentOptions(right,engine,weights);
    if(!blues.length||!reds.length)continue;
    const criticalOff=blues[0].criticalOff+reds[0].criticalOff;
    if(criticalOff<minimumCritical){minimumCritical=criticalOff;partitions.length=0;}
    if(criticalOff===minimumCritical)partitions.push({blues,reds});
  }
  const candidates=[];
  for(const {blues,reds} of partitions){
    const best=[];
    for(const blue of blues)for(const red of reds){
      const c=candidate(blue,red,engine);best.push(c);best.sort((a,b)=>a.cost-b.cost||a.key.localeCompare(b.key));if(best.length>3)best.pop();
    }
    candidates.push(...best);
  }
  candidates.sort((a,b)=>a.cost-b.cost||a.key.localeCompare(b.key));
  if(!candidates.length)return [];
  const selected=[candidates[0]],ceiling=candidates[0].cost*1.5+400;
  const teamDistance=(a,b)=>{const ids=new Set(b.blue.members.map(id));const moved=a.blue.members.filter(p=>!ids.has(id(p))).length;return Math.min(moved,5-moved);};
  // Prefer different team compositions, then different role assignments if needed.
  for(const minimum of [2,1,0])for(const c of candidates){
    if(selected.length>=5)break;
    if(c.cost>ceiling||selected.some(x=>x.key===c.key))continue;
    if(selected.every(x=>teamDistance(c,x)>=minimum))selected.push(c);
  }
  return selected.map(c=>{
    const expand=team=>({...team,members:team.members.map(({player,assigned,power})=>({...player,assigned,power})),quality:team.total-team.penalty});
    const blue=expand(c.blue),red=expand(c.red);
    return {...c,blue,red,preferenceSummary:teamPreferenceSummary([...blue.members,...red.members]),selectionPolicy:'preferred-roles-low-power-first-v1'};
  });
}
