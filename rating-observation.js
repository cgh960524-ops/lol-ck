// Observable performance, not a claim to measure shot-calling or innate skill.
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const n=x=>Number(x)||0;
export const WEIGHTS={
 TOP:{growth:.30,efficiency:.20,fight:.10,survival:.08,vision:.03,tank:.12,control:.08,protection:.02,objective:.07},
 JUNGLE:{growth:.30,efficiency:.13,fight:.14,survival:.05,vision:.10,tank:.05,control:.07,protection:.01,objective:.15},
 MID:{growth:.27,efficiency:.28,fight:.18,survival:.08,vision:.06,tank:.03,control:.05,protection:.02,objective:.03},
 ADC:{growth:.30,efficiency:.34,fight:.17,survival:.10,vision:.03,tank:0,control:.02,protection:0,objective:.04},
 SUPPORT:{growth:0,efficiency:.04,fight:.27,survival:.13,vision:.18,tank:.07,control:.12,protection:.16,objective:.03}
};
export const LABELS={growth:'성장',efficiency:'자원 대비 피해',fight:'교전 참여',survival:'생존·참여',vision:'시야',tank:'탱킹',control:'제어',protection:'아군 보호',objective:'오브젝트·포탑'};
export function features(p,m){
 const team=m.participants.filter(x=>x.teamId===p.teamId),mins=Math.max(5,n(m.duration)/60),kills=team.reduce((s,x)=>s+n(x.kills),0),kp=clamp((n(p.kills)+n(p.assists))/Math.max(1,kills),0,1),has=(...ks)=>ks.every(k=>Object.hasOwn(p,k)&&p[k]!==null&&p[k]!==''&&Number.isFinite(Number(p[k]))),f={};
 if(has('gold','cs'))f.growth=Math.log1p(n(p.gold)/mins/60)+.35*Math.log1p(n(p.cs)/mins);
 if(has('damage','gold'))f.efficiency=Math.log1p(n(p.damage)/Math.max(500,n(p.gold)));
 if(has('kills','assists'))f.fight=Math.log1p(kp*4);
 if(has('deaths','kills','assists'))f.survival=Math.log1p((.25+kp)*mins/(n(p.deaths)+2));
 if(has('vision'))f.vision=Math.log1p(n(p.vision)/mins);
 if(has('damageTaken','mitigated','deaths'))f.tank=Math.log1p((n(p.damageTaken)+.6*n(p.mitigated))/mins/500)*(.75+.25*kp);
 if(has('ccTime'))f.control=Math.log1p(n(p.ccTime)/mins);
 if(has('healsOnTeammates','shieldsOnTeammates'))f.protection=Math.log1p((n(p.healsOnTeammates)+n(p.shieldsOnTeammates))/mins/100);
 if(has('objectiveDamage','turretDamage'))f.objective=Math.log1p((.4*n(p.objectiveDamage)+.6*n(p.turretDamage))/mins/250);
 return f;
}
// Raw utility volume is only supporting evidence, not proof of a successful engage.
export function supportSignals(z){
 const out={...z},keys=['vision','tank','control','protection'];
 const engagement=clamp(.7+.2*Math.tanh(z.fight??0)+.1*Math.tanh(z.survival??0),.4,1);
 for(const key of keys)if(out[key]>0)out[key]=1.25*Math.tanh(out[key]/1.25)*engagement;
 const available=Object.keys(z).reduce((s,k)=>s+(WEIGHTS.SUPPORT[k]||0),0);
 const positive=keys.reduce((s,k)=>s+Math.max(0,out[k]||0)*WEIGHTS.SUPPORT[k],0);
 const factor=positive > .30*available ? .30*available/positive : 1;
 for(const key of keys)if(out[key]>0)out[key]*=factor;
 return {signals:out,engagement,utilityCapFactor:factor};
}
export function observe(p,opp,m,role,ref){
 if(!opp||!WEIGHTS[role])return {signal:0,quality:0,metrics:[],championEvidence:0,target:null};
 const a=features(p,m),b=features(opp,m),metrics=[];
 // Leave both compared players out of the team context. Missing gold is not zero.
 const peers=mp=>m.participants.filter(x=>x.teamId===mp.teamId&&x!==mp);
 const ta=peers(p),tb=peers(opp),complete=ta.length===4&&tb.length===4&&[...ta,...tb].every(x=>x.gold!=null&&Number.isFinite(Number(x.gold)));
 const advantage=complete?clamp(Math.log(Math.max(1,ta.reduce((s,x)=>s+n(x.gold),0))/Math.max(1,tb.reduce((s,x)=>s+n(x.gold),0))),-.8,.8):0;
 let total=0,sum=0,pairedTotal=0,evidence=0;const standardized=[];
 for(const [key,w] of Object.entries(WEIGHTS[role])){
  const pool=ref.cells[`${role}|*|${key}`];if(!w||a[key]===undefined||b[key]===undefined||!pool)continue;
  const ca=ref.cells[`${role}|${p.championKey||p.championName}|${key}`],cb=ref.cells[`${role}|${opp.championKey||opp.championName}|${key}`];
  const correction=c=>c?clamp((c.mean-pool.mean)*c.n/(c.n+20),-.25,.25):0;
  const context=['growth','objective'].includes(key)?advantage*.20:0;
  const az=(a[key]-correction(ca)-pool.mean-context)/pool.scale,bz=(b[key]-correction(cb)-pool.mean+context)/pool.scale;
  standardized.push({key,w,az,bz,n:ca?.n||0});
 }
 const supportA=role==='SUPPORT'?supportSignals(Object.fromEntries(standardized.map(x=>[x.key,clamp(x.az,-2.5,2.5)]))):null;
 const supportB=role==='SUPPORT'?supportSignals(Object.fromEntries(standardized.map(x=>[x.key,clamp(x.bz,-2.5,2.5)]))):null;
 for(const {key,w,az,bz,n} of standardized){
  const absolute=supportA?supportA.signals[key]:clamp(az,-2.5,2.5),paired=clamp(supportA?absolute-supportB.signals[key]:az-bz,-3,3);
  sum+=w*absolute;pairedTotal+=w*paired;total+=w;evidence+=w*n;
  metrics.push({key,label:LABELS[key],signal:Number(absolute.toFixed(3)),absolute:Number(absolute.toFixed(3)),rawSignal:Number(clamp(az,-2.5,2.5).toFixed(3)),paired:Number(paired.toFixed(3)),weight:w});
 }
 const signal=total?sum/total:0;
 return {signal,supportEngagement:supportA?.engagement??null,supportUtilityCap:supportA?.utilityCapFactor??null,pairedSignal:total?pairedTotal/total:0,quality:total,metrics,championEvidence:total?evidence/total:0,target:total?clamp(ref.center+ref.spread*signal,650,2850):null};
}
// Each series is a cluster: five identical sets cannot count as five independent opponents.
export function estimate(observations){
 const groups=new Map();for(const x of observations){const g=groups.get(x.seriesId)||{sum:0,w:0,count:0};g.sum+=x.target*x.quality;g.w+=x.quality;g.count++;groups.set(x.seriesId,g);}
 const rows=[...groups.values()].filter(x=>x.w>0).slice(-12).map(x=>({value:x.sum/x.w,quality:x.w/x.count}));
 if(!rows.length)return null;
 const sorted=rows.map(x=>x.value).sort((a,b)=>a-b),mid=sorted.length>>1,median=sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
 let total=0,sum=0;rows.forEach((x,i)=>{const w=x.quality*2**(-(rows.length-1-i)/6);sum+=clamp(x.value,median-450,median+450)*w;total+=w;});
 return {target:sum/total,series:rows.length,weight:total};
}
