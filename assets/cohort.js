"use strict";
/* Charts tab: the TB patient cohort dashboard (its own encrypted data, filters and password).
   The map and the left panel never read this data, and this file never reads theirs. */
(function(){
  const COLS = ["id","area","constituency","region","helminth","tbType","hiv","gender","age","status"];
  let DATA = null, TOTAL = 0, unlocked = false;
  const $ = id => document.getElementById(id);

  const REGION_HEX_LIGHT = { "Hhohho":"#2a78d6", "Manzini":"#eb6834", "Lubombo":"#1baf7a", "Shiselweni":"#4a3aa7" };
  const REGION_HEX_DARK  = { "Hhohho":"#3987e5", "Manzini":"#d95926", "Lubombo":"#199e70", "Shiselweni":"#9085e9" };
  const darkMQ = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function isDark(){
    const t = document.documentElement.getAttribute("data-theme");
    if (t === "dark") return true;
    if (t === "light") return false;
    return !!(darkMQ && darkMQ.matches);
  }
  const regionHex = region => (isDark() ? REGION_HEX_DARK : REGION_HEX_LIGHT)[region] || "#2a78d6";

  /* ---------------- helpers ---------------- */
  function countBy(arr, key){ const m = new Map(); arr.forEach(r => m.set(r[key], (m.get(r[key])||0)+1)); return m; }
  const pct = (n, d) => d ? (n/d*100) : 0;
  const fmtPct = n => (isFinite(n) ? n : 0).toFixed(1) + "%";
  function el(tag, attrs, ...kids){
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs){ if (k === "class") e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    kids.flat().forEach(k => { if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k))); });
    return e;
  }
  const SVGNS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs){ const e = document.createElementNS(SVGNS, tag); if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }

  /* ---------------- shared tooltip ---------------- */
  const tip = el("div", {id:"coTooltip", class:"co-tooltip", role:"status", "aria-live":"polite"});
  document.addEventListener("DOMContentLoaded", () => document.body.append(tip));
  function showTip(evt, title, rows){
    tip.textContent = "";
    tip.append(el("div", {class:"t-title"}, title));
    rows.forEach(r => {
      const row = el("div", {class:"t-row"});
      if (r.color) row.append(el("span", {class:"t-key", style:`background:${r.color}`}));
      row.append(el("span", null, r.label), el("span", {class:"t-val"}, r.value));
      tip.append(row);
    });
    moveTip(evt);
    tip.classList.add("show");
  }
  function moveTip(evt){
    const pad = 14, rect = tip.getBoundingClientRect();
    let left = evt.clientX + pad, top = evt.clientY + pad;
    if (left + rect.width > window.innerWidth - 10) left = evt.clientX - rect.width - pad;
    if (top + rect.height > window.innerHeight - 10) top = evt.clientY - rect.height - pad;
    tip.style.left = left + "px"; tip.style.top = top + "px";
  }
  const hideTip = () => tip.classList.remove("show");
  function bindHover(node, title, rows){
    node.setAttribute("tabindex", "0");
    const rowsFn = typeof rows === "function" ? rows : () => rows;
    node.addEventListener("pointerenter", e => showTip(e, title, rowsFn()));
    node.addEventListener("pointermove", moveTip);
    node.addEventListener("pointerleave", hideTip);
    node.addEventListener("focus", () => { const b = node.getBoundingClientRect(); showTip({clientX:b.left, clientY:b.top}, title, rowsFn()); });
    node.addEventListener("blur", hideTip);
  }

  /* ---------------- filters ---------------- */
  const filters = { region:"", tbType:"", hiv:"", gender:"", status:"", helminth:"", q:"" };
  const FILTER_IDS = [["coRegion","region"],["coTb","tbType"],["coHiv","hiv"],["coGender","gender"],["coStatus","status"],["coHelminth","helminth"]];
  function filteredData(){
    const q = filters.q.trim().toLowerCase();
    return DATA.filter(r => {
      for (const [, k] of FILTER_IDS) if (filters[k] && r[k] !== filters[k]) return false;
      if (q && !`${r.id} ${r.area} ${r.constituency} ${r.region}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function initApp(){
    $("coSub").textContent = `${TOTAL} patients enrolled across ${[...new Set(DATA.map(r=>r.region))].sort().join(", ")}, followed from enrollment through to outcome.`;
    for (const [id, k] of FILTER_IDS){
      const sel = $(id);
      [...new Set(DATA.map(r=>r[k]))].sort().forEach(v => sel.append(el("option", {value:v}, v)));
      sel.addEventListener("change", e => { filters[k] = e.target.value; renderAll(); });
    }
    $("coSearch").addEventListener("input", e => { filters.q = e.target.value; renderAll(); });
    $("coReset").addEventListener("click", () => {
      Object.keys(filters).forEach(k => filters[k] = "");
      FILTER_IDS.forEach(([id]) => $(id).value = "");
      $("coSearch").value = "";
      renderAll();
    });
    // Section buttons scroll inside the Charts panel (no #anchors, so the page link state is untouched).
    document.querySelectorAll(".co-nav button").forEach(b => b.addEventListener("click", () => {
      $(b.dataset.target).scrollIntoView({behavior:"smooth", block:"start"});
    }));
    buildTableHead();
    if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener("change", renderAll);
    renderAll();
  }

  /* ---------------- bar list ---------------- */
  function renderBarList(containerId, items, opts={}){
    const container = $(containerId);
    container.textContent = "";
    if (!items.length){ container.append(el("div", {class:"co-cap"}, "No data for the current filter.")); return; }
    const max = Math.max(...items.map(it => it.total ?? it.value), 1);
    items.forEach(it => {
      const row = el("div", {class:"co-barrow"});
      row.append(el("div", {class:"rlabel", title:it.label}, it.label));
      const track = el("div", {class:"track"});
      if (it.segments){
        let left = 0;
        it.segments.forEach(seg => {
          const w = pct(seg.value, max);
          const s = el("div", {class:"bseg", style:`left:${left}%; width:${Math.max(w,0)}%; background:${seg.color}; opacity:${seg.hidden?0.15:1};`});
          bindHover(s, it.label, () => it.segments.map(sg => ({label:sg.name, value:`${sg.value} (${fmtPct(pct(sg.value, sg.of))})`, color:sg.color})));
          track.append(s);
          left += w;
        });
      } else {
        const w = pct(it.value, max);
        const s = el("div", {class:"bseg", style:`left:0; width:${Math.max(w,1.2)}%; background:${it.color || "var(--co-series-1)"};`});
        bindHover(s, it.label, () => [{label:opts.tipLabel || "Patients", value:it.valueLabel ?? `${it.value}`, color:it.color || "var(--co-series-1)"}]);
        track.append(s);
      }
      row.append(track, el("div", {class:"val"}, it.valueLabel ?? (it.total ?? it.value)));
      container.append(row);
    });
  }

  function renderTable(tableId, headers, rows){
    const t = $(tableId);
    t.textContent = "";
    t.append(el("thead", null, el("tr", null, headers.map(h => el("th", null, h)))),
             el("tbody", null, rows.map(r => el("tr", null, r.map(c => el("td", null, String(c)))))));
  }

  /* ---------------- pie ---------------- */
  function polar(cx, cy, r, deg){ const rad = (deg-90)*Math.PI/180; return {x:cx+r*Math.cos(rad), y:cy+r*Math.sin(rad)}; }
  function arcPath(cx, cy, r, a0, a1){
    if (a1 - a0 >= 359.999) a1 = a0 + 359.999;
    const s = polar(cx,cy,r,a0), e = polar(cx,cy,r,a1);
    return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${a1-a0 <= 180 ? 0 : 1} 1 ${e.x} ${e.y} Z`;
  }
  const pieHidden = new Set();
  function renderPie(containerId, tableId, items){
    const host = $(containerId);
    host.textContent = "";
    const total = items.reduce((s,i)=>s+i.value, 0);
    const size = 180, c = size/2, r = c - 6;
    const svg = svgEl("svg", {width:size, height:size, viewBox:`0 0 ${size} ${size}`, role:"img", "aria-label":"Regional share pie chart"});
    const visTotal = items.filter(i=>!pieHidden.has(i.label)).reduce((s,i)=>s+i.value, 0) || 1;
    let angle = 0;
    items.forEach(it => {
      if (pieHidden.has(it.label)) return;
      const sweep = it.value/visTotal*360;
      const path = svgEl("path", {class:"slice", d:arcPath(c,c,r,angle,angle+sweep), fill:it.color, stroke:"var(--co-surface-2)", "stroke-width":"2"});
      bindHover(path, it.label, () => [{label:"Patients", value:`${it.value} (${fmtPct(pct(it.value,total))})`, color:it.color}]);
      svg.append(path);
      angle += sweep;
    });
    const legend = el("div", {class:"pielegend"});
    items.forEach(it => {
      const row = el("button", {type:"button", class:"prow" + (pieHidden.has(it.label) ? " off" : ""), "aria-pressed":String(!pieHidden.has(it.label))});
      row.append(el("span", {class:"swatch", style:`background:${it.color}`}), it.label, el("span", {class:"n"}, `${it.value} · ${fmtPct(pct(it.value,total))}`));
      row.addEventListener("click", () => { pieHidden.has(it.label) ? pieHidden.delete(it.label) : pieHidden.add(it.label); renderPie(containerId, tableId, items); });
      legend.append(row);
    });
    host.append(svg, legend);
    renderTable(tableId, ["Region","Patients","Share"], items.map(i => [i.label, i.value, fmtPct(pct(i.value,total))]));
  }

  /* ---------------- meter ---------------- */
  function renderMeter(container, {value, total, label, sublabel, color}){
    const size = 108, c = size/2, rad = c - 9, sw = 9, circ = 2*Math.PI*rad, frac = total ? value/total : 0;
    const svg = svgEl("svg", {width:size, height:size, viewBox:`0 0 ${size} ${size}`, role:"img", "aria-label":`${label} ${fmtPct(frac*100)}`});
    svg.append(svgEl("circle", {cx:c, cy:c, r:rad, fill:"none", stroke:"var(--co-gridline)", "stroke-width":sw}));
    svg.append(svgEl("circle", {cx:c, cy:c, r:rad, fill:"none", stroke:color, "stroke-width":sw, "stroke-linecap":"round",
      "stroke-dasharray":`${circ*frac} ${circ}`, transform:`rotate(-90 ${c} ${c})`}));
    bindHover(svg, label, () => [{label:"Value", value:`${value} / ${total} (${fmtPct(frac*100)})`, color}]);
    container.append(el("div", {class:"co-meter"}, svg,
      el("div", {class:"mval"}, fmtPct(frac*100)), el("div", {class:"mlabel"}, label), el("div", {class:"msub"}, sublabel || "")));
  }

  /* ---------------- render everything ---------------- */
  function renderAll(){
    if (!DATA) return;
    const D = filteredData();
    $("coShown").textContent = `${D.length} of ${TOTAL} patients shown`;

    /* KPIs */
    const died = D.filter(r=>r.status==="Died").length, alive = D.length - died;
    const mdr = D.filter(r=>r.tbType==="MDR-TB").length, hivPos = D.filter(r=>r.hiv==="Positive").length;
    const avgAge = D.length ? D.reduce((s,r)=>s+r.age,0)/D.length : 0;
    const kpis = [
      {label:"Patients shown", value:D.length},
      {label:"Alive", value:alive, cls:"good", delta:fmtPct(pct(alive,D.length)) + " of shown"},
      {label:"Died", value:died, cls:"critical", delta:fmtPct(pct(died,D.length)) + " mortality rate"},
      {label:"MDR-TB cases", value:mdr, delta:fmtPct(pct(mdr,D.length)) + " of shown"},
      {label:"HIV-positive", value:hivPos, delta:fmtPct(pct(hivPos,D.length)) + " of shown"},
      {label:"Avg. age", value:(D.length ? avgAge.toFixed(1) : "N/A") + " yrs", delta:D.length ? `range ${Math.min(...D.map(r=>r.age))} to ${Math.max(...D.map(r=>r.age))}` : ""},
    ];
    const kpiRow = $("coKpis"); kpiRow.textContent = "";
    kpis.forEach(k => kpiRow.append(el("div", {class:"co-stat"},
      el("div", {class:"label"}, k.label), el("div", {class:"value" + (k.cls ? " "+k.cls : "")}, String(k.value)), el("div", {class:"delta"}, k.delta || ""))));

    /* Region bar + pie */
    const regionItems = [...countBy(D,"region").entries()].sort((a,b)=>b[1]-a[1]).map(([label,value]) => ({label, value, color:regionHex(label)}));
    renderBarList("coChartRegion", regionItems);
    renderTable("coTblRegion", ["Region","Patients"], regionItems.map(i=>[i.label,i.value]));
    if (regionItems.length) renderPie("coPieRegion", "coTblPieRegion", regionItems);
    else { $("coPieRegion").textContent = "No data for the current filter."; renderTable("coTblPieRegion", ["Region","Patients","Share"], []); }

    renderOutcomeByRegion(D);

    /* Top constituencies */
    const constItems = [...countBy(D,"constituency").entries()].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([label,value])=>({label, value, color:"var(--co-series-1)"}));
    renderBarList("coChartConst", constItems);
    renderTable("coTblConst", ["Constituency","Patients"], constItems.map(i=>[i.label,i.value]));

    /* Meters */
    const meters = $("coMeters"); meters.textContent = "";
    [
      {label:"MDR-TB share", value:mdr, total:D.length, color:"var(--co-series-2)", sublabel:"of shown cohort"},
      {label:"HIV-positive", value:hivPos, total:D.length, color:"var(--co-series-1)", sublabel:"of shown cohort"},
      {label:"Helminth co-enrolled", value:D.filter(r=>r.helminth==="Yes").length, total:D.length, color:"var(--co-series-3)", sublabel:"of shown cohort"},
      {label:"Mortality rate", value:died, total:D.length, color:"var(--co-critical)", sublabel:'recorded as "Died"'},
    ].forEach(s => { const card = el("figure", {class:"co-card"}); meters.append(card); renderMeter(card, s); });

    /* TB type, HIV, gender */
    [["tbType","coChartTb","coTblTb","TB type"],["hiv","coChartHiv","coTblHiv","HIV status"],["gender","coChartGender","coTblGender","Gender"]].forEach(([key,chart,tbl,head]) => {
      const items = [...countBy(D,key).entries()].sort((a,b)=>b[1]-a[1]).map(([label,value])=>({label, value, color:"var(--co-series-1)"}));
      renderBarList(chart, items);
      renderTable(tbl, [head,"Patients","Share"], items.map(i=>[i.label, i.value, fmtPct(pct(i.value,D.length))]));
    });

    /* Age histogram */
    const bins = [[0,25,"18-24"],[25,35,"25-34"],[35,45,"35-44"],[45,55,"45-54"],[55,65,"55-64"],[65,200,"65+"]];
    const counts = bins.map(([lo,hi,label]) => ({label, value:D.filter(r=>r.age>=lo && r.age<hi).length}));
    const maxN = Math.max(...counts.map(c=>c.value), 1);
    const hist = $("coChartAge"); hist.textContent = "";
    counts.forEach(c => {
      const bar = el("div", {class:"bar", style:`height:${Math.max(pct(c.value,maxN),3)}%;`}, el("span", {class:"n"}, String(c.value)));
      bindHover(bar, c.label, () => [{label:"Patients", value:String(c.value), color:"var(--co-series-1)"}]);
      hist.append(el("div", {class:"col"}, bar, el("div", {class:"glabel"}, c.label)));
    });
    renderTable("coTblAge", ["Age group","Patients"], counts.map(c=>[c.label,c.value]));

    /* Mortality by factor */
    const rate = pred => { const rows = D.filter(pred), d = rows.filter(r=>r.status==="Died").length; return {n:rows.length, d, r:pct(d,rows.length)}; };
    const factors = [
      ["TB type: MDR-TB", r=>r.tbType==="MDR-TB"], ["TB type: DSTB", r=>r.tbType==="DSTB"],
      ["HIV: Positive", r=>r.hiv==="Positive"], ["HIV: Negative", r=>r.hiv==="Negative"],
      ["Gender: Female", r=>r.gender==="Female"], ["Gender: Male", r=>r.gender==="Male"],
      ["Helminth: enrolled", r=>r.helminth==="Yes"], ["Helminth: not enrolled", r=>r.helminth==="No"],
    ];
    const mort = factors.map(([label,pred]) => { const {n,d,r} = rate(pred); return {label, value:r, color:"var(--co-series-1)", valueLabel:n ? `${fmtPct(r)} (${d}/${n})` : "N/A"}; }).sort((a,b)=>b.value-a.value);
    renderBarList("coChartMortality", mort, {tipLabel:"Mortality rate"});
    renderTable("coTblMortality", ["Subgroup","Mortality rate"], mort.map(i=>[i.label, i.valueLabel]));

    renderRows(D);
    renderNetwork(D);
  }

  /* ---------------- outcome by region ---------------- */
  const outcomeVisible = { Alive:true, Died:true };
  function renderOutcomeByRegion(D){
    const legend = $("coLegendOutcome"); legend.textContent = "";
    [["Alive","var(--co-good)"],["Died","var(--co-critical)"]].forEach(([name,color]) => {
      const btn = el("button", {type:"button", class:"item" + (outcomeVisible[name] ? "" : " off"), "aria-pressed":String(outcomeVisible[name])},
        el("span", {class:"swatch", style:`background:${color}`}), name);
      btn.addEventListener("click", () => { outcomeVisible[name] = !outcomeVisible[name]; renderAll(); });
      legend.append(btn);
    });
    const items = [...new Set(DATA.map(r=>r.region))].map(region => {
      const rows = D.filter(r=>r.region===region), d = rows.filter(r=>r.status==="Died").length, a = rows.length - d;
      return {label:region, n:rows.length, segments:[
        {name:"Alive", value:a, of:rows.length, color:"var(--co-good)", hidden:!outcomeVisible.Alive},
        {name:"Died", value:d, of:rows.length, color:"var(--co-critical)", hidden:!outcomeVisible.Died},
      ], valueLabel:`${a} / ${d}`};
    }).filter(i=>i.n>0).sort((x,y)=>y.n-x.n);
    const visMax = Math.max(...items.map(i => (outcomeVisible.Alive ? i.segments[0].value : 0) + (outcomeVisible.Died ? i.segments[1].value : 0)), 1);
    items.forEach(i => { i.total = visMax; });
    renderBarList("coChartOutcome", items);
    renderTable("coTblOutcome", ["Region","Alive","Died","Mortality rate"],
      items.map(i => [i.label, i.segments[0].value, i.segments[1].value, fmtPct(pct(i.segments[1].value, i.n))]));
  }

  /* ---------------- patient table ---------------- */
  const headerDefs = [
    {key:"id", label:"Participant ID"}, {key:"area", label:"Area"}, {key:"constituency", label:"Constituency"},
    {key:"region", label:"Region"}, {key:"tbType", label:"TB type"}, {key:"hiv", label:"HIV status"},
    {key:"gender", label:"Gender"}, {key:"age", label:"Age"}, {key:"helminth", label:"Helminth study"}, {key:"status", label:"Status"},
  ];
  let sortKey = "id", sortDir = 1;
  function buildTableHead(){
    const tr = $("coTheadRow");
    headerDefs.forEach(h => {
      const btn = el("button", {type:"button"}, h.label, el("span", {class:"arrow"}, ""));
      btn.addEventListener("click", () => { if (sortKey === h.key) sortDir *= -1; else { sortKey = h.key; sortDir = 1; } renderRows(filteredData()); });
      tr.append(el("th", {scope:"col"}, btn));
    });
  }
  function renderRows(D){
    $("coRowCount").textContent = `${D.length} of ${TOTAL} patients`;
    const rows = D.slice().sort((a,b) => {
      const av = a[sortKey], bv = b[sortKey];
      return (typeof av === "number" ? av - bv : String(av).localeCompare(String(bv))) * sortDir;
    });
    const tbody = $("coTbody"); tbody.textContent = "";
    rows.forEach(r => tbody.append(el("tr", null,
      el("td", null, String(r.id)), el("td", null, r.area), el("td", null, r.constituency), el("td", null, r.region),
      el("td", null, r.tbType), el("td", null, r.hiv), el("td", null, r.gender), el("td", null, String(r.age)),
      el("td", null, r.helminth), el("td", null, el("span", {class:"co-pill " + (r.status==="Alive" ? "alive" : "died")}, r.status)))));
    const ths = [...$("coTheadRow").children];
    ths.forEach((th, i) => {
      th.querySelector(".arrow").textContent = headerDefs[i].key === sortKey ? (sortDir === 1 ? " ▲" : " ▼") : "";
      th.setAttribute("aria-sort", headerDefs[i].key === sortKey ? (sortDir === 1 ? "ascending" : "descending") : "none");
    });
  }

  /* ---------------- force-directed network ---------------- */
  let netSim = null;
  function renderNetwork(D){
    const regions = [...new Set(DATA.map(r=>r.region))];
    const nodes = [], links = [];
    regions.forEach(region => {
      const rows = D.filter(r=>r.region===region);
      nodes.push({id:"R:"+region, type:"hub", label:region, region, count:rows.length, died:rows.filter(r=>r.status==="Died").length});
      [...countBy(rows,"constituency").entries()].forEach(([cname, count]) => {
        const cid = "C:"+region+":"+cname;
        nodes.push({id:cid, type:"leaf", label:cname, region, count, died:rows.filter(r=>r.constituency===cname && r.status==="Died").length});
        links.push({source:"R:"+region, target:cid, value:count});
      });
    });

    const svg = $("coNetSvg"); svg.textContent = "";
    const W = 900, H = 560, cx = W/2, cy = H/2;
    const legend = $("coLegendNetwork"); legend.textContent = "";
    regions.forEach(region => legend.append(el("span", {class:"item"}, el("span", {class:"swatch", style:`background:${regionHex(region)}`}), region)));

    if (netSim) cancelAnimationFrame(netSim);
    if (!nodes.some(n=>n.type==="leaf")){
      const t = svgEl("text", {x:cx, y:cy, "text-anchor":"middle", class:"co-net-empty"}); t.textContent = "No patients match the current filter.";
      svg.append(t);
      renderTable("coTblNetwork", ["Region","Constituency","Patients","Died"], []);
      return;
    }

    const rScale = n => n.type==="hub" ? 16 + Math.sqrt(n.count)*3.2 : 5 + Math.sqrt(n.count)*3.2;
    const hubs = nodes.filter(n=>n.type==="hub");
    hubs.forEach((h,i) => { const a = i/hubs.length*Math.PI*2; h.x = cx + Math.cos(a)*180; h.y = cy + Math.sin(a)*150; h.vx = h.vy = 0; });
    const hubPos = Object.fromEntries(hubs.map(h=>[h.id,h]));
    nodes.filter(n=>n.type==="leaf").forEach(n => { const h = hubPos["R:"+n.region]; n.x = h.x + (Math.random()-0.5)*90; n.y = h.y + (Math.random()-0.5)*90; n.vx = n.vy = 0; });
    const byId = Object.fromEntries(nodes.map(n=>[n.id,n]));

    function tick(){
      for (let i=0;i<nodes.length;i++) for (let j=i+1;j<nodes.length;j++){
        const a = nodes[i], b = nodes[j];
        const dx = b.x-a.x, dy = b.y-a.y, d2 = Math.max(dx*dx+dy*dy, 1), d = Math.sqrt(d2);
        const minD = rScale(a)+rScale(b)+6, f = Math.min(2600/d2, 6), fx = dx/d*f, fy = dy/d*f;
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
        if (d < minD){ const p = (minD-d)*0.06; a.vx -= dx/d*p; a.vy -= dy/d*p; b.vx += dx/d*p; b.vy += dy/d*p; }
      }
      links.forEach(l => {
        const a = byId[l.source], b = byId[l.target], dx = b.x-a.x, dy = b.y-a.y, d = Math.max(Math.sqrt(dx*dx+dy*dy), 1);
        const diff = (d-60)*0.02, fx = dx/d*diff, fy = dy/d*diff;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      });
      nodes.forEach(n => {
        n.vx += (cx-n.x)*0.0025; n.vy += (cy-n.y)*0.0025;
        if (n.fixed) return;
        n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy;
        const r = rScale(n);
        n.x = Math.max(r+4, Math.min(W-r-4, n.x)); n.y = Math.max(r+4, Math.min(H-r-4, n.y));
      });
    }

    const gLinks = svgEl("g"), gNodes = svgEl("g"), gLabels = svgEl("g");
    svg.append(gLinks, gNodes, gLabels);
    const linkEls = links.map(l => {
      const line = svgEl("line", {class:"co-net-link", stroke:regionHex(byId[l.source].region), "stroke-width":Math.max(1, Math.sqrt(l.value))});
      gLinks.append(line); return {l, line};
    });
    const labelEls = [];
    const nodeEls = nodes.map(n => {
      const g = svgEl("g", {class:"co-net-node"});
      const circle = svgEl("circle", {r:rScale(n), fill:n.type==="hub" ? regionHex(n.region) : "var(--co-surface-2)", stroke:regionHex(n.region), "stroke-width":n.type==="hub" ? 0 : 2});
      g.append(circle);
      if (n.type === "hub"){
        const text = `${n.label} (${n.count})`, lg = svgEl("g"), bg = svgEl("rect", {rx:4, ry:4, class:"co-net-labelbg"}), label = svgEl("text", {x:0, y:0, "text-anchor":"middle", "dominant-baseline":"middle", class:"co-net-hub"});
        label.textContent = text; lg.append(bg, label); gLabels.append(lg);
        labelEls.push({n, lg, bg, textLen:text.length});
      }
      bindHover(circle, n.label, () => n.type==="hub"
        ? [{label:"Region total", value:String(n.count), color:regionHex(n.region)}, {label:"Died", value:String(n.died), color:"var(--co-critical)"}]
        : [{label:"Region", value:n.region, color:regionHex(n.region)}, {label:"Patients", value:String(n.count)}, {label:"Died", value:`${n.died} (${fmtPct(pct(n.died,n.count))})`, color:"var(--co-critical)"}]);
      gNodes.append(g);
      let dragging = false;
      circle.addEventListener("pointerdown", e => { dragging = true; n.fixed = true; circle.setPointerCapture(e.pointerId); });
      circle.addEventListener("pointermove", e => {
        if (!dragging) return;
        const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
        n.x = loc.x; n.y = loc.y; draw();
      });
      const endDrag = e => { if (!dragging) return; dragging = false; try { circle.releasePointerCapture(e.pointerId); } catch(err){} };
      circle.addEventListener("pointerup", endDrag);
      circle.addEventListener("pointercancel", endDrag);
      return {n, g};
    });

    function draw(){
      linkEls.forEach(({l,line}) => { const a = byId[l.source], b = byId[l.target];
        line.setAttribute("x1",a.x); line.setAttribute("y1",a.y); line.setAttribute("x2",b.x); line.setAttribute("y2",b.y); });
      nodeEls.forEach(({n,g}) => g.setAttribute("transform", `translate(${n.x},${n.y})`));
      labelEls.forEach(({n,lg,bg,textLen}) => {
        const w = Math.max(30, textLen*6.4), h = 16;
        bg.setAttribute("x", -w/2); bg.setAttribute("y", -h/2); bg.setAttribute("width", w); bg.setAttribute("height", h);
        lg.setAttribute("transform", `translate(${n.x},${n.y - rScale(n) - 12})`);
      });
    }
    let frame = 0;
    (function loop(){ tick(); draw(); if (++frame < 180) netSim = requestAnimationFrame(loop); })();

    renderTable("coTblNetwork", ["Region","Constituency","Patients","Died"],
      nodes.filter(n=>n.type==="leaf").sort((a,b)=>b.count-a.count).map(n=>[n.region,n.label,n.count,n.died]));
  }

  /* ---------------- unlock ---------------- */
  function b64ToBytes(b64){ return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
  async function decrypt(password){
    const P = window.COHORT_PAYLOAD;
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), {name:"PBKDF2"}, false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({name:"PBKDF2", salt:b64ToBytes(P.salt), iterations:P.iterations, hash:"SHA-256"},
      base, {name:"AES-GCM", length:256}, false, ["decrypt"]);
    const buf = await crypto.subtle.decrypt({name:"AES-GCM", iv:b64ToBytes(P.iv)}, key, b64ToBytes(P.data));
    return JSON.parse(new TextDecoder().decode(buf));
  }
  async function tryUnlock(password){
    if (unlocked) return true;
    if (!window.COHORT_PAYLOAD) return false;
    let rows;
    try { rows = await decrypt(password); } catch(err){ return false; }
    DATA = rows.map(r => Object.fromEntries(COLS.map((c,i) => [c, r[i]])));
    TOTAL = DATA.length;
    unlocked = true;
    $("coLock").hidden = true;
    $("coWrap").hidden = false;
    initApp();
    return true;
  }

  // Called once the map is unlocked: the same password opens the cohort too when they match;
  // otherwise the Charts tab asks for the cohort password itself.
  window.Cohort = {
    afterMapUnlock: async password => { if (!(await tryUnlock(password))) $("coLock").hidden = false; },
  };

  document.addEventListener("DOMContentLoaded", () => {
    $("coLock").addEventListener("submit", async e => {
      e.preventDefault();
      const btn = $("coSubmit"), err = $("coError");
      btn.disabled = true; btn.textContent = "Checking..."; err.hidden = true;
      const ok = await tryUnlock($("coPassword").value);
      if (!ok){ err.hidden = false; $("coPassword").value = ""; $("coPassword").focus(); }
      btn.disabled = false; btn.textContent = "Unlock";
    });
  });
})();
