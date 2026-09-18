import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {compareAndSwapJson,createJsonIfAbsent,loadJsonVersioned} from "../storage.mjs";

test("versioned JSON claims and updates have one local winner",async()=>{
  const root=await mkdtemp(join(tmpdir(),"eungck-storage-cas-")),file=join(root,"claim.json"),name=`test-${Date.now()}`;
  try{
    const creates=await Promise.all([createJsonIfAbsent(name,file,{owner:"A"}),createJsonIfAbsent(name,file,{owner:"B"})]);
    assert.equal(creates.filter(result=>result.created).length,1);
    const snapshot=await loadJsonVersioned(name,file,null);assert.ok(snapshot.version);assert.ok(["A","B"].includes(snapshot.value.owner));
    const updates=await Promise.all([compareAndSwapJson(name,file,snapshot.version,{owner:"C"}),compareAndSwapJson(name,file,snapshot.version,{owner:"D"})]);
    assert.equal(updates.filter(result=>result.updated).length,1);
    const final=await loadJsonVersioned(name,file,null);assert.ok(["C","D"].includes(final.value.owner));
  }finally{await rm(root,{recursive:true,force:true})}
});
