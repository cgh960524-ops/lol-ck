// Operational assumptions for private match balancing, not an official Riot MMR.
export const ROLES=['TOP','JUNGLE','MID','ADC','SUPPORT'];
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const n=x=>Number.isFinite(Number(x))?Number(x):0;
const TIERS={IRON:800,BRONZE:950,SILVER:1100,GOLD:1250,PLATINUM:1420,EMERALD:1580,DIAMOND:1780,MASTER:2050,GRANDMASTER:2200,CHALLENGER:2380};
const high=t=>['MASTER','GRANDMASTER','CHALLENGER'].includes(t);
export function roleEvidence(counts={}){
 const rows=ROLES.map(r=>[r,Math.max(0,n(counts[r]))]).sort((a,b)=>b[1]-a[1]),total=rows.reduce((s,x)=>s+x[1],0);
 const primary=total>=10&&rows[0][1]>=5?rows[0][0]:null;
 const secondary=primary&&rows[1][1]>=5&&rows[1][1]/total>=.20?rows[1][0]:null;
 return {primary,secondary,total,counts:Object.fromEntries(rows),verified:!!primary};
}
export function makeSoloEvidence({tier,division,lp,wins,losses,roleGames,sampleStart,sampleEnd,sampledGames},observedAt=Date.now()){
 return {source:'riot-solo-420',observedAt,tier:tier||'UNRANKED',division:division||'',lp:n(lp),seasonGames:n(wins)+n(losses),sampledGames:n(sampledGames),sampleStart:n(sampleStart),sampleEnd:n(sampleEnd),roles:roleEvidence(roleGames)};
}
export function mergeSoloEvidence(old=[],next){
 const rows=[...(Array.isArray(old)?old:[]),...(next?.source==='riot-solo-420'?[next]:[])];
 return [...new Map(rows.map(x=>[x.observedAt,x])).values()].sort((a,b)=>a.observedAt-b.observedAt).slice(-100);
}
// The 50-game rule is deliberately role-local. An unrelated role cannot disprove a peak.
export function peakTrust(current,peak){
 if(!peak||!high(peak.tier)||!peak.roles?.verified)return 0;
 const same=current?.roles?.verified&&current.roles.primary===peak.roles.primary;
 if(!same||!['PLATINUM','EMERALD'].includes(current.tier))return 1;
 return 1-.85*clamp((n(current.seasonGames)-20)/30,0,1);
}
export function evidencePolicy(current,history=[]){
 const peaks=history.filter(x=>x.source==='riot-solo-420'&&high(x.tier)&&x.roles?.verified&&x.observedAt<=current?.observedAt);
 const peak=peaks.sort((a,b)=>(TIERS[b.tier]-TIERS[a.tier])||b.observedAt-a.observedAt)[0];
 const trust=high(current?.tier)?1:peakTrust(current,peak);
 return {current,peak,trust,highTier:high(current?.tier)||trust>0,origin:high(current?.tier)?current?.roles?.primary:peak?.roles.primary,roleVerified:high(current?.tier)?!!current?.roles?.verified:!!peak?.roles?.verified};
}
export function initialV4Profile(p,legacy){
 if(p.ratingSeedV4?.policy==='matchup-v4')return p.ratingSeedV4;
 const current=p.soloEvidence?.source==='riot-solo-420'?p.soloEvidence:{source:'legacy-registration',tier:p.tier,seasonGames:n(p.soloWins)+n(p.soloLosses),roles:roleEvidence(p.roleGames),observedAt:0};
 const policy=evidencePolicy(current,p.soloEvidenceHistory||[]),e=current.roles;
 const primary=e.primary||legacy.primary,secondary=e.secondary||null;
 // Preserve an existing documented, role-local legacy peak; do not invent its season or lane.
 const solo=TIERS[current.tier]??legacy.solo??1450;
 const peakBase=policy.peak?TIERS[policy.peak.tier]:solo;
 const mainBase=solo,peakRole=policy.peak?.roles.primary;
 const historicalBase=solo+Math.max(0,peakBase-solo)*policy.trust*.65;
 const transferByOrigin={TOP:.60,JUNGLE:.70,MID:.65,ADC:.60,SUPPORT:.18};
 const roles={};
 for(const role of ROLES){
  let rating=role===primary?mainBase:role===secondary?mainBase-80:mainBase-clamp(mainBase*.12,150,300);
  if(high(current.tier)&&role!==primary){
   const transfer=transferByOrigin[primary]||.4;
   rating=1450+Math.max(0,mainBase-1450)*(role===secondary?.85:transfer);
  }
  // A historical peak belongs to its recorded role, never the current main by accident.
  if(peakRole&&!high(current.tier)){
   const historyRating=role===peakRole?historicalBase:1450+Math.max(0,historicalBase-1450)*(transferByOrigin[peakRole]||.4);
   rating=Math.max(rating,historyRating);
  }
  const oldPeak=n(legacy.roles[role]?.peak);
  if(!policy.peak&&oldPeak>rating&&role===primary)rating+=(oldPeak-rating)*.5;
  roles[role]={rating:clamp(rating,400,3200),base:clamp(rating,400,3200),peak:oldPeak||null,source:role===primary?'solo-role-estimate':'role-transfer'};
 }
 return {policy:'matchup-v4',solo,primary,secondary,roles,source:e.verified?'riot-role-evidence':'legacy-role-unverified',roleVerified:!!e.verified,highTier:policy.highTier,highTrust:policy.trust,highOrigin:policy.origin||primary,currentEvidence:current,peakEvidence:policy.peak||null};
}
export function learningFactor(profile,role,current=null,history=[]){
 let policy=current?evidencePolicy(current,history):{highTier:profile.highTier,trust:profile.highTrust,origin:profile.highOrigin};
 // Missing historical lane evidence cannot be fabricated from the latest lane sample.
 // Keep the known tier's slow adjustment until a comparable peak/current pair exists.
 if(current&&!policy.highTier&&profile.highTier&&!profile.roleVerified)policy={highTier:true,trust:profile.highTrust,origin:profile.highOrigin};
 if(!policy.highTier)return 1;
 const transfer=policy.origin==='SUPPORT'&&role!=='SUPPORT'?.20:role===policy.origin?1:.70;
 return 1-.55*policy.trust*transfer;
}
export function matchupUpdate({before,opponent,opponentConfidence=0,signal,pairedSignal,quality=1,comparisons=0,repeat=0,opponentSeries=0,learning=1,metrics=[],opponentMetrics=[]}){
 const gap=before-opponent,expected=Math.tanh(gap/650),actual=Math.tanh(pairedSignal);
 const residual=actual-expected;
 const reliability=.35+.65*clamp(opponentConfidence,0,1);
 const repeatFactor=1/Math.sqrt(1+repeat),opponentFactor=1/Math.sqrt(1+Math.max(0,opponentSeries-2)*.12);
 const rate=(comparisons<8?100:70)*quality*repeatFactor*opponentFactor*learning;
 // Surviving a stronger lane alone is not proof of carrying it. Require participation
 // plus at least one independent useful contribution, and keep defensive gains small.
 const defensive=gap<0&&pairedSignal<0&&residual>0;
 const opponentDefensive=gap>0&&pairedSignal>0&&residual<0;
 const defensiveMetrics=opponentDefensive?opponentMetrics:metrics;
 const useful=defensiveMetrics.filter(m=>['fight','efficiency','control','vision','objective','protection'].includes(m.key)&&m.signal>0).length;
 const fight=defensiveMetrics.find(m=>m.key==='fight')?.signal??0;
 const defensiveFactor=(defensive||opponentDefensive)?(fight>=0&&useful>=2?.45:.15):1;
 const rawMatchupChange=rate*.9*reliability*clamp(residual,-1.5,1.5)*defensiveFactor;
 const matchupChange=(defensive||opponentDefensive)?clamp(rawMatchupChange,-8*learning,8*learning):rawMatchupChange;
 // Small bounded absolute anchor fixes the point scale; it is not a standalone target.
 const referenceChange=rate*.1*clamp((1500+650*signal-before)/650,-.5,.5);
 const change=clamp(matchupChange+referenceChange,-60*learning,60*learning);
 return {change,matchupChange,referenceChange,capAdjustment:change-matchupChange-referenceChange,expected,actual,residual,reliability,repeatFactor,opponentFactor,learning,defensive,defensiveFactor};
}
export const ROLE_IMPACT={TOP:.15,JUNGLE:.28,MID:.20,ADC:.15,SUPPORT:.22};
export function predictTeams(blue,red){
 const value=x=>n(x.power??x.rating),role=x=>x.assigned||x.role;
 const total=a=>a.reduce((s,x)=>s+value(x),0),logistic=d=>1/(1+10**(-d/400));
 const averageDiff=(total(blue)-total(red))/5,teamProbability=logistic(averageDiff);
 const diffs=ROLES.map(r=>{const a=blue.filter(x=>role(x)===r),b=red.filter(x=>role(x)===r);return a.length===1&&b.length===1?value(a[0])-value(b[0]):averageDiff;});
 const laneProbability=ROLES.reduce((s,r,i)=>s+logistic(diffs[i])*ROLE_IMPACT[r],0);
 const largeGapAdjustment=ROLES.reduce((s,r,i)=>s+Math.sign(diffs[i])*clamp((Math.abs(diffs[i])-250)/500,0,1)*ROLE_IMPACT[r]*.12,0);
 return {blueWinRate:clamp(teamProbability*.7+laneProbability*.3+largeGapAdjustment,.08,.92),teamProbability,laneProbability,largeGapAdjustment};
}
