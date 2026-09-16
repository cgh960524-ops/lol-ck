import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const dir=resolve('../backup',new Date().toISOString().replace(/[:.]/g,'-')+'-before-skill-baseline-v22');
await mkdir(dir,{recursive:true});
const hashes={};
for(const [path,name] of [['/api/app-state','app-state.json'],['/api/internal-matches','internal-matches.json'],['/client.js','production-client.js'],['/rating-engine.js','production-rating-engine.js']]){
 const r=await fetch('https://lol-ck.vercel.app'+path,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(path+': '+r.status);
 const value=await r.text();await writeFile(join(dir,name),value);hashes[name]=createHash('sha256').update(value).digest('hex');
}
execFileSync('git',['archive','--format=zip','--output='+join(dir,'source.zip'),'HEAD']);
const state=JSON.parse(await readFile(join(dir,'app-state.json'),'utf8')),matches=JSON.parse(await readFile(join(dir,'internal-matches.json'),'utf8'));
const manifest={createdAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes,players:state.players.length,matches:matches.length};
await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({dir,...manifest}));
