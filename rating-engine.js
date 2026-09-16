import REFERENCE from './rating-reference.js';
import {observe,estimate} from './rating-observation.js?v=20260917-v32';
/* Shared, deterministic browser/server role-skill estimator. No I/O or POG bonuses. */
(function (root) {
  'use strict';
  const VERSION = 'observed-skill-v3.2.20260917';
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
  // Kept as an audit helper for V2 compatibility; V3 does not use reward residuals.
  const MATCHUP_SCALE = 1200;
  const clamp = (x,lo,hi) => Math.max(lo,Math.min(hi,x));
  const num = x => Number.isFinite(Number(x)) ? Number(x) : 0;
  const mean = xs => xs.length ? xs.reduce((s,x)=>s+x,0)/xs.length : 0;
  const norm = (name,tag) => `${name||''}#${String(tag||'').replace(/^#/,'')}`.replace(/\s/g,'').toLowerCase();
  const POPULATION=1450;
  // Lifetime participation retires solo restoration even when role/account data
  // is missing. Evidence confidence is tracked separately, never used to extend it.
  const soloRetention=(games,roleGames=0)=>Math.min(clamp((30-games)/20,0,1),clamp((20-roleGames)/12,0,1));
  // Do not demand an enormous stat gap just because the displayed rating gap is
  // large. Symmetric saturation limits both underdog credit and favourite burden.
  const matchupExpectation=gap=>Math.tanh(clamp(gap,-400,400)/MATCHUP_SCALE);
  // A past peak is role-local, not a permanent floor or a universal skill value.
  const basePower=p=>p.tier==='UNRANKED'?POPULATION:clamp((TIERS[p.tier]||POPULATION)+num(p.form),400,3200);
  function initialProfile(p){
    if(p.ratingSeedV22?.policy==='skill-baseline-v1')return p.ratingSeedV22;
    const frozen=p.ratingSeedV21,old=p.ratingSeedV2,primary=frozen?.primary||(ROLES.includes(old?.role)?old.role:ROLES.includes(p.role)?p.role:'MID'),secondary=frozen?.secondary||(ROLES.includes(old?.secondary)?old.secondary:p.secondary);
    // Keep a previous non-overridden registration seed stable across migration.
    const overridden=num(p.soloPowerOverride)>0;
    const solo=frozen?.solo??(old&&!overridden?clamp(num(old.value)||POPULATION,400,3200):basePower(p));
    const priors=structuredClone(old?.rolePriors||p.rolePriors||{});
    // New records may explicitly store the peak's role; old records use frozen registration main.
    const peakRole=ROLES.includes(p.soloPowerRole)?p.soloPowerRole:primary;
    if(overridden&&num(p.soloPowerOverride)>num(priors[peakRole]?.rating))priors[peakRole]={rating:num(p.soloPowerOverride),source:p.soloPowerSource||'등록 시 해당 포지션 과거 실력'};
    const roles={};
    for(const role of ROLES){
      const offset=role===primary?0:role===secondary?35:80;
      // Missing role evidence widens uncertainty; it does not erase general skill.
      const normal=clamp(solo-offset,400,3200);
      const peak=num(frozen?frozen.roles[role]?.peak:priors[role]?.rating),rating=clamp(normal+Math.max(0,peak-normal)*.5,400,3200);
      roles[role]={rating,base:normal,peak:peak||null,source:peak?'role-history':'solo-transfer',historySource:frozen?.roles[role]?.historySource||priors[role]?.source||null};
    }
    return {policy:'skill-baseline-v1',solo,primary,secondary,roles,source:frozen?.source||old?.source||(p.tier==='UNRANKED'?'unknown-population':'solo-registration')};
  }
  // Conservative cross-role transfer is distinct from the measured V3 signal.
  // It never feeds back as a discount to opponents or the player's overall skill.
  function offRoleEstimate(profile,role,rating,anchor,games=0,series=0,opponents=0){
    const familiar=role===profile.primary||role===profile.secondary;
    const evidenceShare=familiar?1:Math.min(1,games/8,series/3,opponents/3);
    const transferPenalty=clamp(anchor*.12,150,300),baseline=clamp(anchor-transferPenalty,400,3200);
    const applied=familiar?rating:Math.min(rating,baseline+evidenceShare*Math.max(0,rating-baseline));
    return {rating:applied,evidenceRating:rating,transferAnchor:anchor,transferBaseline:baseline,transferPenalty,
      calibrationDiscount:rating-applied,roleEvidenceShare:evidenceShare,calibrationStatus:familiar?'preferred':evidenceShare>=1?'verified':'off-role-provisional'};
  }
  const overallScore=p=>Math.round(p.ratingV2?.overall??(p.internalGames?p.internalRating:initialProfile(p).roles[initialProfile(p).primary].rating));
  function positionScore(p,role){
    const r=p.ratingV2?.version===VERSION?p.ratingV2.roles?.[role]:null;
    if(r)return Math.round(r.rating);
    const profile=initialProfile(p),raw=profile.roles[role]?.rating??overallScore(p);
    return Math.round(offRoleEstimate(profile,role,raw,Math.min(raw,overallScore(p))).rating);
  }
  const isProvisional=r=>!r||num(r.games)<8||(r.evidenceSeries!==undefined&&r.evidenceSeries<3)||(r.opponents instanceof Set?r.opponents.size:num(r.opponents))<3||num(r.confidence)<.35;
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
  const performance=(mp,opp,m,role)=>observe(mp,opp,m,role,REFERENCE);
  function recalculate(players,matches,seriesState={}) {
    const find=playerResolver(players),prepared=prepareMatches(players,matches,seriesState),models=new Map(),diagnostics={version:VERSION,matches:0,unmatched:0,unconfirmed:0,duplicateLinks:0};
    for(const p of players){
      // All previous seeds remain untouched for audit/rollback.
      if(p.ratingSeedV22?.policy!=='skill-baseline-v1')p.ratingSeedV22=initialProfile(p);
      const profile=p.ratingSeedV22,seed=profile.roles[profile.primary].rating;
      models.set(String(p.id),{seed,profile,unknown:profile.source==='unknown-population',roles:{},games:0,overall:seed,history:[],unconfirmed:0});
      p.internalGames=0;p.internalRoles={};p.internalChampions={};p.internalKills=0;p.internalDeaths=0;p.internalAssists=0;p.internalKda=0;p.internalChampionScore=0;p.ratingHistory=[];
    }
    function ensureRole(p,role) {
      const model=models.get(String(p.id));
      if(!model.roles[role]){const prior=model.profile.roles[role],retention=soloRetention(model.games),hasInternal=Object.values(model.roles).some(r=>r.comparisons>0),transfer=hasInternal?model.overall:prior.rating,seed=clamp(prior.rating*retention+transfer*(1-retention),400,3200);model.roles[role]={rating:seed,seed,transferAnchor:Math.min(seed,model.overall),observedSeries:new Set(),observedOpponents:new Set(),seedSource:hasInternal&&retention<1?'internal-transfer':'registration',registrationShare:hasInternal?retention:1,games:0,comparisons:0,weight:0,wins:0,performanceTotal:0,expectedTotal:0,opponents:new Set(),series:new Map(),recent:[],observations:[],estimatedTarget:null,evidenceSeries:0,priorShare:1,lastAt:0,confidence:0,uncertainty:330,prior:!!prior.peak};}
      const r=model.roles[role];if(r.assignedRating===undefined)r.assignedRating=offRoleEstimate(model.profile,role,r.rating,r.transferAnchor).rating;
      return r;
    }
    const appliedRole=(model,role,r)=>{const estimate=offRoleEstimate(model.profile,role,r.rating,r.transferAnchor,r.comparisons,r.observedSeries.size,r.observedOpponents.size);return {...estimate,calibrationTarget:estimate.rating,rating:r.assignedRating,calibrationDiscount:r.rating-r.assignedRating};};
    function overall(model){const roles=Object.entries(model.roles).filter(([,r])=>r.games),total=roles.reduce((s,[,r])=>s+Math.sqrt(r.weight),0);return total?clamp(roles.reduce((s,[role,r])=>s+(r.rating+(model.profile.solo-model.profile.roles[role].base)*r.registrationShare*soloRetention(model.games,r.games))*Math.sqrt(r.weight),0)/total,400,3200):model.seed;}
    for(const m of prepared){
      if(num(m.duration)<300)continue;
      const seen=new Set(),entries=[];
      for(const mp of m.participants){const p=find(mp);if(!p){diagnostics.unmatched++;continue;}const id=String(p.id);if(seen.has(id)){diagnostics.duplicateLinks++;continue;}seen.add(id);const role=confirmedRole(mp),model=models.get(id),r=role?ensureRole(p,role):null;entries.push({mp,p,model,role,r,id});}
      const sides=[100,200].map(id=>entries.filter(e=>e.mp.teamId===id));
      if(!sides[0].length||!sides[1].length)continue;
      const pre=new Map(entries.map(e=>[e.id,{rating:e.r?.rating??e.model.overall,confidence:e.r?.confidence||0,assignedRating:e.r?appliedRole(e.model,e.role,e.r).rating:e.model.overall,overall:e.model.overall}])),averages=sides.map(side=>mean(side.map(e=>pre.get(e.id).assignedRating))),teamExpected=1/(1+10**((averages[1]-averages[0])/400)),pending=[];
      for(const e of entries){
        const {mp,p,model,role,r,id}=e,sameRole=role?entries.filter(x=>x.mp.teamId!==mp.teamId&&x.role===role):[],ownRoleCount=role?m.participants.filter(x=>x.teamId===mp.teamId&&confirmedRole(x)===role).length:0,opponentRoleCount=role?m.participants.filter(x=>x.teamId!==mp.teamId&&confirmedRole(x)===role).length:0,opponent=sameRole.length===1&&ownRoleCount===1&&opponentRoleCount===1?sameRole[0]:null;
        const comparisonStatus=!role?'role-unconfirmed':ownRoleCount!==1?'own-role-ambiguous':opponentRoleCount>1?'opponent-role-ambiguous':opponentRoleCount===0?'opponent-role-unconfirmed':!opponent?'opponent-unlinked':'matched';
        const expected=mp.teamId===100?teamExpected:1-teamExpected,oppPre=opponent?pre.get(opponent.id):null,obs=performance(mp,opponent?.mp,m,role);
        let before=r?.rating??model.overall,change=0,personal=0,outcome=0,priorChange=0,acceleration=1,expectedPerformance=0,residual=0;
        if(r){
          const repeated=r.series.get(m.seriesId)||0,independence=1/Math.sqrt(1+repeated*.5);
          if(opponent&&obs.target!==null&&obs.quality>=.65){
            // A bounded opponent-context correction uses measured matchup margins,
            // never a win/underdog bounty. The fixed reference prevents a free +C shift.
            const relativeTarget=oppPre.rating+REFERENCE.spread*obs.pairedSignal;
            const contextWeight=.65*(.5+.5*oppPre.confidence);
            obs.contextAdjustment=clamp((relativeTarget-obs.target)*contextWeight,-400,400);
            obs.target=clamp(obs.target+obs.contextAdjustment,650,2850);
            r.observations.push({seriesId:m.seriesId,target:obs.target,quality:obs.quality});
            const keep=new Set([...new Set(r.observations.map(x=>x.seriesId))].slice(-12));
            r.observations=r.observations.filter(x=>keep.has(x.seriesId));
            const evidence=estimate(r.observations);
            r.estimatedTarget=evidence.target;r.evidenceSeries=evidence.series;
            r.priorShare=Math.min(soloRetention(model.games+1,r.games+1),Math.max(0,1-r.observations.length/12));
            const target=r.seed*r.priorShare+evidence.target*(1-r.priorShare);
            expectedPerformance=(before-REFERENCE.center)/REFERENCE.spread;
            residual=(obs.target-before)/REFERENCE.spread;
            change=clamp(target-before,-(r.games<5?140:95),r.games<5?140:95);
            personal=change;
          }
          pending.push({e,change,expected,expectedPerformance,comparisonStatus,obs,residual,personal,outcome,priorChange,acceleration,before,opponent,independence});
        }else{
          diagnostics.unconfirmed++;model.unconfirmed++;
          // Unknown roles are counted for KDA/champions but cannot train a guessed lane.
          pending.push({e,change:0,expected,expectedPerformance:0,comparisonStatus,obs,residual:0,personal:0,outcome:0,priorChange:0,acceleration:1,before,opponent:null,independence:0});
        }
      }
      for(const step of pending){
        const {e,change,expected,expectedPerformance,comparisonStatus,obs,residual,personal,outcome,priorChange,acceleration,before,opponent,independence}=step,{mp,p,model,r,role}=e;
        const soloRetentionBefore=soloRetention(model.games,r?.games||0),internalGamesBefore=model.games;
        if(r){r.rating=clamp(before+change,400,3200);r.games++;if(opponent&&obs.quality>=.65){r.comparisons++;r.observedSeries.add(m.seriesId);r.observedOpponents.add(opponent.id);}r.weight+=independence*(opponent&&obs.quality>=.65?obs.quality:0);r.wins+=Number(!!mp.win);r.expectedTotal+=expected;r.performanceTotal+=obs.signal;if(opponent)r.opponents.add(opponent.id);r.series.set(m.seriesId,(r.series.get(m.seriesId)||0)+1);r.recent.push(residual);r.lastAt=num(m.gameCreation);const diversity=.45+.55*Math.min(1,r.opponents.size/6);r.confidence=clamp(r.weight/(r.weight+6)*diversity*(.65+.35*obs.quality)*Math.min(1,r.evidenceSeries/4),0,.94);r.uncertainty=Math.round(330*(1-r.confidence)+35*r.confidence);const projected=appliedRole(model,role,r);if(opponent&&obs.quality>=.65)r.assignedRating=clamp(r.assignedRating+clamp(projected.calibrationTarget-r.assignedRating,-(r.games<=5?140:95),r.games<=5?140:95),400,3200);}
        model.games++;p.internalGames++;p.internalKills+=num(mp.kills);p.internalDeaths+=num(mp.deaths);p.internalAssists+=num(mp.assists);
        const ckey=`${role||'UNKNOWN'}|${mp.championKey||mp.championName||'Unknown'}`,c=p.internalChampions[ckey]||={name:mp.championName||'Unknown',championKey:mp.championKey||mp.championName,championId:num(mp.championId),role:role||'UNKNOWN',games:0,wins:0,kills:0,deaths:0,assists:0,damageTotal:0,goldTotal:0};c.games++;c.wins+=Number(!!mp.win);for(const key of ['kills','deaths','assists'])c[key]+=num(mp[key]);c.damageTotal+=num(mp.damage);c.goldTotal+=num(mp.gold);
        const afterOverall=overall(model),applied=r?appliedRole(model,role,r):null,assignedBefore=pre.get(e.id).assignedRating;model.history.push({gameId:String(m.gameId),seriesId:m.seriesId,time:num(m.gameCreation),version:VERSION,role,comparisonStatus,internalGamesBefore,soloRetention:soloRetentionBefore,win:!!mp.win,before:Math.round(model.overall),after:Math.round(afterOverall),change:Math.round(afterOverall)-Math.round(model.overall),roleBefore:Math.round(assignedBefore),roleAfter:r?Math.round(applied.rating):null,roleChange:r?Math.round(applied.rating)-Math.round(assignedBefore):0,evidenceRoleBefore:Math.round(before),evidenceRoleAfter:r?Math.round(r.rating):null,calibrationChange:r?Number(((applied.rating-r.rating)-(assignedBefore-before)).toFixed(1)):0,calibrationDiscount:applied?Math.round(r.rating)-Math.round(applied.rating):0,roleEvidenceShare:applied?.roleEvidenceShare??0,expected:Number(expected.toFixed(3)),performance:Number(obs.signal.toFixed(3)),expectedPerformance:opponent?Number(expectedPerformance.toFixed(3)):null,residual:Number(residual.toFixed(3)),opponentId:opponent?.p.id||null,opponentPower:opponent?Math.round(pre.get(opponent.id).assignedRating):null,opponentEvidencePower:opponent?Math.round(pre.get(opponent.id).rating):null,personalChange:Number(personal.toFixed(1)),outcomeChange:Number(outcome.toFixed(1)),priorChange:Number(priorChange.toFixed(1)),acceleration,quality:Number(obs.quality.toFixed(2)),supportEngagement:obs.supportEngagement??null,supportUtilityCap:obs.supportUtilityCap??null,observationTarget:obs.target===null?null:Math.round(obs.target),contextAdjustment:Math.round(obs.contextAdjustment||0),estimatedTarget:r?.estimatedTarget==null?null:Math.round(r.estimatedTarget),evidenceSeries:r?.evidenceSeries||0,priorShare:r?.priorShare??1,reason:!role?'unconfirmed':!opponent?'no-opponent':obs.quality<.65?'low-quality':applied.rating-assignedBefore>1?'above':applied.rating-assignedBefore<-1?'below':'expected',metrics:obs.metrics});model.overall=afterOverall;
      }
      diagnostics.matches++;
    }
    for(const p of players){const model=models.get(String(p.id)),roles={};for(const role of ROLES)ensureRole(p,role);for(const [role,r] of Object.entries(model.roles)){const applied=appliedRole(model,role,r);roles[role]={rating:Math.round(applied.rating),evidenceRating:Math.round(r.rating),transferAnchor:Math.round(r.transferAnchor),transferBaseline:Math.round(applied.transferBaseline),calibrationDiscount:Math.round(r.rating)-Math.round(applied.rating),calibrationTarget:Math.round(applied.calibrationTarget),roleEvidenceShare:applied.roleEvidenceShare,calibrationStatus:applied.calibrationStatus,observedSeries:r.observedSeries.size,observedOpponents:r.observedOpponents.size,provisional:isProvisional(r),seed:Math.round(r.seed),seedSource:r.seedSource,estimatedTarget:r.estimatedTarget===null?null:Math.round(r.estimatedTarget),evidenceSeries:r.evidenceSeries,priorShare:r.priorShare,soloRetention:soloRetention(model.games,r.games),comparisons:r.comparisons,games:r.games,wins:r.wins,confidence:Number(r.confidence.toFixed(3)),uncertainty:r.uncertainty,opponents:r.opponents.size,series:r.series.size,recentResidual:Number(mean(r.recent.slice(-5)).toFixed(3)),expectedTotal:r.expectedTotal,performanceTotal:r.performanceTotal};if(r.games)p.internalRoles[role]={...roles[role]};}p.ratingV2={version:VERSION,overall:Math.round(model.overall),roles,unconfirmed:model.unconfirmed,seed:model.seed,seedSource:model.profile.source,soloSeed:model.profile.solo,overallMethod:'observed-skill',referenceVersion:REFERENCE.version,soloRetention:soloRetention(model.games),soloRestorationEnded:soloRetention(model.games)===0,comparisonCount:Object.values(model.roles).reduce((s,r)=>s+r.comparisons,0),provisional:Object.values(roles).filter(r=>r.games).length===0||Object.values(roles).filter(r=>r.games).reduce((s,r)=>s+r.games*r.confidence,0)/Math.max(1,p.internalGames)<.35||new Set(Object.values(model.roles).flatMap(r=>[...r.opponents])).size<3||p.internalGames<8};p.internalRating=Math.round(model.overall);p.ratingUncertainty=Math.round(mean(Object.values(roles).map(r=>r.uncertainty))||330);p.internalKda=p.internalGames?Number(((p.internalKills+p.internalAssists)/Math.max(1,p.internalDeaths)).toFixed(2)):0;p.ratingHistory=model.history.slice(-120);}
    return {players,matches:prepared,diagnostics};
  }
  root.CKRating={VERSION,ROLES,soloRetention,matchupExpectation,initialProfile,isProvisional,confidenceLabel,basePower,overallScore,positionScore,confidence,confirmedRole,playerResolver,prepareMatches,recalculate,offRoleEstimate,reference:REFERENCE};
})(globalThis);
