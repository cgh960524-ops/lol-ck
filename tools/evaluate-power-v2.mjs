import {readFile,writeFile} from 'node:fs/promises';
import vm from 'node:vm';
import {resolve,join} from 'node:path';
import '../rating-engine.js';
const dir=resolve(process.argv.slice(2).find(x=>!x.startsWith('--'))||'../backup/2026-09-16T20-51-42-666Z-before-role-power-v2');
const state=JSON.parse(await readFile(join(dir,'app-state.json'),'utf8')),matches=JSON.parse(await readFile(join(dir,'internal-matches.json'),'utf8'));
const legacy=await readFile(join(dir,'production-client.js'),'utf8'),store=new Map([['naejeon-lab-players-v1',JSON.stringify(state.players)],['naejeon-lab-matches-v1',JSON.stringify(matches)],['naejeon-lab-series-v1',JSON.stringify(state.seriesState)]]);
const ctx=vm.createContext({Intl,Date,console,setTimeout:()=>0,clearTimeout:()=>{},queueMicrotask:()=>{},document:{querySelector:()=>null},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}});
vm.runInContext(legacy.slice(0,legacy.indexOf('function renderPlayers'))+'\nrecalculateRatings();globalThis.old={players,internalMatches,positionScore,overallScore};',ctx,{timeout:30000});
const old=ctx.old;
const start=performance.now();
const input=structuredClone(state.players),result=CKRating.recalculate(input,matches,state.seriesState);
const rows=result.players.filter(p=>p.internalGames).map(p=>{const previous=old.players.find(x=>x.id===p.id),roles=Object.fromEntries(Object.entries(p.ratingV2.roles).map(([role,r])=>[role,`${old.positionScore(previous,role)} → ${r.rating} (${r.games}경기, ${Math.round(r.confidence*100)}%)`]));return {name:p.name,before:old.overallScore(previous),after:CKRating.overallScore(p),delta:CKRating.overallScore(p)-old.overallScore(previous),roles};}).sort((a,b)=>b.after-a.after);
function evaluate(players){const entries=players.flatMap(p=>p.ratingHistory.map(h=>({...h,id:p.id}))),games=new Map();for(const m of matches){const p=m.participants.find(x=>x.teamId===100),find=CKRating.playerResolver(players),h=entries.find(h=>h.gameId===String(m.gameId)&&h.id===find(p)?.id);if(h)games.set(String(m.gameId),{p:h.expected,y:p.win?1:0,t:m.gameCreation});}const sample=[...games.values()].sort((a,b)=>a.t-b.t).slice(-50),avg=xs=>xs.reduce((s,x)=>s+x,0)/xs.length;return {n:sample.length,brier:avg(sample.map(g=>(g.p-g.y)**2)),accuracy:avg(sample.map(g=>Number((g.p>=.5)===(g.y===1))))};}
const original=structuredClone(result.players),sensitive=structuredClone(state.players),p9=sensitive.find(p=>p.name==='9 Things');p9.ratingSeedV2={value:1950,source:'unknown-population'};CKRating.recalculate(sensitive,matches,state.seriesState);
const report={version:CKRating.VERSION,durationMs:Math.round(performance.now()-start),diagnostics:result.diagnostics,legacyPrediction:evaluate(old.players),newPrediction:evaluate(original),sensitivity:{player:'9 Things',normal:CKRating.overallScore(original.find(p=>p.name==='9 Things')),seed1950:CKRating.overallScore(sensitive.find(p=>p.name==='9 Things'))},notes:['Retrospective reconstruction uses currently saved identities, solo seeds and role corrections. Not independent proof of skill accuracy.','No production mutations.'],rows};
console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--report'))await writeFile(join(dir,'power-v2-comparison.json'),JSON.stringify(report,null,2));
