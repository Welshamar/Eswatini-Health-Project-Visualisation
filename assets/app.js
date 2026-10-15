"use strict";
let ROWS = [];
// row layout: 0 area, 1 constituency, 2 region, 3 mdr(0/1), 4 hiv positive(0/1), 5 sex, 6 age, 7 died(0/1), 8 lat, 9 lon, 10 spread lat, 11 spread lon
const AGE_GROUPS = [["18 to 29",18,29],["30 to 39",30,39],["40 to 49",40,49],["50 to 59",50,59],["60 and over",60,200]];
const COL = {blue:"#3b8bc4", amber:"#f2a33a", red:"#b3261e"};
const FEW = 10; // groups smaller than this get a greyed-out death rate

/* ---------- unlock ---------- */
function b64ToBytes(b64){const s=atob(b64);const a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a}
async function tryUnlock(password){
  const P=window.ENCRYPTED_PAYLOAD;
  const enc=new TextEncoder();
  const base=await crypto.subtle.importKey("raw",enc.encode(password),{name:"PBKDF2"},false,["deriveKey"]);
  const key=await crypto.subtle.deriveKey({name:"PBKDF2",salt:b64ToBytes(P.salt),iterations:P.iterations,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["decrypt"]);
  const buf=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64ToBytes(P.iv)},key,b64ToBytes(P.data));
  return JSON.parse(new TextDecoder().decode(buf));
}
document.getElementById("lockForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const btn=document.getElementById("lockSubmit"), err=document.getElementById("lockError");
  if(!window.crypto || !crypto.subtle){
    err.textContent="This browser cannot unlock the map. Open the https:// address in an up-to-date browser.";
    err.hidden=false; return;
  }
  btn.disabled=true; btn.textContent="Checking..."; err.hidden=true;
  let rows;
  try{
    rows=await tryUnlock(document.getElementById("lockPassword").value);
  }catch(ex){
    err.textContent="That password is not right. Try again.";
    err.hidden=false; btn.disabled=false; btn.textContent="Unlock";
    return;
  }
  ROWS=rows;
  document.body.classList.remove("locked");
  document.getElementById("lockScreen").remove();
  init();
});
document.getElementById("pwToggle").addEventListener("click",e=>{
  const inp=document.getElementById("lockPassword"), show=inp.type==="password";
  inp.type=show?"text":"password";
  e.currentTarget.textContent=show?"Hide":"Show";
  e.currentTarget.setAttribute("aria-pressed",String(show));
  e.currentTarget.setAttribute("aria-label",show?"Hide password":"Show password");
});

/* ---------- state and helpers ---------- */
const FILTERS = ["region","tb","hiv","sex","age","cons"];
const FILTER_SELECT = {region:"fRegion",tb:"fTb",hiv:"fHiv",sex:"fSex",age:"fAge",cons:"fConst"};
const S = {view:"all", region:"", tb:"", hiv:"", sex:"", age:"", cons:"", spread:true, base:true, tab:"map"};
let map, group, baseLayer, geoLayer, markers = [], pendingFit = false;
const $ = id => document.getElementById(id);
const esc = t => String(t).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nice = t => t.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/'S\b/g,"'s");
const pct = (a,b) => b ? Math.round(1000*a/b)/10 : 0;
const ageGroup = a => { for(const g of AGE_GROUPS){ if(a>=g[1] && a<=g[2]) return g[0]; } return ""; };

// Every filter as a test on one row; `except` leaves one out (used by the charts,
// so a chart still shows all of its own bars while the others are filtered).
const TESTS = {
  region: r => r[2]===S.region,
  cons:   r => r[1]===S.cons,
  tb:     r => r[3]===+S.tb,
  hiv:    r => r[4]===+S.hiv,
  sex:    r => r[5]===S.sex,
  age:    r => ageGroup(r[6])===S.age,
};
function filtered(except){
  const active = FILTERS.filter(k => k!==except && S[k]!=="");
  return ROWS.filter(r => active.every(k => TESTS[k](r)));
}

function aggregate(rows){
  const m = new Map();
  for(const r of rows){
    const lat = S.spread ? r[10] : r[8], lon = S.spread ? r[11] : r[9];
    const k = lat.toFixed(5)+","+lon.toFixed(5);
    let g = m.get(k);
    if(!g){ g = {lat, lon, n:0, d:0, mdr:0, hiv:0, areas:new Map(), cons:new Set(), regs:new Set(), spread:false}; m.set(k,g); }
    g.n++; g.d += r[7]; g.mdr += r[3]; g.hiv += r[4];
    g.areas.set(r[0], (g.areas.get(r[0])||0)+1);
    g.cons.add(r[1]); g.regs.add(r[2]);
    if(S.spread && (r[10]!==r[8] || r[11]!==r[9])) g.spread = true;
  }
  return [...m.values()];
}

const valueOf = g => S.view==="deaths" ? g.d : S.view==="alive" ? g.n-g.d : g.n;
function colorOf(g){
  if(S.view==="deaths") return COL.red;
  if(S.view==="alive") return COL.blue;
  return g.d===0 ? COL.blue : g.d===1 ? COL.amber : COL.red;
}
let REF = 12;
function radius(v){ const f=Math.min(Math.max(v-1,0)/Math.max(REF-1,1),1); return 5+15*Math.sqrt(f); }

/* ---------- link state (#view=deaths&region=...) ---------- */
function readHash(){
  const p = new URLSearchParams(location.hash.slice(1));
  if(["all","deaths","alive"].includes(p.get("view"))) S.view = p.get("view");
  if(["map","charts"].includes(p.get("tab"))) S.tab = p.get("tab");
  for(const k of FILTERS){
    const v = p.get(k);
    if(v===null) continue;
    // Only accept values that exist as an option, so a stale link can't set an impossible filter.
    const sel = $(FILTER_SELECT[k]);
    if([...sel.options].some(o=>o.value===v)) S[k] = v;
  }
}
function writeHash(){
  const p = new URLSearchParams();
  if(S.view!=="all") p.set("view",S.view);
  if(S.tab!=="map") p.set("tab",S.tab);
  for(const k of FILTERS) if(S[k]!=="") p.set(k,S[k]);
  const h = p.toString();
  history.replaceState(null, "", h ? "#"+h : location.pathname+location.search);
}

/* ---------- setup ---------- */
function init(){
  const regs=[...new Set(ROWS.map(r=>r[2]))].sort();
  regs.forEach(x=>$("fRegion").add(new Option(x,x)));
  [...new Set(ROWS.map(r=>r[5]))].sort().forEach(x=>$("fSex").add(new Option(x,x)));
  AGE_GROUPS.forEach(g=>$("fAge").add(new Option(g[0],g[0])));
  syncConstOptions();
  readHash();
  if(S.cons && !S.region){ const r=ROWS.find(x=>x[1]===S.cons); if(r) S.region=r[2]; }
  syncConstOptions();
  for(const k of FILTERS) $(FILTER_SELECT[k]).value = S[k];
  document.querySelectorAll(".seg button").forEach(x=>x.setAttribute("aria-pressed", String(x.dataset.view===S.view)));

  map = L.map("map",{zoomControl:true,preferCanvas:true,minZoom:7,maxZoom:17}).setView([-26.5,31.5],9);
  map.attributionControl.setPrefix(false);
  // crossOrigin lets the PNG export copy the tiles onto a canvas (OSM sends CORS headers).
  baseLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap contributors",crossOrigin:"anonymous"});
  baseLayer.addTo(map);
  group = L.layerGroup().addTo(map);

  document.querySelectorAll(".seg button").forEach(b=>b.addEventListener("click",()=>{
    S.view=b.dataset.view;
    document.querySelectorAll(".seg button").forEach(x=>x.setAttribute("aria-pressed", String(x===b)));
    render();
  }));
  for(const k of FILTERS) $(FILTER_SELECT[k]).addEventListener("change",e=>setFilter(k,e.target.value));
  $("cSpread").addEventListener("change",e=>{S.spread=e.target.checked; render();});
  $("cBase").addEventListener("change",e=>{
    S.base=e.target.checked;
    if(S.base) baseLayer.addTo(map); else map.removeLayer(baseLayer);
  });
  $("bReset").addEventListener("click",()=>{
    for(const k of FILTERS) S[k]="";
    syncConstOptions();
    for(const k of FILTERS) $(FILTER_SELECT[k]).value="";
    render(true);
  });
  $("bFit").addEventListener("click",fit);
  $("fGeo").addEventListener("change",loadGeo);
  $("bCsv").addEventListener("click",downloadCsv);
  $("bLink").addEventListener("click",copyLink);
  $("bPng").addEventListener("click",downloadPng);
  $("bLock").addEventListener("click",()=>location.reload());
  $("tabMap").addEventListener("click",()=>showTab("map"));
  $("tabCharts").addEventListener("click",()=>showTab("charts"));
  $("tabMap").parentElement.addEventListener("keydown",e=>{
    if(e.key!=="ArrowLeft" && e.key!=="ArrowRight") return;
    showTab(S.tab==="map"?"charts":"map");
    $(S.tab==="map"?"tabMap":"tabCharts").focus();
  });
  showTab(S.tab, true);
  render(true);
}

function setFilter(k, v){
  S[k] = v;
  if(k==="region") syncConstOptions();
  if(k==="cons" && v){
    // Picking a constituency also pins its region, so the two never disagree.
    const r = ROWS.find(x=>x[1]===v);
    if(r && S.region!==r[2]){ S.region=r[2]; syncConstOptions(); }
  }
  for(const key of FILTERS) $(FILTER_SELECT[key]).value = S[key];
  render(true);
}

// Constituency list follows the chosen region.
function syncConstOptions(){
  const sel = $("fConst");
  const list = [...new Set(ROWS.filter(r=>!S.region || r[2]===S.region).map(r=>r[1]))].sort();
  if(S.cons && !list.includes(S.cons)) S.cons = "";
  sel.length = 1;
  list.forEach(x=>sel.add(new Option(nice(x),x)));
  sel.value = S.cons;
}

function showTab(tab, first){
  S.tab = tab;
  const isMap = tab==="map";
  $("tabMap").setAttribute("aria-selected",String(isMap)); $("tabMap").tabIndex = isMap?0:-1;
  $("tabCharts").setAttribute("aria-selected",String(!isMap)); $("tabCharts").tabIndex = isMap?-1:0;
  $("panelMap").hidden = !isMap;
  $("panelCharts").hidden = isMap;
  // Leaflet measures its box once; a map that was hidden must be told it is visible again.
  if(isMap && map) setTimeout(()=>{
    map.invalidateSize();
    if(pendingFit){ pendingFit=false; fit(); }
  },0);
  if(!first) writeHash();
}

function fit(){
  const pts = markers.map(m=>m.getLatLng());
  if(pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.15),{maxZoom:12});
}

/* ---------- render ---------- */
function render(refit){
  const rows = filtered();
  const groups = aggregate(rows);
  const shown = groups.filter(g=>valueOf(g)>0);
  const vmax = shown.reduce((a,g)=>Math.max(a,valueOf(g)),1);
  REF = S.view==="all" ? 12 : Math.max(2,Math.min(12,vmax));
  shown.sort((a,b)=>valueOf(b)-valueOf(a));

  group.clearLayers(); markers = [];
  for(const g of shown){
    const v = valueOf(g), c = colorOf(g);
    const mk = L.circleMarker([g.lat,g.lon],{radius:radius(v),fillColor:c,fillOpacity:.82,color:"#ffffff",weight:1.2});
    mk.bindTooltip(tipHtml(g,v),{direction:"top",offset:[0,-4],sticky:false});
    mk.bindPopup(()=>popHtml(g),{maxWidth:300});
    mk.addTo(group); markers.push(mk); g.marker = mk;
  }

  const n=rows.length, d=rows.reduce((a,r)=>a+r[7],0);
  $("kPat").textContent=n; $("kDead").textContent=d; $("kRate").textContent=pct(d,n)+"%"; $("kLoc").textContent=groups.length;
  legend(); places(shown); chips(); charts();
  $("mapNote").textContent = S.spread
    ? "Where many patients share one coordinate, each area is placed around it, so positions inside a cluster are approximate."
    : "Circles sit at the coordinates in the data. Many patients share the same point, so they stack.";
  $("actionNote").textContent = "";
  writeHash();
  // A hidden map has no size to fit to, so wait until the Map tab is shown.
  if(refit){ if(S.tab==="map") fit(); else pendingFit=true; }
}

function placeName(g){
  const areas=[...g.areas.keys()];
  if(areas.length===1) return nice(areas[0]);
  const cs=[...g.cons].map(nice);
  return cs.slice(0,2).join(" / ") + (cs.length>2 ? " +"+(cs.length-2) : "");
}
function tipHtml(g,v){
  const w = S.view==="deaths" ? "death" : S.view==="alive" ? "alive" : "patient";
  return "<b>"+esc(placeName(g))+"</b><br>"+v+" "+w+(v===1?"":"s")+" ("+g.n+" patients, "+g.d+" died)";
}
function popHtml(g){
  const areas=[...g.areas.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  const list=areas.map(([a,c])=>esc(nice(a))+" ("+c+")").join(", ");
  return '<div class="pop"><h3>'+esc(placeName(g))+'</h3>'+
    '<div class="meta">'+esc([...g.cons].map(nice).join(", "))+' | '+esc([...g.regs].join(", "))+'</div>'+
    '<table><tr><td>Patients</td><td>'+g.n+'</td></tr><tr><td>Alive</td><td>'+(g.n-g.d)+'</td></tr>'+
    '<tr><td>Died</td><td>'+g.d+'</td></tr><tr><td>Death rate</td><td>'+pct(g.d,g.n)+'%</td></tr>'+
    '<tr><td>MDR-TB</td><td>'+g.mdr+'</td></tr><tr><td>HIV-positive</td><td>'+g.hiv+'</td></tr></table>'+
    '<div class="areas"><b>Areas:</b> '+list+'</div>'+
    (g.spread?'<div class="warn">Placed around the cluster centre. The exact spot is unknown.</div>':'')+'</div>';
}

function legend(){
  const L1 = $("legend"), L2 = $("sizes");
  const item = (c,t)=>'<div class="item"><span class="dot" style="background:'+c+'"></span>'+t+'</div>';
  if(S.view==="all") L1.innerHTML = item(COL.blue,"No deaths here")+item(COL.amber,"1 death")+item(COL.red,"2 or more deaths")+
    '<div style="color:var(--ink2)">Bigger circle = more patients.</div>';
  else if(S.view==="deaths") L1.innerHTML = item(COL.red,"Places with at least one death")+'<div style="color:var(--ink2)">Bigger circle = more deaths.</div>';
  else L1.innerHTML = item(COL.blue,"Places with patients alive")+'<div style="color:var(--ink2)">Bigger circle = more patients alive.</div>';
  const vals=[...new Set([1,Math.max(2,Math.round(REF*0.45)),REF])];
  const c = S.view==="deaths"?COL.red:S.view==="alive"?COL.blue:"#9aa5ad";
  L2.innerHTML = vals.map(v=>{const r=radius(v);return '<div><svg width="'+(2*r+2)+'" height="'+(2*r+2)+'" aria-hidden="true"><circle cx="'+(r+1)+'" cy="'+(r+1)+'" r="'+r+'" fill="'+c+'" fill-opacity=".82" stroke="#fff"/></svg>'+v+(v===REF&&S.view==="all"?"+":"")+'</div>';}).join("");
}

function places(shown){
  const top = shown.slice(0,8);
  const mx = top.length ? valueOf(top[0]) : 1;
  $("placesTitle").textContent = S.view==="deaths" ? "Places with the most deaths" : S.view==="alive" ? "Places with the most patients alive" : "Places with the most patients";
  $("places").innerHTML = "";
  top.forEach(g=>{
    const v=valueOf(g), li=document.createElement("li"), b=document.createElement("button");
    b.type="button";
    b.innerHTML='<span class="nm">'+esc(placeName(g))+'<small>'+esc([...g.regs].join(", "))+' | '+g.n+' patients, '+g.d+' died</small></span>'+
      '<span class="bar"><i style="width:'+Math.max(4,Math.round(60*v/mx))+'px;background:'+colorOf(g)+'"></i>'+v+'</span>';
    b.addEventListener("click",()=>{
      if(S.tab!=="map") showTab("map");
      map.flyTo([g.lat,g.lon],Math.max(map.getZoom(),12),{duration:.6});
      setTimeout(()=>g.marker.openPopup(),650);
    });
    li.appendChild(b); $("places").appendChild(li);
  });
  if(!top.length) $("places").innerHTML='<li style="color:var(--ink2);padding:6px 4px">Nothing matches these filters.</li>';
}

/* ---------- active filter chips ---------- */
function filterLabel(k){
  const sel = $(FILTER_SELECT[k]), o = [...sel.options].find(x=>x.value===S[k]);
  const name = {region:"Region",tb:"TB type",hiv:"HIV",sex:"Sex",age:"Age",cons:"Constituency"}[k];
  return name+": "+(o ? o.text : S[k]);
}
function chips(){
  const box = $("chips");
  box.textContent = "";
  for(const k of FILTERS){
    if(S[k]==="") continue;
    const span=document.createElement("span"), x=document.createElement("button");
    span.className="chip"; span.textContent=filterLabel(k);
    x.type="button"; x.textContent="×"; x.setAttribute("aria-label","Remove filter "+filterLabel(k));
    x.addEventListener("click",()=>setFilter(k,""));
    span.appendChild(x); box.appendChild(span);
  }
}

/* ---------- charts ---------- */
// Each chart: how to read a row's group key, how to label it, and the filter
// value clicking it sets (null = not clickable, e.g. ages outside the groups).
const CHARTS = [
  {title:"Region", filter:"region", key:r=>r[2], label:k=>k, value:k=>k},
  {title:"Age group", filter:"age", key:r=>ageGroup(r[6])||"Other or unknown", label:k=>k,
   value:k=>AGE_GROUPS.some(g=>g[0]===k)?k:null, order:[...AGE_GROUPS.map(g=>g[0]),"Other or unknown"]},
  {title:"Sex", filter:"sex", key:r=>r[5], label:k=>k, value:k=>k},
  {title:"HIV status", filter:"hiv", key:r=>String(r[4]), label:k=>k==="1"?"HIV-positive":"HIV-negative", value:k=>k, order:["1","0"]},
  {title:"TB type", filter:"tb", key:r=>String(r[3]), label:k=>k==="1"?"MDR-TB":"Drug-sensitive", value:k=>k, order:["0","1"]},
  {title:"Constituency", filter:"cons", key:r=>r[1], label:k=>nice(k), value:k=>k, top:12},
];

function charts(){
  const grid = $("chartGrid");
  grid.textContent = "";
  for(const c of CHARTS) grid.appendChild(chartCard(c));
}

function chartCard(c){
  const rows = filtered(c.filter);
  const m = new Map();
  for(const r of rows){
    const k = c.key(r);
    const g = m.get(k) || {n:0,d:0};
    g.n++; g.d += r[7]; m.set(k,g);
  }
  let items = [...m.entries()].map(([k,g])=>({k, n:g.n, d:g.d}));
  if(c.order) items.sort((a,b)=>c.order.indexOf(a.k)-c.order.indexOf(b.k));
  else items.sort((a,b)=>b.n-a.n || String(a.k).localeCompare(String(b.k)));
  const hidden = c.top && items.length>c.top ? items.length-c.top : 0;
  if(hidden){
    // Keep a selected constituency visible even when it is outside the top list.
    const sel = items.findIndex(i=>i.k===S[c.filter]);
    const keep = items.slice(0,c.top);
    if(sel>=c.top) keep[c.top-1] = items[sel];
    items = keep;
  }
  const mx = items.reduce((a,i)=>Math.max(a,i.n),1);

  const card=document.createElement("div"); card.className="chart";
  const h=document.createElement("h3"); h.textContent=c.title;
  const sm=document.createElement("small"); sm.textContent=rows.length+" patients"; h.appendChild(sm);
  card.appendChild(h);
  if(!items.length){
    const p=document.createElement("p"); p.className="empty"; p.textContent="Nothing matches these filters."; card.appendChild(p);
    return card;
  }
  const ul=document.createElement("ul"); ul.className="bars";
  for(const it of items){
    const val = c.value(it.k), label = c.label(it.k), alive = it.n-it.d, rate = pct(it.d,it.n);
    const li=document.createElement("li");
    const b=document.createElement(val===null?"div":"button");
    b.className="bar-row";
    const desc = label+": "+it.n+(it.n===1?" patient, ":" patients, ")+alive+" alive, "+it.d+" died, death rate "+rate+"%";
    b.title = desc;
    if(val!==null){
      b.type="button";
      b.setAttribute("aria-pressed",String(S[c.filter]===val));
      b.setAttribute("aria-label",desc+(S[c.filter]===val?". Click to remove this filter.":". Click to filter by this."));
      b.addEventListener("click",()=>setFilter(c.filter, S[c.filter]===val ? "" : val));
    }
    const lab=document.createElement("span"); lab.className="bar-label"; lab.textContent=label;
    const sub=document.createElement("small"); sub.textContent=it.n+(it.n===1?" patient, ":" patients, ")+it.d+" died"; lab.appendChild(sub);
    const track=document.createElement("span"); track.className="bar-track"; track.setAttribute("aria-hidden","true");
    track.style.width=Math.max(2,100*it.n/mx)+"%";
    if(alive){ const a=document.createElement("i"); a.className="a"; a.style.flex=String(alive); track.appendChild(a); }
    if(it.d){ const d=document.createElement("i"); d.className="d"; d.style.flex=String(it.d); track.appendChild(d); }
    const rt=document.createElement("span"); rt.className="bar-rate"+(it.n<FEW?" few":""); rt.textContent=rate+"%";
    b.append(lab,track,rt); li.appendChild(b); ul.appendChild(li);
  }
  card.appendChild(ul);
  if(hidden){
    const p=document.createElement("p"); p.className="more";
    p.textContent="Showing the "+c.top+" biggest of "+(hidden+c.top)+". Pick any constituency from the filter on the left.";
    card.appendChild(p);
  }
  return card;
}

/* ---------- downloads and links ---------- */
// Summary only (counts per constituency), never patient-level rows.
function downloadCsv(){
  const rows = filtered();
  const m = new Map();
  for(const r of rows){
    const k = r[2]+"\u0000"+r[1];
    const g = m.get(k) || {region:r[2], cons:r[1], n:0, d:0, mdr:0, hiv:0};
    g.n++; g.d+=r[7]; g.mdr+=r[3]; g.hiv+=r[4]; m.set(k,g);
  }
  const cell = v => {
    let s = String(v);
    if(/^[=+\-@\t\r]/.test(s)) s = "'"+s; // stop spreadsheets reading it as a formula
    return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  };
  const active = FILTERS.filter(k=>S[k]!=="").map(filterLabel);
  const lines = [
    "# Eswatini TB map summary, "+new Date().toISOString().slice(0,10)+". Filters: "+(active.length?active.join("; "):"none")+". Internal use only.",
    ["region","constituency","patients","alive","deaths","death_rate_pct","mdr_tb","hiv_positive"].join(","),
    ...[...m.values()].sort((a,b)=>a.region.localeCompare(b.region)||a.cons.localeCompare(b.cons))
      .map(g=>[g.region,nice(g.cons),g.n,g.n-g.d,g.d,pct(g.d,g.n),g.mdr,g.hiv].map(cell).join(",")),
  ];
  const blob = new Blob([lines.join("\r\n")+"\r\n"],{type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "eswatini-tb-summary.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  $("actionNote").textContent = "Downloaded counts for "+m.size+" constituencies.";
}

/* ---------- map picture (PNG) ---------- */
// Drawn in the browser from what is on screen right now, so it always matches the
// filters and never needs an unencrypted copy of the map stored on the website.
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function downloadPng(){
  const btn=$("bPng"), note=$("pngNote");
  btn.disabled=true; btn.textContent="Preparing...";
  note.textContent="";
  try{
    if(S.tab!=="map"){ showTab("map"); await sleep(450); }
    // Give the basemap up to 5 s to finish loading the tiles in view.
    for(let t=0; S.base && baseLayer.isLoading && baseLayer.isLoading() && t<50; t++) await sleep(100);
    let blob, withTiles = S.base;
    try{ blob = await drawMapPng(withTiles); }
    catch(ex){ withTiles=false; blob = await drawMapPng(false); } // tiles blocked: still give the circles
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="eswatini-tb-map-"+new Date().toISOString().slice(0,10)+".png";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    note.textContent = S.base && !withTiles ? "Downloaded without the street basemap (it could not be copied)." : "Map downloaded. It shows patient locations, so keep it inside the organisation.";
  }catch(ex){
    note.textContent="The picture could not be made in this browser.";
  }finally{
    btn.disabled=false; btn.textContent="Download map (PNG)";
  }
}

function drawMapPng(withTiles){
  const el=$("map"), box=el.getBoundingClientRect();
  const W=Math.round(box.width), MH=Math.round(box.height), HEAD=96, FOOT=64, H=HEAD+MH+FOOT;
  const k=2, c=document.createElement("canvas");
  c.width=W*k; c.height=H*k;
  const x=c.getContext("2d");
  x.scale(k,k);
  const font=(w,sz,serif)=>w+" "+sz+"px "+(serif?'Georgia,"Times New Roman",serif':'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif');
  x.fillStyle="#ffffff"; x.fillRect(0,0,W,H);

  // header: title, what is shown, the numbers
  const rows=filtered(), n=rows.length, d=rows.reduce((a,r)=>a+r[7],0);
  const view={all:"All patients",deaths:"Deaths only",alive:"Alive only"}[S.view];
  const active=FILTERS.filter(k=>S[k]!=="").map(filterLabel);
  x.fillStyle="#14213d"; x.font=font("600",22,true); x.fillText("Eswatini TB Map",16,32);
  x.fillStyle="#4b5565"; x.font=font("400",13);
  x.fillText(fitText(x,view+"  |  Filters: "+(active.length?active.join("; "):"none"),W-32),16,56);
  x.fillStyle="#1d2433"; x.font=font("600",13);
  x.fillText(n+" patients  |  "+d+" deaths  |  "+pct(d,n)+"% death rate  |  "+$("kLoc").textContent+" places",16,78);

  // map: basemap tiles, then the circle canvas(es) Leaflet drew, clipped to the map box
  x.save(); x.beginPath(); x.rect(0,HEAD,W,MH); x.clip();
  x.fillStyle="#e9f0f4"; x.fillRect(0,HEAD,W,MH);
  const put=(img,r)=>x.drawImage(img,r.left-box.left,HEAD+r.top-box.top,r.width,r.height);
  if(withTiles){
    el.querySelectorAll(".leaflet-tile-pane img.leaflet-tile-loaded").forEach(img=>{
      if(img.closest(".leaflet-layer") && getComputedStyle(img).opacity!=="0") put(img,img.getBoundingClientRect());
    });
  }
  el.querySelectorAll(".leaflet-overlay-pane canvas").forEach(cv=>put(cv,cv.getBoundingClientRect()));
  x.restore();
  x.strokeStyle="#dedbd2"; x.lineWidth=1; x.strokeRect(0.5,HEAD+0.5,W-1,MH-1);

  // footer: legend and source
  let lx=16; const ly=HEAD+MH+24;
  const item=(col,t)=>{ x.fillStyle=col; x.beginPath(); x.arc(lx+6,ly-4,6,0,7); x.fill(); x.strokeStyle="#fff"; x.stroke();
    x.fillStyle="#1d2433"; x.font=font("400",12); x.fillText(t,lx+18,ly); lx+=28+x.measureText(t).width; };
  if(S.view==="all"){ item(COL.blue,"No deaths here"); item(COL.amber,"1 death"); item(COL.red,"2 or more deaths"); }
  else if(S.view==="deaths") item(COL.red,"Places with at least one death");
  else item(COL.blue,"Places with patients alive");
  x.fillStyle="#4b5565"; x.font=font("400",12);
  x.fillText(S.view==="deaths"?"Bigger circle = more deaths.":S.view==="alive"?"Bigger circle = more patients alive.":"Bigger circle = more patients.",lx,ly);
  x.fillStyle="#788091"; x.font=font("400",11);
  const src=(withTiles?"Basemap \u00a9 OpenStreetMap contributors  |  ":"")+"Made "+new Date().toISOString().slice(0,10)+"  |  For internal use by the organisation only. Do not share outside it.";
  x.fillText(fitText(x,src,W-32),16,ly+24);

  // toBlob throws (or returns null) if a tile without CORS tainted the canvas
  return new Promise((res,rej)=>{
    try{ c.toBlob(b=>b?res(b):rej(new Error("empty")),"image/png"); }catch(ex){ rej(ex); }
  });
}
function fitText(x,t,max){
  if(x.measureText(t).width<=max) return t;
  while(t.length>1 && x.measureText(t+"...").width>max) t=t.slice(0,-1);
  return t+"...";
}

async function copyLink(){
  writeHash();
  try{
    await navigator.clipboard.writeText(location.href);
    $("actionNote").textContent = "Link copied. Whoever opens it still needs the password.";
  }catch(ex){
    $("actionNote").textContent = "Copy this address from the browser bar: "+location.href;
  }
}

function loadGeo(e){
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const gj=JSON.parse(rd.result);
      if(geoLayer) map.removeLayer(geoLayer);
      geoLayer=L.geoJSON(gj,{style:{color:"#8c887d",weight:1,fillColor:"#f4f2ec",fillOpacity:.25},interactive:false}).addTo(map);
      geoLayer.bringToBack();
    }catch(ex){ $("mapNote").textContent="That file is not valid GeoJSON, so no boundaries were added."; }
  };
  rd.readAsText(f);
}
