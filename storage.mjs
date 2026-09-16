import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
const localSaveQueues=new Map();

const blobToken = process.env.BLOB_READ_WRITE_TOKEN || "";
const blobPrefix = process.env.BLOB_PREFIX || "ck-lab-data";

async function blobModule() {
  if (!blobToken) return null;
  return import("@vercel/blob");
}

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
  const body = JSON.stringify(value, null, 2);
  const blob = await blobModule();
  if (blob) {
    await blob.put(`${blobPrefix}/${name}.json`, body, {
      access: "private", addRandomSuffix: false, allowOverwrite: true,
      contentType: "application/json; charset=utf-8", token: blobToken,
    });
    return;
  }
  // Serialize local snapshots and tolerate transient Windows reader/AV locks.
  const previous=localSaveQueues.get(localFile)||Promise.resolve();
  const job=previous.catch(()=>{}).then(async()=>{
    await mkdir(dirname(localFile), { recursive: true });
    const temp=`${localFile}.${randomUUID()}.tmp`;
    await writeFile(temp,body,"utf8");
    for(let attempt=0;;attempt++){
      try{await rename(temp,localFile);break}
      catch(error){if(!["EPERM","EBUSY","EACCES"].includes(error.code)||attempt>=5)throw error;await new Promise(resolve=>setTimeout(resolve,20*(attempt+1)))}
    }
  });
  localSaveQueues.set(localFile,job);
  try{await job}finally{if(localSaveQueues.get(localFile)===job)localSaveQueues.delete(localFile)}
}

export const stateFiles = root => ({
  matches: process.env.DATA_FILE || join(root, "data", "internal-matches.json"),
  appState: process.env.APP_STATE_FILE || join(root, "data", "app-state.json"),
  runtime: process.env.RUNTIME_CONFIG_FILE || join(root, "data", "runtime-config.json"),
});
