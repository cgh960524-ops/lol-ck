import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
const localSaveQueues=new Map();

const blobToken = process.env.BLOB_READ_WRITE_TOKEN || "";
const blobPrefix = process.env.BLOB_PREFIX || "ck-lab-data";

async function blobModule() {
  if (!blobToken) return null;
  return import("@vercel/blob");
}

const jsonBody=value=>JSON.stringify(value,null,2);
const bodyVersion=body=>createHash("sha256").update(body).digest("hex");
const queueLocalWrite=(localFile,operation)=>{
  const previous=localSaveQueues.get(localFile)||Promise.resolve();
  const job=previous.catch(()=>{}).then(operation);
  localSaveQueues.set(localFile,job);
  return job.finally(()=>{if(localSaveQueues.get(localFile)===job)localSaveQueues.delete(localFile)});
};

export async function loadJson(name, localFile, fallback) {
  const blob = await blobModule();
  if (blob) {
    const pathname = `${blobPrefix}/${name}.json`;
    const result = await blob.get(pathname, { access: "private", useCache: false, token: blobToken });
    if (result?.statusCode === 200) return new Response(result.stream).json();
  }
  try {
    const localValue = JSON.parse(await readFile(localFile, "utf8"));
    if (blob) await blob.put(`${blobPrefix}/${name}.json`, JSON.stringify(localValue, null, 2), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json; charset=utf-8", token: blobToken });
    return localValue;
  }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

export async function saveJson(name, localFile, value) {
  const body = jsonBody(value);
  const blob = await blobModule();
  if (blob) {
    await blob.put(`${blobPrefix}/${name}.json`, body, {
      access: "private", addRandomSuffix: false, allowOverwrite: true,
      contentType: "application/json; charset=utf-8", token: blobToken,
    });
    return;
  }
  // Serialize local snapshots and tolerate transient Windows reader/AV locks.
  await queueLocalWrite(localFile,async()=>{
    await mkdir(dirname(localFile), { recursive: true });
    const temp=`${localFile}.${randomUUID()}.tmp`;
    await writeFile(temp,body,"utf8");
    for(let attempt=0;;attempt++){
      try{await rename(temp,localFile);break}
      catch(error){if(!["EPERM","EBUSY","EACCES"].includes(error.code)||attempt>=5)throw error;await new Promise(resolve=>setTimeout(resolve,20*(attempt+1)))}
    }
  });
}

// Versioned helpers are used for serverless jobs that must claim a single
// fixed Blob pathname before an external API call. Vercel Blob's ETag/ifMatch
// gives us optimistic concurrency across separate function instances.
export async function loadJsonVersioned(name,localFile,fallback){
  const blob=await blobModule();
  if(blob){
    const result=await blob.get(`${blobPrefix}/${name}.json`,{access:"private",useCache:false,token:blobToken});
    if(!result)return {value:fallback,version:null};
    return {value:await new Response(result.stream).json(),version:result.blob.etag};
  }
  try{const body=await readFile(localFile,"utf8");return {value:JSON.parse(body),version:bodyVersion(body)}}
  catch(error){if(error.code==="ENOENT")return {value:fallback,version:null};throw error}
}

export async function createJsonIfAbsent(name,localFile,value){
  const body=jsonBody(value),blob=await blobModule();
  if(blob){
    try{
      const result=await blob.put(`${blobPrefix}/${name}.json`,body,{access:"private",addRandomSuffix:false,allowOverwrite:false,contentType:"application/json; charset=utf-8",token:blobToken});
      return {created:true,version:result.etag};
    }catch(error){
      // The SDK does not expose a dedicated "already exists" error for every
      // store version. Re-read origin: an existing object means this caller
      // lost the claim race; otherwise preserve the real storage failure.
      const current=await blob.get(`${blobPrefix}/${name}.json`,{access:"private",useCache:false,token:blobToken});
      if(current)return {created:false,version:current.blob.etag};
      throw error;
    }
  }
  return queueLocalWrite(localFile,async()=>{
    await mkdir(dirname(localFile),{recursive:true});
    try{await writeFile(localFile,body,{encoding:"utf8",flag:"wx"});return {created:true,version:bodyVersion(body)}}
    catch(error){if(error.code!=="EEXIST")throw error;const current=await readFile(localFile,"utf8");return {created:false,version:bodyVersion(current)}}
  });
}

export async function compareAndSwapJson(name,localFile,expectedVersion,value){
  if(!expectedVersion)return {updated:false,version:null};
  const body=jsonBody(value),blob=await blobModule();
  if(blob){
    try{
      const result=await blob.put(`${blobPrefix}/${name}.json`,body,{access:"private",addRandomSuffix:false,allowOverwrite:true,ifMatch:expectedVersion,contentType:"application/json; charset=utf-8",token:blobToken});
      return {updated:true,version:result.etag};
    }catch(error){
      if(error instanceof blob.BlobPreconditionFailedError)return {updated:false,version:null};
      throw error;
    }
  }
  return queueLocalWrite(localFile,async()=>{
    let current;
    try{current=await readFile(localFile,"utf8")}catch(error){if(error.code==="ENOENT")return {updated:false,version:null};throw error}
    if(bodyVersion(current)!==expectedVersion)return {updated:false,version:bodyVersion(current)};
    const temp=`${localFile}.${randomUUID()}.tmp`;
    await writeFile(temp,body,"utf8");await rename(temp,localFile);
    return {updated:true,version:bodyVersion(body)};
  });
}

export const stateFiles = root => ({
  matches: process.env.DATA_FILE || join(root, "data", "internal-matches.json"),
  appState: process.env.APP_STATE_FILE || join(root, "data", "app-state.json"),
  runtime: process.env.RUNTIME_CONFIG_FILE || join(root, "data", "runtime-config.json"),
});
