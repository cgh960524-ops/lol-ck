import REFERENCE from './rating-reference.js';
import {observe} from './rating-observation.js?v=20260918-v41';
import {bottomDuoChange,initialV4Profile,learningFactor,matchupUpdate,predictTeams} from './rating-policy.js?v=20260918-v41';
/* Shared, deterministic browser/server role-skill estimator. No I/O or POG bonuses. */
(function (root) {
  'use strict';
  const VERSION = 'matchup-skill-v4.1.20260918';
  const LEGACY_HISTORY_VERSION = 'matchup-skill-v4.20260917';
  // One-time retrospective boundary requested on 2026-09-18. These are the
  // six games in the latest two unique completed series at rollout time.
  // Future games use the same rule; every earlier game remains on V4.
  const BOTTOM_DUO_RETRO_GAMES = new Set(['8384626565','8384710566','8384776330','8384824997','8384857598','8384886434']);
  const BOTTOM_DUO_FORWARD_AFTER = 1789668737914;
  const usesBottomDuo=m=>BOTTOM_DUO_RETRO_GAMES.has(String(m.gameId))||num(m.gameCreation)>BOTTOM_DUO_FORWARD_AFTER;
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
    const profile=initialV4Profile(p,initialProfile(p));
    return Math.round(profile.roles[role]?.rating??overallScore(p));
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
      return {...m,seriesId:c?.seriesId||`session:${new Date(num(m.gameCreation)+3*3600000).toISOString().slice(0,10)}:${m.participants.map(mp=>String(find(mp)?.id||norm(mp.gameName,mp.tagLine))).sort().join(',')}`,seriesSource:c?'confirmed':'inferred-session',ratingSnapshot:c?.snapshot,participants:m.participants.map(mp=>{const role=c?.roles.get(String(find(mp)?.id)),manual=historical.find(([name])=>String(mp.gameName||'').replace(/\s/g,'').toLowerCase().startsWith(name.toLowerCase()));return ROLES.includes(role)?{...mp,role,roleSource:'series-confirmed'}:manual?{...mp,role:manual[1],roleSource:'manual'}:{...mp};})};
    }).sort((a,b)=>num(a.gameCreation)-num(b.gameCreation)||String(a.gameId).localeCompare(String(b.gameId)));
  }
  const confirmedRole = mp => SOURCES.has(mp.roleSource)&&ROLES.includes(mp.role)?mp.role:null;
  const performance=(mp,opp,m,role)=>observe(mp,opp,m,role,REFERENCE);
  function recalculate(players,matches,seriesState={}) {
    const find=playerResolver(players),prepared=prepareMatches(players,matches,seriesState),models=new Map();
    const diagnostics={version:VERSION,matches:0,unmatched:0,unconfirmed:0,duplicateLinks:0,lowQuality:0,inferredSessions:new Set(),bottomDuoAdjusted:0,bottomDuoGames:new Set()};
    for(const p of players){
      if(p.ratingSeedV22?.policy!=='skill-baseline-v1')p.ratingSeedV22=initialProfile(p);
      if(p.ratingSeedV4?.policy!=='matchup-v4')p.ratingSeedV4=initialV4Profile(p,p.ratingSeedV22);
      const profile=p.ratingSeedV4,seed=profile.roles[profile.primary].rating;
      models.set(String(p.id),{profile,seed,roles:{},games:0,overall:seed,history:[],unconfirmed:0});
      p.internalGames=0;p.internalRoles={};p.internalChampions={};p.internalKills=0;p.internalDeaths=0;p.internalAssists=0;p.internalKda=0;p.internalChampionScore=0;p.ratingHistory=[];
    }
    function ensureRole(p,role,time=Infinity){
      const model=models.get(String(p.id));
      if(!model.roles[role]){
        const latest=(p.soloEvidenceHistory||[]).filter(x=>x.source==='riot-solo-420'&&x.observedAt<=time).sort((a,b)=>a.observedAt-b.observedAt).at(-1);
        const active=latest?initialV4Profile({...p,ratingSeedV4:undefined,soloEvidence:latest},p.ratingSeedV22):model.profile;
        const prior=active.roles[role],mature=model.games>=30&&!active.highTier;
        const seed=mature?Math.min(prior.rating,model.overall):prior.rating;
        model.roles[role]={rating:seed,seed,seedSource:mature?'internal-transfer':prior.source,games:0,comparisons:0,wins:0,weight:0,confidence:0,uncertainty:330,opponents:new Set(),series:new Set(),seriesGames:new Map(),opponentSeries:new Map(),recent:[],expectedTotal:0,performanceTotal:0,lastLearning:learningFactor(model.profile,role),estimatedTarget:null};
      }
      return model.roles[role];
    }
    const overall=model=>{
      const rs=Object.values(model.roles).filter(r=>r.comparisons),total=rs.reduce((s,r)=>s+Math.sqrt(r.weight),0);
      return total?rs.reduce((s,r)=>s+r.rating*Math.sqrt(r.weight),0)/total:model.seed;
    };
    for(const m of prepared){
      if(num(m.duration)<300)continue;
      if(m.seriesSource==='inferred-session')diagnostics.inferredSessions.add(m.seriesId);
      const seen=new Set(),entries=[];
      for(const mp of m.participants){
        const p=find(mp);if(!p){diagnostics.unmatched++;continue;}
        const id=String(p.id);if(seen.has(id)){diagnostics.duplicateLinks++;continue;}seen.add(id);
        const role=confirmedRole(mp),model=models.get(id),r=role?ensureRole(p,role,num(m.gameCreation)):null;
        entries.push({id,p,mp,role,model,r});
      }
      const sides=[100,200].map(id=>entries.filter(x=>x.mp.teamId===id));
      if(!sides[0].length||!sides[1].length)continue;
      const pre=new Map(entries.map(e=>[e.id,{rating:e.r?.rating??e.model.overall,confidence:e.r?.confidence||0}]));
      const prediction=predictTeams(...sides.map(side=>side.map(e=>({role:e.role,power:pre.get(e.id).rating}))));
      const pending=[];
      for(const e of entries){
        const {mp,p,role,r,model}=e,own=m.participants.filter(x=>x.teamId===mp.teamId&&confirmedRole(x)===role);
        const rivals=m.participants.filter(x=>x.teamId!==mp.teamId&&confirmedRole(x)===role);
        const candidates=entries.filter(x=>x.mp.teamId!==mp.teamId&&x.role===role);
        const opponent=role&&own.length===1&&rivals.length===1&&candidates.length===1?candidates[0]:null;
        const comparisonStatus=!role?'role-unconfirmed':own.length!==1?'own-role-ambiguous':rivals.length>1?'opponent-role-ambiguous':rivals.length===0?'opponent-role-unconfirmed':!opponent?'opponent-unlinked':'matched';
        const obs=performance(mp,opponent?.mp,m,role),before=pre.get(e.id).rating;
        const valid=!!opponent&&obs.target!==null&&obs.quality>=.65;
        const known=(p.soloEvidenceHistory||[]).filter(x=>x.source==='riot-solo-420'&&x.observedAt<=num(m.gameCreation)).sort((a,b)=>a.observedAt-b.observedAt);
        const learning=learningFactor(model.profile,role,known.at(-1)||null,known);
        const repeat=r?.seriesGames.get(m.seriesId)||0,opponentSeries=opponent?(r.opponentSeries.get(opponent.id)?.size||0):0;
        const update=valid?matchupUpdate({before,opponent:pre.get(opponent.id).rating,opponentConfidence:pre.get(opponent.id).confidence,signal:obs.signal,pairedSignal:obs.pairedSignal,quality:obs.quality,comparisons:r.comparisons,repeat,opponentSeries,learning,metrics:obs.metrics,opponentMetrics:performance(opponent.mp,mp,m,role).metrics}):null;
        pending.push({e,obs,before,opponent,comparisonStatus,valid,update,learning,repeat,expected:mp.teamId===100?prediction.blueWinRate:1-prediction.blueWinRate});
      }
      const duoContexts=new Map();
      if(usesBottomDuo(m))for(const step of pending){
        const role=step.e.role;if(!step.valid||!['ADC','SUPPORT'].includes(role))continue;
        const partnerRole=role==='ADC'?'SUPPORT':'ADC';
        const teammate=pending.find(x=>x.e.mp.teamId===step.e.mp.teamId&&x.e.role===partnerRole);
        const opposingPartner=pending.find(x=>x.e.mp.teamId!==step.e.mp.teamId&&x.e.role===partnerRole);
        if(!teammate?.valid||!opposingPartner?.valid)continue;
        const individualChange=clamp(step.before+step.update.change,400,3200)-step.before;
        const teammateChange=clamp(teammate.before+teammate.update.change,400,3200)-teammate.before;
        duoContexts.set(step.e.id,bottomDuoChange({individualChange,teammateChange,ownPartner:pre.get(teammate.e.id).rating,opponentPartner:pre.get(opposingPartner.e.id).rating}));
      }
      if(duoContexts.size)diagnostics.bottomDuoGames.add(String(m.gameId));
      for(const step of pending){
        const {e,obs,before,opponent,comparisonStatus,valid,update,learning,repeat,expected}=step,{mp,p,role,r,model}=e;
        const baseChange=valid?clamp(before+update.change,400,3200)-before:0,duoContext=duoContexts.get(e.id);
        const change=duoContext?clamp(before+duoContext.change,400,3200)-before:baseChange,oldOverall=model.overall,internalGamesBefore=model.games;
        if(duoContext)diagnostics.bottomDuoAdjusted++;
        if(r){
          r.games++;r.wins+=Number(!!mp.win);r.expectedTotal+=expected;r.performanceTotal+=obs.signal;r.lastLearning=learning;
          if(valid){
            r.rating=clamp(before+change,400,3200);r.comparisons++;
            r.opponents.add(opponent.id);r.series.add(m.seriesId);r.seriesGames.set(m.seriesId,repeat+1);
            const os=r.opponentSeries.get(opponent.id)||new Set();os.add(m.seriesId);r.opponentSeries.set(opponent.id,os);
            r.weight+=obs.quality/(1+repeat);r.recent.push(update.residual);
            r.estimatedTarget=clamp(before+650*update.residual,400,3200);
            const diversity=.35+.65*Math.min(1,r.opponents.size/5);
            r.confidence=clamp(r.weight/(r.weight+8)*diversity*Math.min(1,r.series.size/3),0,.94);
            r.uncertainty=Math.round(330-295*r.confidence);
          }else if(opponent)diagnostics.lowQuality++;
        }else{diagnostics.unconfirmed++;model.unconfirmed++;}
        model.games++;p.internalGames++;p.internalKills+=num(mp.kills);p.internalDeaths+=num(mp.deaths);p.internalAssists+=num(mp.assists);
        const ckey=`${role||'UNKNOWN'}|${mp.championKey||mp.championName||'Unknown'}`;
        const c=p.internalChampions[ckey]||={name:mp.championName||'Unknown',championKey:mp.championKey||mp.championName,championId:num(mp.championId),role:role||'UNKNOWN',games:0,wins:0,kills:0,deaths:0,assists:0,damageTotal:0,goldTotal:0};
        c.games++;c.wins+=Number(!!mp.win);for(const key of ['kills','deaths','assists'])c[key]+=num(mp[key]);c.damageTotal+=num(mp.damage);c.goldTotal+=num(mp.gold);
        model.overall=overall(model);
        model.history.push({gameId:String(m.gameId),seriesId:m.seriesId,seriesSource:m.seriesSource,time:num(m.gameCreation),version:duoContext?VERSION:LEGACY_HISTORY_VERSION,role,comparisonStatus,internalGamesBefore,soloRetention:soloRetention(internalGamesBefore,(r?.games||1)-1),win:!!mp.win,
          before:Math.round(oldOverall),after:Math.round(model.overall),change:Math.round(model.overall)-Math.round(oldOverall),
          roleBefore:Math.round(before),roleAfter:r?Math.round(r.rating):null,roleChange:r?Math.round(r.rating)-Math.round(before):0,
          evidenceRoleBefore:Math.round(before),evidenceRoleAfter:r?Math.round(r.rating):null,calibrationChange:0,calibrationDiscount:0,roleEvidenceShare:r?.confidence||0,
          expected:Number(expected.toFixed(3)),performance:Number(obs.signal.toFixed(3)),expectedPerformance:update?.expected??null,actualMatchup:update?.actual??null,residual:update?.residual??0,
          opponentId:opponent?.p.id||null,opponentPower:opponent?Math.round(pre.get(opponent.id).rating):null,opponentEvidencePower:opponent?Math.round(pre.get(opponent.id).rating):null,
          personalChange:Number(change.toFixed(2)),individualBaseChange:Number(baseChange.toFixed(2)),matchupChange:update?.matchupChange??0,referenceChange:update?.referenceChange??0,capAdjustment:(update?.capAdjustment||0)+baseChange-(update?.change||0),outcomeChange:0,priorChange:0,acceleration:learning,
          opponentReliability:update?.reliability??0,repeatFactor:update?.repeatFactor??0,opponentFactor:update?.opponentFactor??0,defensive:update?.defensive||false,defensiveFactor:update?.defensiveFactor??1,
          quality:Number(obs.quality.toFixed(2)),excludedMetrics:obs.excludedMetrics||[],supportEngagement:obs.supportEngagement??null,
          observationTarget:valid?Math.round(r.estimatedTarget):null,contextAdjustment:Number((change-baseChange).toFixed(2)),duoContextApplied:!!duoContext,duoChange:duoContext?Number(duoContext.duoChange.toFixed(2)):null,partnerAdjustment:duoContext?Number(duoContext.partnerAdjustment.toFixed(2)):null,estimatedTarget:r?.estimatedTarget==null?null:Math.round(r.estimatedTarget),evidenceSeries:r?.series.size||0,priorShare:0,
          reason:!role?'unconfirmed':!opponent?'no-opponent':!valid?'low-quality':change>1?'above':change<-1?'below':'expected',metrics:obs.metrics});
      }
      diagnostics.matches++;
    }
    for(const p of players){
      const model=models.get(String(p.id)),roles={};for(const role of ROLES)ensureRole(p,role);
      for(const [role,r] of Object.entries(model.roles)){
        roles[role]={rating:Math.round(r.rating),evidenceRating:Math.round(r.rating),seed:Math.round(r.seed),seedSource:r.seedSource,transferAnchor:Math.round(r.seed),transferBaseline:Math.round(r.seed),calibrationDiscount:0,calibrationTarget:Math.round(r.rating),roleEvidenceShare:r.confidence,calibrationStatus:r.comparisons?'matchup-observed':'unplayed-estimate',observedSeries:r.series.size,observedOpponents:r.opponents.size,
          provisional:isProvisional({...r,evidenceSeries:r.series.size}),estimatedTarget:r.estimatedTarget==null?null:Math.round(r.estimatedTarget),evidenceSeries:r.series.size,priorShare:0,soloRetention:soloRetention(model.games,r.games),comparisons:r.comparisons,games:r.games,wins:r.wins,confidence:Number(r.confidence.toFixed(3)),uncertainty:r.uncertainty,opponents:r.opponents.size,series:r.series.size,recentResidual:Number(mean(r.recent.slice(-5)).toFixed(3)),expectedTotal:r.expectedTotal,performanceTotal:r.performanceTotal,learningFactor:r.lastLearning};
        if(r.games)p.internalRoles[role]={...roles[role]};
      }
      const played=Object.values(roles).filter(r=>r.comparisons);
      p.ratingV2={version:VERSION,overall:Math.round(model.overall),roles,unconfirmed:model.unconfirmed,seed:model.seed,seedSource:model.profile.source,soloSeed:model.profile.solo,overallMethod:'matchup-relative',referenceVersion:REFERENCE.version,soloRetention:soloRetention(model.games),soloRestorationEnded:soloRetention(model.games)===0,comparisonCount:played.reduce((s,r)=>s+r.comparisons,0),provisional:!played.length||mean(played.map(r=>r.confidence))<.35,roleEvidenceVerified:model.profile.roleVerified,highTier:model.profile.highTier};
      p.internalRating=Math.round(model.overall);p.ratingUncertainty=Math.round(mean(Object.values(roles).map(r=>r.uncertainty))||330);
      p.internalKda=p.internalGames?Number(((p.internalKills+p.internalAssists)/Math.max(1,p.internalDeaths)).toFixed(2)):0;p.ratingHistory=model.history.slice(-120);
    }
    diagnostics.inferredSessions=diagnostics.inferredSessions.size;diagnostics.bottomDuoGames=diagnostics.bottomDuoGames.size;
    return {players,matches:prepared,diagnostics};
  }
  root.CKRating={VERSION,ROLES,soloRetention,matchupExpectation,initialProfile,isProvisional,confidenceLabel,basePower,overallScore,positionScore,confidence,confirmedRole,playerResolver,prepareMatches,recalculate,offRoleEstimate,reference:REFERENCE,predictTeams,bottomDuoRollout:{retroGameIds:[...BOTTOM_DUO_RETRO_GAMES],forwardAfter:BOTTOM_DUO_FORWARD_AFTER}};
})(globalThis);
