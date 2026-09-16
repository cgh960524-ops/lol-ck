import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import './rating-engine-v23.js';
import {features} from '../rating-observation.js';
const dir=resolve(process.argv[2]),state=JSON.parse(await readFile(join(dir,'app-state.json'),'utf8')),matches=JSON.parse(await readFile(join(dir,'internal-matches.json'),'utf8'));
const all=CKRatingV23.prepareMatches(state.players,matches,state.seriesState).filter(m=>m.duration>=300),series=[...new Set(all.map(m=>m.seriesId))],trainingIds=new Set(series.slice(0,Math.floor(series.length*.60))),train=all.filter(m=>trainingIds.has(m.seriesId)),cutoff=Math.max(...train.map(m=>m.gameCreation));
if(all.some(m=>!trainingIds.has(m.seriesId)&&m.gameCreation<=cutoff))throw new Error('Interleaved series would leak into chronological holdout');
const values=new Map();for(const m of train)for(const p of m.participants){const r=CKRatingV23.confirmedRole(p);if(!r)continue;for(const [key,v] of Object.entries(features(p,m)))for(const c of ['*',p.championKey||p.championName]){const k=`${r}|${c}|${key}`,a=values.get(k)||[];a.push(v);values.set(k,a);}}
const cells={};for(const [key,a] of values){const mean=a.reduce((s,x)=>s+x,0)/a.length,sd=Math.sqrt(a.reduce((s,x)=>s+(x-mean)**2,0)/a.length);cells[key]={n:a.length,mean:Number(mean.toFixed(6)),scale:Number(Math.max(.18,sd).toFixed(6))};}
const ref={version:'observed-skill-reference-v1',center:1500,spread:650,cutoff,trainingMatches:train.length,trainingSeries:trainingIds.size,holdoutMatches:all.length-train.length,sourceHash:createHash('sha256').update(JSON.stringify(train)).digest('hex'),cells};
await writeFile(new URL('../rating-reference.js',import.meta.url),'// Generated frozen calibration. Rebuild only for an explicit, versioned model migration.\nexport default '+JSON.stringify(ref)+';\n');
console.log(JSON.stringify({...ref,cells:Object.keys(cells).length}));
