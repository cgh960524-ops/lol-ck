import postgres from "postgres";

let singleton=null;
let singletonUrl="";

/**
 * Return the process-wide PostgreSQL client. A single connection is enough for
 * a Vercel function instance and avoids multiplying Neon connections during a
 * traffic burst.
 */
export function getDatabase(connectionString=process.env.DATABASE_URL){
  const url=String(connectionString||"").trim();
  if(!url)throw Object.assign(new Error("DATABASE_URL이 설정되지 않았습니다."),{status:503,code:"database_not_configured"});
  if(singleton&&singletonUrl===url)return singleton;
  if(singleton&&singletonUrl!==url)throw Object.assign(new Error("실행 중인 서버의 DATABASE_URL은 변경할 수 없습니다."),{status:500,code:"database_url_changed"});
  singletonUrl=url;
  singleton=postgres(url,{max:1,prepare:false,idle_timeout:20,connect_timeout:10});
  return singleton;
}

// Intended for scripts/tests that own the process lifecycle. The web server
// deliberately keeps its singleton open for connection reuse.
export async function closeDatabase(){
  if(singleton)await singleton.end({timeout:5});
  singleton=null;singletonUrl="";
}
