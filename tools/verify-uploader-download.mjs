import {createServer} from 'node:http';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
process.env.VERCEL='1';
const {handleRequest}=await import('../server.mjs'),server=createServer(handleRequest);
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,dir=await mkdtemp(join(tmpdir(),'ck-uploader-download-'));
let browser;
try{
 const expected=await readFile(new URL('../downloads/eungck-uploader-20260918.zip',import.meta.url));
 const response=await fetch(origin+'/api/uploader/download');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');assert.match(response.headers.get('content-disposition'),/attachment/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);
 const head=await fetch(origin+'/api/uploader/download',{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),expected.length);assert.equal((await head.arrayBuffer()).byteLength,0);
 const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_PACKAGE));browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  const url=route.request().url();if(!url.startsWith(origin))return route.abort();
  if(url.includes('/api/')&&!url.endsWith('/api/uploader/download'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.includes('/api/app-state')?{players:[],seriesState:{active:null,history:[]}}:[])});
  return route.continue();
 });
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 for(const width of [1440,900,390,320]){
  await page.setViewportSize({width,height:900});const link=page.locator('.uploader-download');assert.equal(await link.isVisible(),true);assert.ok(await page.locator('.topbar').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'header overflow '+width);
  await page.locator('.topbar').screenshot({path:join(dir,'header-'+width+'.png')});
 }
 const downloading=page.waitForEvent('download');await page.locator('.uploader-download').click();const download=await downloading;assert.equal(download.suggestedFilename(),'eungck-uploader-20260918.zip');assert.deepEqual(await readFile(await download.path()),expected);assert.equal(await page.locator('.topbar nav .active').getAttribute('href'),'#players');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'pass',downloadBytes:expected.length,unchangedFile:true,desktopAndMobile:true,screenshots:dir}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
