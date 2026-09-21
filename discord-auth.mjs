import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

const SESSION_NAME='ck_discord_session';
const STATE_NAME='ck_discord_oauth_state';
const SESSION_AGE=24*60*60;
const STATE_AGE=10*60;
const error=(message,status)=>Object.assign(new Error(message),{status});
const secret=()=>String(process.env.DISCORD_SESSION_SECRET||'');
const clientId=()=>String(process.env.DISCORD_OAUTH_CLIENT_ID||process.env.DISCORD_APPLICATION_ID||'');
const clientSecret=()=>String(process.env.DISCORD_OAUTH_CLIENT_SECRET||'');
const redirectUri=()=>String(process.env.DISCORD_OAUTH_REDIRECT_URI||new URL('/api/auth/discord/callback',process.env.PUBLIC_APP_URL||'https://lol-ck.vercel.app/'));
const origin=()=>new URL(redirectUri()).origin;
export const discordAuthConfigured=()=>Boolean(clientId()&&clientSecret()&&secret().length>=32);
const guildId=()=>String(process.env.DISCORD_GUILD_ID||'1434891063327461481').trim();
const botToken=()=>String(process.env.DISCORD_BOT_TOKEN||'').trim();
export const discordManagementConfigured=()=>discordAuthConfigured()&&Boolean(botToken()&&/^\d{5,25}$/.test(guildId()));
export async function isDiscordGuildMember(user,{fetchDiscord=fetch}={}){
 if(!botToken()||!/^\d{5,25}$/.test(guildId()))throw error('Discord 서버 구성원 확인이 설정되지 않았습니다.',503);
 if(!/^\d{5,25}$/.test(String(user?.id||'')))throw error('Discord 계정 정보가 올바르지 않습니다.',401);
 let response;try{response=await fetchDiscord(`https://discord.com/api/v10/guilds/${guildId()}/members/${user.id}`,{headers:{Authorization:`Bot ${botToken()}`},signal:AbortSignal.timeout(5000)})}catch{throw error('Discord 서버 구성원 확인에 실패했습니다.',503)}
 if(response.status===404)return false;
 if(!response.ok)throw error('Discord 서버 구성원 확인에 실패했습니다.',503);
 return true;
}
export async function requireDiscordGuildMember(req,options){
 const user=requireDiscordSession(req);
 if(!await isDiscordGuildMember(user,options))throw error('응CK Discord 서버 구성원만 시리즈를 관리할 수 있습니다.',403);
 return user;
}
const secureCookie=()=>redirectUri().startsWith('https:')?'; Secure':'';
const cookie=(name,value,age)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secureCookie()}`;
const cookies=req=>Object.fromEntries(String(req.headers.cookie||'').split(';').map(part=>part.trim().split('=').slice(0,2)).filter(parts=>parts.length===2));
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y)};
const signature=value=>createHmac('sha256',secret()).update(value).digest('base64url');
export function createDiscordSession(user,now=Date.now()){
 if(!discordAuthConfigured())throw error('Discord 로그인이 설정되지 않았습니다.',503);
 const payload=Buffer.from(JSON.stringify({id:String(user.id),name:String(user.global_name||user.username||'Discord 사용자').slice(0,80),exp:now+SESSION_AGE*1000})).toString('base64url');
 return `${payload}.${signature(payload)}`;
}
export function discordSession(req,now=Date.now()){
 if(!discordAuthConfigured())return null;
 const token=cookies(req)[SESSION_NAME]||'',parts=token.split('.');if(parts.length!==2||!equal(parts[1],signature(parts[0])))return null;
 try{const data=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));if(!/^\d{5,25}$/.test(String(data.id))||!Number.isFinite(data.exp)||data.exp<=now)return null;return {id:String(data.id),name:String(data.name||'Discord 사용자').slice(0,80)}}catch{return null}
}
export function requireDiscordSession(req){const user=discordSession(req);if(!user)throw error('시리즈 삭제·편집은 Discord 로그인이 필요합니다.',401);return user}
export function requireSameOrigin(req){if(String(req.headers.origin||'')!==origin())throw error('허용되지 않은 요청 출처입니다.',403)}
const redirect=(res,location,setCookies=[])=>{res.writeHead(302,{Location:location,'Set-Cookie':setCookies,'Cache-Control':'no-store'});res.end()};
export function startDiscordLogin(req,res){
 if(!discordAuthConfigured())throw error('Discord 로그인이 아직 설정되지 않았습니다.',503);
 const state=randomBytes(24).toString('base64url'),url=new URL('https://discord.com/oauth2/authorize');
 url.searchParams.set('client_id',clientId());url.searchParams.set('redirect_uri',redirectUri());url.searchParams.set('response_type','code');url.searchParams.set('scope','identify');url.searchParams.set('state',state);
 redirect(res,url.toString(),[cookie(STATE_NAME,state,STATE_AGE)]);
}
export async function finishDiscordLogin(req,res,requestUrl,{fetchDiscord=fetch}={}){
 const clear=cookie(STATE_NAME,'',0),expected=cookies(req)[STATE_NAME],received=requestUrl.searchParams.get('state'),code=requestUrl.searchParams.get('code');
 if(!expected||!received||!equal(expected,received)||!code||requestUrl.searchParams.has('error'))throw error('Discord 로그인 검증에 실패했습니다. 다시 시도해주세요.',400);
 const params=new URLSearchParams({client_id:clientId(),client_secret:clientSecret(),grant_type:'authorization_code',code,redirect_uri:redirectUri()});
 const tokenResponse=await fetchDiscord('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params});
 if(!tokenResponse.ok)throw error('Discord 인증 코드를 교환하지 못했습니다.',502);
 const token=await tokenResponse.json();if(!token.access_token)throw error('Discord 인증 응답이 올바르지 않습니다.',502);
 const userResponse=await fetchDiscord('https://discord.com/api/v10/users/@me',{headers:{Authorization:`Bearer ${token.access_token}`}});
 if(!userResponse.ok)throw error('Discord 계정 정보를 확인하지 못했습니다.',502);
 const user=await userResponse.json();if(!/^\d{5,25}$/.test(String(user.id||'')))throw error('Discord 계정 정보가 올바르지 않습니다.',502);
 redirect(res,'/',[clear,cookie(SESSION_NAME,createDiscordSession(user),SESSION_AGE)]);
}
export function logoutDiscord(res){redirect(res,'/',[cookie(SESSION_NAME,'',0)])}
