import {features} from './rating-observation.js?v=20260917-v4';

// Descriptive presentation only. Never imported by the rating engine or persisted.
export const STYLE_AXES=[
  {key:'growth',label:'성장',detail:'분당 골드·CS'},
  {key:'efficiency',label:'딜 효율',detail:'골드 대비 챔피언 피해'},
  {key:'fight',label:'교전 참여',detail:'팀 킬 관여율'},
  {key:'survival',label:'생존·참여',detail:'데스·시간·킬 관여'},
  {key:'vision',label:'시야',detail:'분당 시야 점수'},
  {key:'control',label:'제어',detail:'분당 CC 시간'}
];
export const STYLE_MIN={games:3,sessions:2,players:5};
const mean=xs=>xs.reduce((sum,x)=>sum+x,0)/xs.length;
const valid=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))&&Number(x)>=0;
const required={growth:['gold','cs'],efficiency:['damage','gold'],fight:['kills','assists'],survival:['deaths','kills','assists'],vision:['vision'],control:['ccTime']};

export function styleFeatures(p,m){
  const raw=features(p,m),out={},team=m.participants.filter(x=>x.teamId===p.teamId);
  const killsKnown=team.length===5&&team.every(x=>valid(x.kills))&&team.reduce((s,x)=>s+Number(x.kills),0)>0;
  for(const {key} of STYLE_AXES){
    if(!required[key].every(field=>valid(p[field]))||!Number.isFinite(raw[key]))continue;
    if((key==='fight'||key==='survival')&&!killsKnown)continue;
    if(key==='efficiency'&&Number(p.gold)===0)continue;
    // Legacy uploads may contain zero placeholders for CC. An all-zero match
    // cannot distinguish missing collection from a real zero; omit that axis.
    if(key==='control'&&!m.participants.some(x=>valid(x.ccTime)&&Number(x.ccTime)>0))continue;
    out[key]=raw[key];
  }
  return out;
}

export function percentile(value,pool){
  if(!Number.isFinite(value)||!pool.length)return null;
  const less=pool.filter(x=>x<value-1e-9).length,equal=pool.filter(x=>Math.abs(x-value)<=1e-9).length;
  return Math.round(100*(less+equal*.5)/pool.length);
}

export function buildStyleProfiles(players,matches,seriesState,engine){
  const find=engine.playerResolver(players),records=new Map();
  const prepared=engine.prepareMatches(players,matches,seriesState);
  for(const match of prepared){
    if(!valid(match.duration)||Number(match.duration)<300)continue;
    const entries=match.participants.map(p=>({p,player:find(p),role:engine.confirmedRole(p)}));
    for(const {p,player,role} of entries){
      if(!player||!role||![100,200].includes(p.teamId))continue;
      if(entries.filter(e=>e.player&&String(e.player.id)===String(player.id)).length!==1)continue;
      if(entries.filter(e=>e.p.teamId===p.teamId&&e.role===role).length!==1)continue;
      const key=String(player.id)+'|'+role;
      if(!records.has(key))records.set(key,{id:String(player.id),role,games:0,sessions:new Map()});
      const record=records.get(key);record.games++;
      const session=String(match.seriesId||match.gameId);
      if(!record.sessions.has(session))record.sessions.set(session,{});
      const group=record.sessions.get(session);
      for(const [axis,value] of Object.entries(styleFeatures(p,match)))(group[axis]??=[]).push(value);
    }
  }
  for(const record of records.values()){
    record.metrics={};
    for(const {key} of STYLE_AXES){
      const values=[...record.sessions.values()].map(s=>s[key]).filter(v=>v?.length);
      const games=values.reduce((s,x)=>s+x.length,0);
      record.metrics[key]={value:values.length?mean(values.map(mean)):null,games,sessions:values.length};
    }
    record.sessionCount=record.sessions.size;
  }
  function get(playerId,role){
    const record=records.get(String(playerId)+'|'+role),games=record?.games||0;
    const metrics=STYLE_AXES.map(axis=>{
      const metric=record?.metrics[axis.key]||{value:null,games:0,sessions:0};
      const pool=[...records.values()].filter(r=>r.role===role).map(r=>r.metrics[axis.key]).filter(m=>m.games>=STYLE_MIN.games&&m.sessions>=STYLE_MIN.sessions).map(m=>m.value);
      const reason=!games?'no-games':!metric.games?'missing':metric.games<STYLE_MIN.games||metric.sessions<STYLE_MIN.sessions?'few-games':pool.length<STYLE_MIN.players?'few-peers':'ready';
      return {...axis,...metric,peers:pool.length,index:reason==='ready'?percentile(metric.value,pool):null,reason};
    });
    return {role,games,sessions:record?.sessionCount||0,metrics,available:metrics.filter(m=>m.index!==null).length};
  }
  return {get};
}
