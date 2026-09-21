import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscordSession,discordAuthConfigured,discordManagementConfigured,discordSession,finishDiscordLogin,isDiscordGuildMember,requireDiscordGuildMember,requireDiscordSession,requireSameOrigin,startDiscordLogin} from '../discord-auth.mjs';

const env=['DISCORD_OAUTH_CLIENT_ID','DISCORD_OAUTH_CLIENT_SECRET','DISCORD_SESSION_SECRET','DISCORD_OAUTH_REDIRECT_URI','DISCORD_BOT_TOKEN','DISCORD_GUILD_ID'];
const saved=Object.fromEntries(env.map(key=>[key,process.env[key]]));
test.after(()=>{for(const key of env){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key]}});
function configured(){process.env.DISCORD_OAUTH_CLIENT_ID='123456789012345678';process.env.DISCORD_OAUTH_CLIENT_SECRET='test-oauth-secret';process.env.DISCORD_SESSION_SECRET='a'.repeat(48);process.env.DISCORD_OAUTH_REDIRECT_URI='https://lol-ck.vercel.app/api/auth/discord/callback'}
function response(){return {headers:null,status:null,writeHead(status,headers){this.status=status;this.headers=headers},end(){}}}
test('login starts an identify-only OAuth flow with a state cookie',()=>{configured();assert.equal(discordAuthConfigured(),true);const res=response();startDiscordLogin({headers:{}},res);const url=new URL(res.headers.Location);assert.equal(res.status,302);assert.equal(url.origin,'https://discord.com');assert.equal(url.searchParams.get('scope'),'identify');assert.equal(url.searchParams.get('redirect_uri'),process.env.DISCORD_OAUTH_REDIRECT_URI);assert.ok(res.headers['Set-Cookie'][0].includes('HttpOnly'));assert.ok(res.headers['Set-Cookie'][0].includes('SameSite=Lax'))});
test('callback validates state and creates a signed, expiring session',async()=>{configured();const first=response();startDiscordLogin({headers:{}},first);const oauth=new URL(first.headers.Location),state=oauth.searchParams.get('state'),cookie=first.headers['Set-Cookie'][0].split(';')[0],callback=new URL(`https://lol-ck.vercel.app/api/auth/discord/callback?code=test-code&state=${state}`),finished=response();
 const fetchDiscord=async url=>({ok:true,json:async()=>url.endsWith('/token')?{access_token:'mock-access-token'}:{id:'123456789012345678',username:'tester'}});
 await finishDiscordLogin({headers:{cookie}},finished,callback,{fetchDiscord});const sessionCookie=finished.headers['Set-Cookie'][1].split(';')[0];assert.deepEqual(discordSession({headers:{cookie:sessionCookie}}),{id:'123456789012345678',name:'tester'});assert.throws(()=>requireDiscordSession({headers:{cookie:sessionCookie+'tampered'}}),{status:401});assert.equal(discordSession({headers:{cookie:sessionCookie}},Date.now()+8*86400000),null);
 await assert.rejects(()=>finishDiscordLogin({headers:{cookie}},response(),new URL('https://lol-ck.vercel.app/api/auth/discord/callback?code=x&state=wrong'),{fetchDiscord}),{status:400});
});
test('write origin must match the configured app',()=>{configured();assert.doesNotThrow(()=>requireSameOrigin({headers:{origin:'https://lol-ck.vercel.app'}}));assert.throws(()=>requireSameOrigin({headers:{origin:'https://other.example'}}),{status:403})});
test('management is limited to current guild members and fails closed',async()=>{
 configured();process.env.DISCORD_BOT_TOKEN='test-bot-token';process.env.DISCORD_GUILD_ID='1434891063327461481';assert.equal(discordManagementConfigured(),true);
 const user={id:'123456789012345678',username:'tester'},req={headers:{cookie:`ck_discord_session=${createDiscordSession(user)}`}};
 const ok=async(url,options)=>{assert.equal(url,'https://discord.com/api/v10/guilds/1434891063327461481/members/123456789012345678');assert.equal(options.headers.Authorization,'Bot test-bot-token');return {status:200,ok:true}};
 assert.equal(await isDiscordGuildMember(user,{fetchDiscord:ok}),true);assert.equal((await requireDiscordGuildMember(req,{fetchDiscord:ok})).id,user.id);
 await assert.rejects(()=>requireDiscordGuildMember(req,{fetchDiscord:async()=>({status:404,ok:false})}),{status:403});
 await assert.rejects(()=>requireDiscordGuildMember(req,{fetchDiscord:async()=>({status:500,ok:false})}),{status:503});
 await assert.rejects(()=>requireDiscordGuildMember(req,{fetchDiscord:async()=>{throw Error('network')}}),{status:503});
 delete process.env.DISCORD_BOT_TOKEN;assert.equal(discordManagementConfigured(),false);
 await assert.rejects(()=>requireDiscordGuildMember(req,{fetchDiscord:ok}),{status:503});
});
