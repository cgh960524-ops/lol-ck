import {buildStyleProfiles} from './player-style.js?v=20260917-radar';

const ROLE_NAMES={TOP:'탑',JUNGLE:'정글',MID:'미드',ADC:'원딜',SUPPORT:'서폿'};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const point=(i,n,r,cx,cy)=>{const a=-Math.PI/2+i*2*Math.PI/n;return [cx+Math.cos(a)*r,cy+Math.sin(a)*r];};
const points=(values,max,r,cx,cy)=>values.map((v,i)=>point(i,values.length,r*v/max,cx,cy).map(x=>x.toFixed(2)).join(',')).join(' ');
const reasonText={'no-games':'미배치',missing:'미수집','few-games':'표본 부족','few-peers':'비교군 부족',ready:''};

export function radarMarkup({width,labels,values,max,style=false,selected=-1,provisional=[],empty='관측 없음'}){
  const w=Math.max(160,Math.round(width)),height=282,cx=w/2,cy=139,r=Math.max(20,Math.min(90,(w-126)/2)),n=labels.length;
  const available=values.map(v=>v!==null&&Number.isFinite(v));
  let content='<title>'+escape(labels.map((label,i)=>label+' '+(available[i]?values[i].toLocaleString():'미표시')+(!style&&provisional[i]?' · 잠정':'')).join(', '))+'</title>';
  for(let k=1;k<=4;k++)content+='<polygon class="radar-grid" points="'+points(Array(n).fill(k/4),1,r,cx,cy)+'"/>';
  labels.forEach((_,i)=>{const [x,y]=point(i,n,r,cx,cy);content+=`<line class="radar-grid" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`;});
  if(style&&available.some(Boolean))content+='<polygon class="radar-baseline" points="'+points(Array(n).fill(50),100,r,cx,cy)+'"/>';
  if(available.every(Boolean))content+='<polygon class="radar-area" points="'+points(values,max,r,cx,cy)+'"/>';
  else values.forEach((value,i)=>{const j=(i+1)%n;if(!available[i]||!available[j])return;const a=point(i,n,r*value/max,cx,cy),b=point(j,n,r*values[j]/max,cx,cy);content+=`<line class="radar-segment" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;});
  values.forEach((value,i)=>{if(!available[i])return;const [x,y]=point(i,n,r*value/max,cx,cy);content+=`<circle class="radar-point${provisional[i]?' radar-provisional':''}" cx="${x}" cy="${y}" r="${selected===i?5:3}"/>`;});
  labels.forEach((label,i)=>{const [x,y]=point(i,n,r+22,cx,cy),anchor=Math.abs(x-cx)<8?'middle':x>cx?'start':'end';content+=`<text x="${x}" y="${y-7}" text-anchor="${anchor}">${escape(label)}</text><text class="radar-value" x="${x}" y="${y+11}" text-anchor="${anchor}">${available[i]?values[i].toLocaleString():'—'}</text>`;});
  if(!available.some(Boolean))content+=`<text class="radar-empty" x="${cx}" y="${cy+4}" text-anchor="middle">${escape(empty)}</text>`;
  return `<svg class="player-radar${style?' style-radar':''}" width="${w}" height="${height}" viewBox="0 0 ${w} ${height}" role="img" aria-label="${style?'동일 포지션 플레이스타일 상대지수':'포지션별 롤력'}">${content}</svg>`;
}

export function mountPlayerRadar(host,player,players,matches,seriesState,engine){
  const profiles=buildStyleProfiles(players,matches,seriesState,engine);
  const roles=engine.ROLES.map(role=>({key:role,name:ROLE_NAMES[role],rating:engine.positionScore(player,role),...(player.ratingV2?.roles?.[role]||{})}));
  const max=Math.max(2000,Math.ceil(Math.max(...players.flatMap(p=>engine.ROLES.map(role=>engine.positionScore(p,role))))/500)*500);
  let selected=[...roles].sort((a,b)=>(b.games||0)-(a.games||0))[0].key,disposed=false;
  host.className='player-radar-overview';
  host.innerHTML=`<div class="player-radar-panels"><section class="player-radar-panel"><div class="radar-panel-heading"><h4>포지션 롤력</h4><span>V4 · 실제 점수</span></div><p class="radar-subtitle">5개 포지션 · 공통 축척 0–${max.toLocaleString()}점</p><div class="radar-plot" data-position-plot></div><div class="radar-legend"><span><i class="radar-legend-dot"></i>관측 근거 있음</span><span><i class="radar-legend-dot hollow"></i>잠정·미배치</span></div><div class="radar-role-buttons" aria-label="플레이스타일 포지션 선택">${roles.map(r=>`<button type="button" data-radar-role="${r.key}" aria-pressed="false">${r.name}</button>`).join('')}</div><div class="radar-role-focus" data-radar-focus aria-live="polite"></div></section><section class="player-radar-panel"><div class="radar-panel-heading"><h4>플레이스타일 <span data-style-role></span></h4><span>실제 내전 집계</span></div><p class="radar-subtitle">동일 포지션 선수 비교 · 0–100 상대지수</p><div class="radar-plot" data-style-plot></div><div class="radar-legend"><span><i class="radar-legend-line"></i>선수</span><span><i class="radar-legend-line median"></i>중앙 기준 50</span></div><div class="radar-style-summary" data-style-summary aria-live="polite"></div><div class="radar-metrics" data-style-metrics></div></section></div><details class="radar-style-method"><summary>플레이스타일 집계 기준</summary><p>전체 내전의 확정 포지션만 사용합니다. 시리즈 안에서 지표를 평균한 후 시리즈별로 같은 비중을 부여합니다. 선수별 지표를 같은 포지션 선수들과 비교한 중간순위 백분위이며, 동률은 같은 지수를 받습니다. 지표별 최소 3경기·2시리즈/세션, 비교 선수 5명이 필요합니다.</p><p>누락된 축은 —로 표시하고 연결을 끊습니다. 표본 부족·미수집·비교군 부족은 구분합니다. 시리즈 미연결 경기는 기존 V4의 추정 세션 기준을 사용합니다. 전원 CC가 0인 경기는 수집 여부가 불명확해 제어 집계에서 제외합니다.</p><p>스타일은 상대·챔피언·조합에 따라 달라지는 관측 특성입니다. 면적이 크다고 더 잘한다는 뜻이 아니며, 롤력·승률·팀 밸런스에 가산하지 않습니다. 15분 골드차·오더·이니시 성공률·아군 보호는 표시하지 않습니다.</p></details>`;
  const rolePlot=host.querySelector('[data-position-plot]'),stylePlot=host.querySelector('[data-style-plot]');
  function draw(){
    if(disposed||!host.isConnected)return;
    const profile=profiles.get(player.id,selected);
    rolePlot.innerHTML=radarMarkup({width:rolePlot.clientWidth,labels:roles.map(r=>r.name),values:roles.map(r=>r.rating),max,selected:roles.findIndex(r=>r.key===selected),provisional:roles.map(r=>engine.isProvisional(r))});
    stylePlot.innerHTML=radarMarkup({width:stylePlot.clientWidth,labels:profile.metrics.map(m=>m.label),values:profile.metrics.map(m=>m.index),max:100,style:true,empty:!profile.games?'관측 없음':'집계 근거 부족'});
  }
  function render(){
    const r=roles.find(x=>x.key===selected),profile=profiles.get(player.id,selected);
    host.querySelectorAll('[data-radar-role]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.radarRole===selected)));
    host.querySelector('[data-style-role]').textContent='· '+r.name;
    host.querySelector('[data-radar-focus]').innerHTML=`<span>${r.name} · ${r.games||0}경기 · ${engine.confidenceLabel(r)}</span><strong>${r.rating.toLocaleString()}</strong>`;
    host.querySelector('[data-style-summary]').textContent=profile.games?`${profile.games}경기 · ${profile.sessions}시리즈/세션 · ${profile.available}/6축 집계`:'이 포지션의 확정된 경기 기록이 없습니다.';
    host.querySelector('[data-style-metrics]').innerHTML=profile.metrics.map(m=>`<div class="radar-metric"><span>${m.label} <b>${m.index===null?'—':m.index}</b></span><small>${m.detail}</small><small>${m.index===null?reasonText[m.reason]+' · ':''}${m.games}경기 · 비교 ${m.peers}명</small></div>`).join('');
    draw();
  }
  host.querySelectorAll('[data-radar-role]').forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.radarRole;render();}));
  render();
  const observer=new ResizeObserver(draw);observer.observe(rolePlot);observer.observe(stylePlot);
  const dialog=host.closest('dialog');
  const cleanup=()=>{disposed=true;observer.disconnect();dialog?.removeEventListener('close',cleanup);};
  dialog?.addEventListener('close',cleanup,{once:true});
  return cleanup;
}
