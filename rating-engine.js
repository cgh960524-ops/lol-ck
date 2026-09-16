/* Shared, deterministic browser/server role-skill estimator. No I/O or POG bonuses. */
(function (root) {
  'use strict';
  const VERSION = 'role-skill-v2.1.20260917';
  const ROLES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
  const TIERS = { UNRANKED:1000, IRON:800, BRONZE:950, SILVER:1100, GOLD:1250, PLATINUM:1420, EMERALD:1580, DIAMOND:1780, MASTER:2050, GRANDMASTER:2200, CHALLENGER:2380 };
  const SOURCES = new Set(['manual','team-confirmed','series-confirmed']);
  const HISTORICAL = {
    '2026-08-10':[['괴벌레','ADC'],['26111','TOP'],['신휴지','JUNGLE'],['둥글','MID'],['구마유자차','SUPPORT'],['김미르001','TOP'],['bebebbi','JUNGLE'],['에스구십','MID'],['인생','ADC'],['백설기','SUPPORT']],
    '2026-08-11':[['괴벌레','JUNGLE'],['26111','TOP'],['에스구십','MID'],['신휴지','ADC'],['bebebbi','SUPPORT'],['크리티컬','TOP'],['new','JUNGLE'],['백설기','MID'],['인생','ADC'],['둥글','SUPPORT']],
    '2026-08-15':[['괴벌레','ADC'],['진관우','TOP'],['난눈을감고','JUNGLE'],['Piremi','MID'],['bebebbi','SUPPORT'],['아무것도','TOP'],['26111','JUNGLE'],['백설기','MID'],['인생','ADC'],['둥글','SUPPORT']],
    '2026-08-17':[['진관우','TOP'],['발목분쇄기','JUNGLE'],['Piremi','MID'],['김정진짱','ADC'],['26111','SUPPORT'],['아무것도','TOP'],['인생','JUNGLE'],['둥글','MID'],['자페','ADC'],['전수찬오른붕','SUPPORT']],
    '2026-08-18':[['진관우','TOP'],['발목분쇄기','JUNGLE'],['Piremi','MID'],['김정진짱','ADC'],['26111','SUPPORT'],['아무것도','TOP'],['인생','JUNGLE'],['둥글','MID'],['자페','ADC'],['전수찬오른붕','SUPPORT']],
  };
  // The bounded composite signal is deliberately smaller than a win-probability residual.
  const MATCHUP_SCALE = 1200;
  const clamp = (x,lo,hi) => Math.max(lo,Math.min(hi,x));
  const num = x => Number.isFinite(Number(x)) ? Number(x) : 0;
  const mean = xs => xs.length ? xs.reduce((s,x)=>s+x,0)/xs.length : 0;
  const norm = (name,tag) => `${name||''}#${String(tag||'').replace(/^#/,'')}`.replace(/\s/g,'').toLowerCase();
  const POPULATION=1450;
  // A past peak is role-local, not a permanent floor or a universal skill value.
  const basePower=p=>p.tier==='UNRANKED'?POPULATION:clamp((TIERS[p.tier]||POPULATION)+num(p.form),400,3200);
  function initialProfile(p){
    if(p.ratingSeedV21?.policy==='role-local-priors-v1')return p.ratingSeedV21;
    const old=p.ratingSeedV2,primary=ROLES.includes(old?.role)?old.role:ROLES.includes(p.role)?p.role:'MID',secondary=ROLES.includes(old?.secondary)?old.secondary:p.secondary;
    // Keep a previous non-overridden registration seed stable across migration.
    const overridden=num(p.soloPowerOverride)>0;
    const solo=old&&!overridden?clamp(num(old.value)||POPULATION,400,3200):basePower(p);
    const priors=structuredClone(old?.rolePriors||p.rolePriors||{});
    // New records may explicitly store the peak's role; old records use frozen registration main.
    const peakRole=ROLES.includes(p.soloPowerRole)?p.soloPowerRole:primary;
    if(overridden&&num(p.soloPowerOverride)>num(priors[peakRole]?.rating))priors[peakRole]={rating:num(p.soloPowerOverride),source:p.soloPowerSource||'등록 시 해당 포지션 과거 실력'};
    const roles={};
    for(const role of ROLES){
      const factor=role===primary?1:role===secondary?.5:.25,offset=role===primary?0:role===secondary?35:80;
      // Only positive skill evidence transfers partially; low current tiers are not inflated.
      const normal=POPULATION+Math.min(0,solo-POPULATION)+Math.max(0,solo-POPULATION)*factor-offset;
      const peak=num(priors[role]?.rating),rating=clamp(normal+Math.max(0,peak-normal)*.5,400,3200);
      roles[role]={rating,base:normal,peak:peak||null,source:peak?'role-history':'solo-transfer',historySource:priors[role]?.source||null};
    }
    return {policy:'role-local-priors-v1',solo,primary,secondary,roles,source:old?.source||(p.tier==='UNRANKED'?'unknown-population':'solo-registration')};
  }
  const overallScore=p=>Math.round(p.ratingV2?.overall??(p.internalGames?p.internalRating:initialProfile(p).roles[initialProfile(p).primary].rating));
  function positionScore(p,role){
    const r=p.ratingV2?.version===VERSION?p.ratingV2.roles?.[role]:null;
    return Math.round(r?.rating??initialProfile(p).roles[role]?.rating??overallScore(p));
  }
  const isProvisional=r=>!r||num(r.games)<8||(r.opponents instanceof Set?r.opponents.size:num(r.opponents))<3||num(r.confidence)<.35;
  const confidenceLabel=r=>!r?.games?'잠정 · 미배치':isProvisional(r)?'잠정 · 표본 부족':r.confidence>=.65?'근거 충분':'학습 중';
  const confidence = p => num(p?.confidence);
  function playerResolver(players) {
    const aliases=new Map(),puuids=new Map(),names=new Map();
    for(const p of players.filter(p=>!p.archived)) {
      if(p.puuid)puuids.set(p.puuid,p);
      names.set(norm(p.name,p.tag),p);
      for(const a of p.playAliases||[]){if(a.puuid&&!aliases.has(a.puuid))aliases.set(a.puuid,p);const key=norm(a.gameName,a.tagLine);if(!aliases.has(key))aliases.set(key,p);}
    }
    return mp=>aliases.get(mp.puuid)||aliases.get(norm(mp.gameName,mp.tagLine))||puuids.get(mp.puuid)||names.get(norm(mp.gameName,mp.tagLine));
  }
  function prepareMatches(players,matches,seriesState={}) {
    const find=playerResolver(players), corrections=new Map();
    for(const s of [...(seriesState.history||[]),...(seriesState.active?[seriesState.active]:[])]) {
      for(const set of s.sets||[])if(set.gameId){const roles=new Map();for(const slot of [...(s.blue||[]),...(s.red||[])])roles.set(String(slot.id),set.roleOverrides?.[String(slot.id)]||slot.role);corrections.set(String(set.gameId),{roles,seriesId:s.seriesNumber||s.id,snapshot:s.ratingSnapshot});}
    }
    // Preserve explicit per-set/series assignments. Never infer a lane from champion.
    const unique=new Map();
    for(const m of matches||[])if(m?.gameId&&Array.isArray(m.participants))unique.set(String(m.gameId),m);
    return [...unique.values()].map(m=>{
      const c=corrections.get(String(m.gameId)),day=new Date(num(m.gameCreation)+9*3600000).toISOString().slice(0,10),historical=HISTORICAL[day]||[];
      return {...m,seriesId:c?.seriesId||`game:${m.gameId}`,ratingSnapshot:c?.snapshot,participants:m.participants.map(mp=>{const role=c?.roles.get(String(find(mp)?.id)),manual=historical.find(([name])=>String(mp.gameName||'').replace(/\s/g,'').toLowerCase().startsWith(name.toLowerCase()));return ROLES.includes(role)?{...mp,role,roleSource:'series-confirmed'}:manual?{...mp,role:manual[1],roleSource:'manual'}:{...mp};})};
    }).sort((a,b)=>num(a.gameCreation)-num(b.gameCreation)||String(a.gameId).localeCompare(String(b.gameId)));
  }
  const confirmedRole = mp => SOURCES.has(mp.roleSource)&&ROLES.includes(mp.role)?mp.role:null;
  const WEIGHTS = {
    TOP:{growth:.20,efficiency:.20,fight:.18,survival:.07,vision:.05,tank:.12,control:.09,protection:.02,objective:.07},
    JUNGLE:{growth:.13,efficiency:.14,fight:.23,survival:.06,vision:.12,tank:.07,control:.07,protection:.02,objective:.16},
    MID:{growth:.21,efficiency:.26,fight:.23,survival:.08,vision:.06,tank:.04,control:.07,protection:.02,objective:.03},
    ADC:{growth:.25,efficiency:.34,fight:.22,survival:.10,vision:.03,tank:0,control:.02,protection:0,objective:.04},
    SUPPORT:{growth:0,efficiency:.04,fight:.22,survival:.05,vision:.23,tank:.12,control:.15,protection:.16,objective:.03},
  };
  const LABELS={growth:'성장',efficiency:'피해 효율',fight:'교전 참여',survival:'생존·참여',vision:'시야',tank:'탱킹',control:'제어',protection:'아군 보호',objective:'오브젝트·포탑'};
  function features(mp,m) {
    const team=m.participants.filter(x=>x.teamId===mp.teamId),mins=Math.max(5,num(m.duration)/60),kills=team.reduce((s,x)=>s+num(x.kills),0),kp=clamp((num(mp.kills)+num(mp.assists))/Math.max(1,kills),0,1),has=(...keys)=>keys.every(k=>Object.hasOwn(mp,k)&&mp[k]!==null&&Number.isFinite(Number(mp[k]))),f={};
    if(has('gold','cs'))f.growth=Math.log1p((num(mp.gold)/mins)/60)+.35*Math.log1p(num(mp.cs)/mins);
    if(has('damage','gold'))f.efficiency=Math.log1p(num(mp.damage)/Math.max(500,num(mp.gold)));
    if(has('kills','assists'))f.fight=Math.log1p(kp*4);
    if(has('deaths','kills','assists'))f.survival=Math.log1p((.25+kp)*mins/(num(mp.deaths)+2));
    if(has('vision'))f.vision=Math.log1p(num(mp.vision)/mins);
    if(has('damageTaken','mitigated','deaths'))f.tank=Math.log1p((num(mp.damageTaken)+num(mp.mitigated)*.6)/mins/500)*(.75+.25*kp);
    if(has('ccTime'))f.control=Math.log1p(num(mp.ccTime)/mins);
    if(has('healsOnTeammates','shieldsOnTeammates'))f.protection=Math.log1p((num(mp.healsOnTeammates)+num(mp.shieldsOnTeammates))/mins/100);
    if(has('objectiveDamage','turretDamage'))f.objective=Math.log1p((num(mp.objectiveDamage)*.4+num(mp.turretDamage)*.6)/mins/250);
    return {f,kp};
  }
  function performance(mp,opp,m,role,baseline) {
    if(!opp)return {signal:0,quality:0,metrics:[],championEvidence:0};
    const a=features(mp,m),b=features(opp,m),weights=WEIGHTS[role],teamGold=id=>m.participants.filter(x=>x.teamId===id).reduce((s,x)=>s+num(x.gold),0),advantage=clamp(Math.log(Math.max(1,teamGold(mp.teamId))/Math.max(1,teamGold(opp.teamId))),-.8,.8),metrics=[];
    let weighted=0,total=0,evidence=0;
    for(const [key,weight] of Object.entries(weights)) {
      if(!weight||a.f[key]===undefined||b.f[key]===undefined)continue;
      const ca=baseline.get(`${role}|${mp.championKey||mp.championName}|${key}`),cb=baseline.get(`${role}|${opp.championKey||opp.championName}|${key}`),pool=baseline.get(`${role}|*|${key}`);
      const correction=c=>c&&pool?clamp((c.mean-pool.mean)*c.n/(c.n+10),-.35,.35):0;
      const context=['growth','efficiency','tank','objective'].includes(key)?advantage*.4:0;
      const signal=Math.tanh((a.f[key]-b.f[key]-correction(ca)+correction(cb)-context)/1.1);
      weighted+=weight*signal;total+=weight;evidence+=Math.min(ca?.n||0,cb?.n||0)*weight;
      metrics.push({key,label:LABELS[key],signal:Math.round(signal*1000)/1000,weight});
    }
    return {signal:total?clamp(weighted/total,-.85,.85):0,quality:total,metrics,championEvidence:total?evidence/total:0};
  }
  function updateBaselines(m,baseline) {
    for(const mp of m.participants){const role=confirmedRole(mp);if(!role)continue;for(const [key,value] of Object.entries(features(mp,m).f))for(const champ of ['*',mp.championKey||mp.championName]){const id=`${role}|${champ}|${key}`,s=baseline.get(id)||{n:0,mean:0};s.n++;s.mean+=(value-s.mean)/s.n;baseline.set(id,s);}}
  }
  function recalculate(players,matches,seriesState={}) {
    const find=playerResolver(players),prepared=prepareMatches(players,matches,seriesState),baseline=new Map(),population=1450,models=new Map(),diagnostics={version:VERSION,matches:0,unmatched:0,unconfirmed:0,duplicateLinks:0};
    for(const p of players){
      // V2 seeds are retained for audit/rollback. V2.1 uses a separate immutable profile.
      if(p.ratingSeedV21?.policy!=='role-local-priors-v1')p.ratingSeedV21=initialProfile(p);
      const profile=p.ratingSeedV21,seed=profile.roles[profile.primary].rating;
      models.set(String(p.id),{seed,profile,unknown:profile.source==='unknown-population',roles:{},games:0,overall:seed,history:[],unconfirmed:0});
      p.internalGames=0;p.internalRoles={};p.internalChampions={};p.internalKills=0;p.internalDeaths=0;p.internalAssists=0;p.internalKda=0;p.internalChampionScore=0;p.ratingHistory=[];
    }
    function ensureRole(p,role) {
      const model=models.get(String(p.id));
      if(!model.roles[role]){const prior=model.profile.roles[role],seed=prior.rating;model.roles[role]={rating:seed,seed,games:0,weight:0,wins:0,performanceTotal:0,expectedTotal:0,opponents:new Set(),series:new Map(),recent:[],lastAt:0,confidence:0,uncertainty:330,prior:!!prior.peak};}
      return model.roles[role];
    }
    function overall(model){const roles=Object.values(model.roles).filter(r=>r.games),total=roles.reduce((s,r)=>s+Math.sqrt(r.weight),0);return total?roles.reduce((s,r)=>s+r.rating*Math.sqrt(r.weight),0)/total:model.seed;}
    for(const m of prepared){
      if(num(m.duration)<300)continue;
      const seen=new Set(),entries=[];
      for(const mp of m.participants){const p=find(mp);if(!p){diagnostics.unmatched++;continue;}const id=String(p.id);if(seen.has(id)){diagnostics.duplicateLinks++;continue;}seen.add(id);const role=confirmedRole(mp),model=models.get(id),r=role?ensureRole(p,role):null;entries.push({mp,p,model,role,r,id});}
      const sides=[100,200].map(id=>entries.filter(e=>e.mp.teamId===id));
      if(!sides[0].length||!sides[1].length)continue;
      const pre=new Map(entries.map(e=>[e.id,{rating:e.r?.rating??e.model.overall,confidence:e.r?.confidence||0,overall:e.model.overall}])),averages=sides.map(side=>mean(side.map(e=>pre.get(e.id).rating))),teamExpected=1/(1+10**((averages[1]-averages[0])/400)),complete=sides.every(side=>side.length===5),pending=[];
      for(const e of entries){
        const {mp,p,model,role,r,id}=e,ownPre=pre.get(id),sameRole=role?entries.filter(x=>x.mp.teamId!==mp.teamId&&x.role===role):[],ownRoleCount=entries.filter(x=>x.mp.teamId===mp.teamId&&x.role===role).length,opponent=sameRole.length===1&&ownRoleCount===1?sameRole[0]:null;
        const expected=mp.teamId===100?teamExpected:1-teamExpected,result=(mp.win?1:0)-expected,oppPre=opponent?pre.get(opponent.id):null,obs=performance(mp,opponent?.mp,m,role,baseline);
        let before=r?.rating??model.overall,change=0,personal=0,outcome=0,acceleration=1,expectedPerformance=0,residual=0;
        if(r){
          const gapDays=r.lastAt?Math.max(0,(num(m.gameCreation)-r.lastAt)/86400000):0,inactivity=gapDays>30?Math.min(1.3,1+(gapDays-30)/180):1;
          expectedPerformance=oppPre?Math.tanh((before-oppPre.rating)/MATCHUP_SCALE):0;
          residual=oppPre?obs.signal-expectedPerformance:0;
          const recent=r.recent.slice(-5),direction=Math.sign(residual),aligned=recent.filter(x=>Math.sign(x)===direction&&Math.abs(x)>.12).length;
          acceleration=aligned>=4?1.4:aligned>=3?1.2:1;
          const repeated=r.series.get(m.seriesId)||0,independence=1/Math.sqrt(1+repeated*.5),quality=obs.quality*(oppPre?.confidence?(.6+.4*oppPre.confidence):.6),learning=(r.games<3?180:r.games<8?145:r.games<20?115:90)*inactivity;
          personal=learning*residual*quality*acceleration*independence;
          // Results are supporting evidence, never amplified by a performance streak.
          outcome=(r.games<5?24:16)*result*(complete?1:.25)*independence;
          change=clamp(personal+outcome,-(r.games<5?140:95),r.games<5?140:95);
          pending.push({e,change,expected,obs,residual,personal,outcome,acceleration,before,opponent,independence});
        }else{
          diagnostics.unconfirmed++;model.unconfirmed++;
          // Unknown roles are counted for KDA/champions but cannot train a guessed lane.
          pending.push({e,change:0,expected,obs,residual:0,personal:0,outcome:0,acceleration:1,before,opponent:null,independence:0});
        }
      }
      for(const step of pending){
        const {e,change,expected,obs,residual,personal,outcome,acceleration,before,opponent,independence}=step,{mp,p,model,r,role}=e;
        if(r){r.rating=clamp(before+change,400,3200);r.games++;r.weight+=independence*(opponent?Math.max(.15,obs.quality):.1);r.wins+=Number(!!mp.win);r.expectedTotal+=expected;r.performanceTotal+=obs.signal;if(opponent)r.opponents.add(opponent.id);r.series.set(m.seriesId,(r.series.get(m.seriesId)||0)+1);r.recent.push(residual);r.lastAt=num(m.gameCreation);const diversity=.45+.55*Math.min(1,r.opponents.size/6);r.confidence=clamp(r.weight/(r.weight+6)*diversity*(.65+.35*obs.quality),0,.94);r.uncertainty=Math.round(330*(1-r.confidence)+35*r.confidence);}
        model.games++;p.internalGames++;p.internalKills+=num(mp.kills);p.internalDeaths+=num(mp.deaths);p.internalAssists+=num(mp.assists);
        const ckey=`${role||'UNKNOWN'}|${mp.championKey||mp.championName||'Unknown'}`,c=p.internalChampions[ckey]||={name:mp.championName||'Unknown',championKey:mp.championKey||mp.championName,championId:num(mp.championId),role:role||'UNKNOWN',games:0,wins:0,kills:0,deaths:0,assists:0,damageTotal:0,goldTotal:0};c.games++;c.wins+=Number(!!mp.win);for(const key of ['kills','deaths','assists'])c[key]+=num(mp[key]);c.damageTotal+=num(mp.damage);c.goldTotal+=num(mp.gold);
        const afterOverall=overall(model);model.history.push({gameId:String(m.gameId),seriesId:m.seriesId,time:num(m.gameCreation),version:VERSION,role,win:!!mp.win,before:Math.round(model.overall),after:Math.round(afterOverall),change:Math.round(afterOverall)-Math.round(model.overall),roleBefore:Math.round(before),roleAfter:r?Math.round(r.rating):null,roleChange:r?Math.round(r.rating)-Math.round(before):0,expected:Number(expected.toFixed(3)),performance:Number(obs.signal.toFixed(3)),expectedPerformance:opponent?Number(Math.tanh((before-pre.get(opponent.id).rating)/MATCHUP_SCALE).toFixed(3)):null,residual:Number(residual.toFixed(3)),opponentId:opponent?.p.id||null,opponentPower:opponent?Math.round(pre.get(opponent.id).rating):null,personalChange:Number(personal.toFixed(1)),outcomeChange:Number(outcome.toFixed(1)),acceleration,quality:Number(obs.quality.toFixed(2)),reason:!role?'unconfirmed':!opponent?'no-opponent':residual>.12?'above':residual<-.12?'below':'expected',metrics:obs.metrics});model.overall=afterOverall;
      }
      diagnostics.matches++;updateBaselines(m,baseline);
    }
    for(const p of players){const model=models.get(String(p.id)),roles={};for(const role of ROLES)ensureRole(p,role);for(const [role,r] of Object.entries(model.roles)){roles[role]={rating:Math.round(r.rating),provisional:isProvisional(r),seed:Math.round(r.seed),games:r.games,wins:r.wins,confidence:Number(r.confidence.toFixed(3)),uncertainty:r.uncertainty,opponents:r.opponents.size,series:r.series.size,recentResidual:Number(mean(r.recent.slice(-5)).toFixed(3)),expectedTotal:r.expectedTotal,performanceTotal:r.performanceTotal};if(r.games)p.internalRoles[role]={...roles[role]};}p.ratingV2={version:VERSION,overall:Math.round(model.overall),roles,unconfirmed:model.unconfirmed,seed:model.seed,seedSource:model.profile.source,soloSeed:model.profile.solo,provisional:Object.values(roles).filter(r=>r.games).length===0||Object.values(roles).filter(r=>r.games).reduce((s,r)=>s+r.games*r.confidence,0)/Math.max(1,p.internalGames)<.35||new Set(Object.values(model.roles).flatMap(r=>[...r.opponents])).size<3||p.internalGames<8};p.internalRating=Math.round(model.overall);p.ratingUncertainty=Math.round(mean(Object.values(roles).map(r=>r.uncertainty))||330);p.internalKda=p.internalGames?Number(((p.internalKills+p.internalAssists)/Math.max(1,p.internalDeaths)).toFixed(2)):0;p.ratingHistory=model.history.slice(-120);}
    return {players,matches:prepared,diagnostics};
  }
  root.CKRating={VERSION,ROLES,initialProfile,isProvisional,confidenceLabel,basePower,overallScore,positionScore,confidence,confirmedRole,playerResolver,prepareMatches,recalculate};
})(globalThis);
