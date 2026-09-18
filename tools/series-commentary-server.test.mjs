import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {Readable} from "node:stream";

const repo=dirname(dirname(fileURLToPath(import.meta.url)));

function request(handler,url,{method="GET",body,headers={}}={}){
  return new Promise((resolve,reject)=>{
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.url=url;req.method=method;req.headers={host:"localhost",...headers};
    const chunks=[];const res={writeHead(status,responseHeaders){res.status=status;res.headers=responseHeaders},end(chunk){if(chunk)chunks.push(Buffer.from(chunk));const text=Buffer.concat(chunks).toString("utf8");resolve({status:res.status,headers:res.headers,body:text?JSON.parse(text):null})}};
    Promise.resolve(handler(req,res)).catch(reject);
  });
}

test("finishing a series automatically calls Responses API once and public GET reads the stored review",async()=>{
  const tempRoot=await mkdtemp(join(tmpdir(),"eungck-series-commentary-")),reviewDir=join(tempRoot,"reviews"),appStateFile=join(tempRoot,"app-state.json"),previousFetch=globalThis.fetch;
  const fixture=JSON.parse(await readFile(join(repo,"data","app-state.json"),"utf8")),finishedSeries=structuredClone(fixture.seriesState.history.find(series=>String(series.id)==="1787588564072"));
  assert.ok(finishedSeries?.finished);const previousSeries={...structuredClone(finishedSeries),finished:false};delete previousSeries.finishedAt;
  const previousState={...fixture,seriesState:{active:previousSeries,history:(fixture.seriesState.history||[]).filter(series=>String(series.id)!==String(finishedSeries.id))}};await writeFile(appStateFile,JSON.stringify(previousState),"utf8");
  process.env.VERCEL="1";process.env.DATA_FILE=join(repo,"data","internal-matches.json");process.env.APP_STATE_FILE=appStateFile;process.env.RUNTIME_CONFIG_FILE=join(tempRoot,"runtime.json");process.env.SERIES_COMMENTARY_DIR=reviewDir;process.env.SERIES_COMMENTARY_BUDGET_DIR=join(tempRoot,"budget");process.env.SERIES_COMMENTARY_FINGERPRINT_DIR=join(tempRoot,"fingerprints");process.env.UPLOADER_TOKEN="test-upload-token";process.env.OPENAI_API_KEY="test-openai-key";process.env.OPENAI_MODEL="test-model";delete process.env.BLOB_READ_WRITE_TOKEN;delete process.env.DISCORD_WEBHOOK_URL;
  let calls=0,requestBody,incompleteResponses=0,responseHeadline="한타 집중력이 가른 시리즈";
  globalThis.fetch=async(url,options={})=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");calls++;requestBody=JSON.parse(options.body);assert.equal(options.headers.Authorization,"Bearer test-openai-key");
    if(incompleteResponses>0){incompleteResponses--;return new Response(JSON.stringify({status:"incomplete",incomplete_details:{reason:"max_output_tokens"},output:[],usage:{input_tokens:100,output_tokens:6000,total_tokens:6100}}),{status:200,headers:{"Content-Type":"application/json"}})}
    const review={headline:responseHeadline,overview:"저장된 경기 지표를 근거로 작성한 테스트 총평입니다.",decisiveFactors:["승리 팀의 피해량 우위"],setReviews:[{setNumber:1,title:"첫 세트",summary:"지표상 우위를 만들었습니다."}],matchupReviews:[{role:"원딜",title:"바텀 구도",summary:"맞포지션과 2대2 지표를 함께 봤습니다."}],notablePlayers:[{name:"테스트 선수",side:"RED",summary:"확인 가능한 지표에서 눈에 띄었습니다."}],ratingSummary:"확정된 롤력 변화를 설명합니다.",dataNotice:"기록되지 않은 오더와 교전 과정은 단정하지 않습니다."};
    return new Response(JSON.stringify({status:"completed",model:"test-model",output_text:"",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(review)}]}],usage:{input_tokens:100,output_tokens:50,total_tokens:150}}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  try{
    const {handleRequest}=await import(`../server.mjs?series-commentary-test=${Date.now()}`),seriesId=String(finishedSeries.id),finishedState={...previousState,seriesState:{active:finishedSeries,history:[...previousState.seriesState.history,structuredClone(finishedSeries)]}};
    const savedState=await request(handleRequest,"/api/app-state",{method:"PUT",body:{players:finishedState.players,seriesState:finishedState.seriesState,ladderChoice:null}});assert.equal(savedState.status,200);
    for(let attempt=0;attempt<40&&calls<1;attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(calls,1);assert.equal(requestBody.store,false);assert.equal(requestBody.reasoning.effort,"low");assert.equal(requestBody.max_output_tokens,6000);assert.equal(requestBody.text.verbosity,"low");assert.equal(requestBody.text.format.type,"json_schema");assert.equal(requestBody.model,"test-model");
    for(let attempt=0;attempt<40;attempt++){try{const current=JSON.parse(await readFile(join(reviewDir,`${seriesId}.json`),"utf8"));if(current.status==="ready")break}catch{}await new Promise(resolve=>setTimeout(resolve,25))}
    const saved=JSON.parse(await readFile(join(reviewDir,`${seriesId}.json`),"utf8"));assert.equal(saved.status,"ready");assert.equal(saved.usage.totalTokens,150);
    const fetched=await request(handleRequest,`/api/series-commentary?seriesId=${seriesId}`);assert.equal(fetched.status,200);assert.equal(fetched.body.status,"ready");assert.equal(fetched.body.review.headline,"한타 집중력이 가른 시리즈");assert.equal(calls,1);
    const oldSeries=fixture.seriesState.history.find(series=>String(series.id)!==seriesId),missing=await request(handleRequest,`/api/series-commentary?seriesId=${oldSeries.id}`);assert.equal(missing.status,200);assert.equal(missing.body.status,"missing");assert.equal(calls,1);
    const duplicateSave=await request(handleRequest,"/api/app-state",{method:"PUT",body:{players:finishedState.players,seriesState:finishedState.seriesState,ladderChoice:null}});assert.equal(duplicateSave.status,200);await new Promise(resolve=>setTimeout(resolve,50));assert.equal(calls,1);
    const failedRecord={...saved,status:"failed",errorCode:"rate_limit",attempts:1,failedAt:Date.now(),updatedAt:Date.now()};delete failedRecord.review;await writeFile(join(reviewDir,`${seriesId}.json`),JSON.stringify(failedRecord),"utf8");
    const recovering=await request(handleRequest,`/api/series-commentary?seriesId=${seriesId}`);assert.equal(recovering.status,200);assert.equal(recovering.body.status,"pending");
    for(let attempt=0;attempt<40&&calls<2;attempt++)await new Promise(resolve=>setTimeout(resolve,25));assert.equal(calls,2);
    for(let attempt=0;attempt<40;attempt++){const current=JSON.parse(await readFile(join(reviewDir,`${seriesId}.json`),"utf8"));if(current.status==="ready"&&current.attempts===2)break;await new Promise(resolve=>setTimeout(resolve,25))}
    const recovered=JSON.parse(await readFile(join(reviewDir,`${seriesId}.json`),"utf8"));assert.equal(recovered.status,"ready");assert.equal(recovered.attempts,2);
    await writeFile(join(reviewDir,`${seriesId}.json`),JSON.stringify({...recovered,attempts:0}),"utf8");
    incompleteResponses=1;
    const incomplete=await request(handleRequest,"/api/series-commentary/regenerate",{method:"POST",headers:{authorization:"Bearer test-upload-token"},body:{seriesId}});assert.equal(incomplete.status,200);assert.equal(incomplete.body.status,"failed");assert.equal(incomplete.body.errorCode,"output_incomplete");assert.equal(calls,3);
    const incompleteRetry=await request(handleRequest,`/api/series-commentary?seriesId=${seriesId}`);assert.equal(incompleteRetry.status,200);assert.equal(incompleteRetry.body.status,"pending");
    for(let attempt=0;attempt<40&&calls<4;attempt++)await new Promise(resolve=>setTimeout(resolve,25));assert.equal(calls,4);
    for(let attempt=0;attempt<40;attempt++){const current=JSON.parse(await readFile(join(reviewDir,`${seriesId}.json`),"utf8"));if(current.status==="ready"&&current.attempts===2)break;await new Promise(resolve=>setTimeout(resolve,25))}
    const recoveredIncomplete=JSON.parse(await readFile(join(reviewDir,`${seriesId}.json`),"utf8"));assert.equal(recoveredIncomplete.status,"ready");assert.equal(recoveredIncomplete.attempts,2);
    responseHeadline="타임라인으로 다시 쓴 총평";
    const regenerated=await request(handleRequest,"/api/series-commentary/regenerate",{method:"POST",headers:{authorization:"Bearer test-upload-token"},body:{seriesId}});assert.equal(regenerated.status,200);assert.equal(regenerated.body.status,"ready");assert.equal(regenerated.body.review.headline,responseHeadline);assert.equal(calls,5);
    const forced=JSON.parse(await readFile(join(reviewDir,`${seriesId}.json`),"utf8"));assert.equal(forced.review.headline,responseHeadline);assert.equal(forced.revision,recoveredIncomplete.revision+1);assert.notEqual(forced.generationId,recoveredIncomplete.generationId);
    const reviewedHeadline="사람이 검수한 타임라인 총평",reviewed=await request(handleRequest,"/api/series-commentary/review",{method:"PUT",headers:{authorization:"Bearer test-upload-token"},body:{seriesId,review:{...forced.review,headline:reviewedHeadline}}});assert.equal(reviewed.status,200);assert.equal(reviewed.body.status,"ready");assert.equal(reviewed.body.review.headline,reviewedHeadline);assert.equal(calls,5);
    const storedReview=JSON.parse(await readFile(join(reviewDir,`${seriesId}.json`),"utf8"));assert.equal(storedReview.review.headline,reviewedHeadline);assert.equal(storedReview.revision,forced.revision+1);assert.ok(storedReview.reviewedAt>=forced.generatedAt);
  }finally{globalThis.fetch=previousFetch;await rm(tempRoot,{recursive:true,force:true})}
});
