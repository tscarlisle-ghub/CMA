// app.js — CMA Financial Dashboard

const SK = 'cma_dashboard_v2';
let state = null, activeMonth = null;
const charts = {};

// ── Utilities ────────────────────────────────────────────────────────────────
const f$  = v => '$' + (Math.abs(v)>=1e6 ? (v/1e6).toFixed(1)+'M' : Math.abs(v)>=1000 ? Math.round(Math.abs(v)/1000)+'K' : Math.round(v));
const fF  = v => '$' + Math.round(v).toLocaleString();
const fP  = v => Math.round(v*100) + '%';
const sgn = v => v >= 0 ? '+' : '';
const isDark = () => window.matchMedia('(prefers-color-scheme:dark)').matches;
const gc = () => isDark() ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
const tc = () => isDark() ? 'rgba(255,255,255,.4)'  : '#9a9a9a';
const bs = () => ({
  x: {grid:{color:gc()},ticks:{color:tc(),font:{size:11}},border:{color:'transparent'}},
  y: {grid:{color:gc()},ticks:{color:tc(),font:{size:11}},border:{color:'transparent'}},
});
const pLabel = p => {const[y,m]=p.split('-');return new Date(+y,+m-1,1).toLocaleString('default',{month:'short',year:'2-digit'});};

function mkChart(id, cfg) {
  if (charts[id]) charts[id].destroy();
  const el = document.getElementById(id);
  if (!el) return;
  charts[id] = new Chart(el, cfg);
}

// ── Computed metrics ─────────────────────────────────────────────────────────
const principals = () => state.company.principals || [];
const prFees  = (mo,pid) => mo.revenue?.by_principal?.find(p=>p.principal_id===pid)?.fees || 0;
const prReimb = (mo,pid) => mo.revenue?.by_principal?.find(p=>p.principal_id===pid)?.reimbursables || 0;
const totalFees  = mo => (mo.revenue?.by_principal||[]).reduce((s,p)=>s+(p.fees||0),0);
const totalReimb = mo => (mo.revenue?.by_principal||[]).reduce((s,p)=>s+(p.reimbursables||0),0);
const totalRev   = mo => totalFees(mo) + totalReimb(mo);
const directCosts = mo => {
  const d = mo.direct_costs||{};
  return (d.subconsultants||0)+(d.reprographics||0)+(d.reimbursable_expenses||0)+(d.other_direct||0);
};
const netRev = mo => totalRev(mo) - directCosts(mo);

function totalOpex(mo) {
  const e = mo.expenses||{};
  return ['payroll_wages','payroll_taxes','health_insurance','contractors','computer_software',
    'dues_subscriptions','rent','insurance_eo','insurance_general','legal_professional',
    'meals_entertainment','office_supplies','advertising','car_truck','phone','internet',
    'printing','gas','cleaning','bank_charges','payroll_processing','photography','other'
  ].reduce((s,k)=>s+(e[k]||0),0);
}

const opIncome = mo => netRev(mo) - totalOpex(mo);
const netMargin = mo => { const r=netRev(mo); return r ? opIncome(mo)/r : 0; };
const cashRunway = mo => {
  const b = mo.cash?.opening_balance||0, burn = totalOpex(mo)+directCosts(mo)-totalRev(mo);
  return burn > 0 ? b/burn : 99;
};

function expBreak(mo) {
  const e = mo.expenses||{};
  return {
    'Payroll':    (e.payroll_wages||0)+(e.payroll_taxes||0)+(e.health_insurance||0),
    'Contractors': e.contractors||0,
    'Software':    e.computer_software||0,
    'Dues & Subs': e.dues_subscriptions||0,
    'Rent':        e.rent||0,
    'Insurance':   (e.insurance_eo||0)+(e.insurance_general||0),
    'Legal/Acctg': e.legal_professional||0,
    'Meals & Ent': e.meals_entertainment||0,
    'Office':      e.office_supplies||0,
    'Marketing':   e.advertising||0,
    'Other':       (e.car_truck||0)+(e.phone||0)+(e.internet||0)+(e.printing||0)+
                   (e.gas||0)+(e.cleaning||0)+(e.bank_charges||0)+(e.payroll_processing||0)+
                   (e.photography||0)+(e.other||0),
  };
}

function pipStats(mo) {
  const p = mo.pipeline||[];
  const tc = p.reduce((s,x)=>s+(x.fee||0),0);
  const tb = p.reduce((s,x)=>s+((x.fee||0)*(x.billed_pct||0)/100),0);
  return {totalContract:tc, totalBilled:tb, remaining:tc-tb, count:p.length};
}

function prPipeline(mo, pid) {
  return (mo.pipeline||[]).filter(p=>p.principal===pid);
}

// ── State ────────────────────────────────────────────────────────────────────
function loadState() {
  try { state = JSON.parse(localStorage.getItem(SK)); } catch(e) {}
  if (!state || !state.months?.length) loadSample(false);
}
function saveState() { localStorage.setItem(SK, JSON.stringify(state)); }

function loadSample(refresh=true) {
  fetch('data/sample.json').then(r=>r.json()).then(d=>{
    state=d; saveState(); if(refresh) init();
  });
}
function exportData() {
  const b = new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'CMA_data.json';
  a.click();
}
function clearData() {
  if (confirm('Clear all data?')) { localStorage.removeItem(SK); init(); }
}

// ── QB File Upload ───────────────────────────────────────────────────────────
function handleFileUpload(file) {
  if (!file) return;
  const resultEl = document.getElementById('parseResult');
  resultEl.innerHTML = '<span style="color:var(--hair)">Parsing…</span>';

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = QBParser.parseQBExcel(e.target.result);

      // Merge parsed months into state — preserve cash/pipeline data already entered
      let merged = 0, added = 0;
      parsed.months.forEach(parsedMo => {
        const existing = state.months.find(m => m.period === parsedMo.period);
        if (existing) {
          // Update revenue and expenses from QB, preserve cash/pipeline
          existing.revenue    = parsedMo.revenue;
          existing.expenses   = parsedMo.expenses;
          existing.direct_costs = parsedMo.direct_costs;
          merged++;
        } else {
          state.months.push(parsedMo);
          added++;
        }
      });
      state.months.sort((a,b)=>a.period.localeCompare(b.period));
      saveState();

      resultEl.innerHTML = `<span class="parse-result">✓ Parsed ${parsed.months.length} months — ${merged} updated, ${added} added.<br>Period: ${parsed.reportPeriod || parsed.reportYear}. Revenue: ${f$(parsed.annual.fees?.total||0)} fees, ${f$(parsed.annual.reimbursables||0)} reimbursables.</span>`;
      init();
    } catch(err) {
      resultEl.innerHTML = `<span class="parse-error">Parse error: ${err.message}. Ensure you're uploading a QuickBooks Profit and Loss Detail export (.xlsx).</span>`;
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

// Drag and drop
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('dropZone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  });
});

// ── Navigation ───────────────────────────────────────────────────────────────
const TAB_NAMES = ['firm','scott','bill','pipeline','expenses','cash','import','settings'];

function showTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('tab-'+name)?.classList.add('active');
  document.querySelectorAll('.tab')[TAB_NAMES.indexOf(name)]?.classList.add('active');
  renderTab(name);
}
function renderTab(name) {
  if (!state?.months?.length) return;
  const r = {firm:renderFirm, scott:()=>renderPrincipal('scott'), bill:()=>renderPrincipal('bill'),
    pipeline:renderPipeline, expenses:renderExpenses, cash:renderCash,
    import:renderImport, settings:renderSettings};
  r[name]?.();
}

// ── Month helpers ────────────────────────────────────────────────────────────
const getMo = () => state.months.find(m=>m.period===activeMonth) || state.months[state.months.length-1];
const getPrior = () => { const i=state.months.findIndex(m=>m.period===activeMonth); return i>0?state.months[i-1]:null; };
function getTrailing(n=6) {
  const all=state.months;
  const end=Math.max(state.months.findIndex(m=>m.period===activeMonth),0)||all.length-1;
  return all.slice(Math.max(0,end-n+1),end+1);
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
function renderSidebar() {
  const mo=getMo(), prior=getPrior(), prs=principals();
  document.getElementById('tbPeriod').textContent = pLabel(mo.period);
  document.getElementById('monthChips').innerHTML = state.months.slice(-12).map(m=>
    `<button class="mc ${m.period===activeMonth?'active':''}" onclick="setMonth('${m.period}')">${pLabel(m.period)}</button>`
  ).join('');

  const kpis=[
    ['Net Revenue', f$(netRev(mo)), prior?sgn(netRev(mo)-netRev(prior))+fP((netRev(mo)-netRev(prior))/(netRev(prior)||1)):'—'],
    ['Net Margin',  fP(netMargin(mo)), ''],
    ['Cash',        f$(mo.cash?.opening_balance||0), ''],
    ['AR >90',      f$(mo.cash?.ar_over_90||0), (mo.cash?.ar_over_90||0)>5000?'↑':''],
    ['Contractors', f$(mo.expenses?.contractors||0), ''],
    ['Runway',      cashRunway(mo)>50?'Healthy':cashRunway(mo).toFixed(1)+' mo',''],
  ];
  document.getElementById('sidebarKPIs').innerHTML =
    `<div class="sb-title">Key Metrics — ${pLabel(mo.period)}</div>` +
    kpis.map(([n,v,d])=>`<div class="kpi-row"><span class="kpi-name">${n}</span><span class="kpi-val">${v}${d?` <small style="color:var(--hair)">${d}</small>`:''}</span></div>`).join('');

  document.getElementById('sidebarSplit').innerHTML = prs.map(p=>{
    const fees=prFees(mo,p.id), pct=totalFees(mo)?fees/totalFees(mo):0;
    const c=p.id==='scott'?'var(--scott)':'var(--bill)';
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px"><span style="color:var(--hair)">${p.name}</span><span>${fP(pct)} · ${f$(fees)}</span></div>
      <div style="height:4px;border-radius:2px;background:var(--faint)"><div style="width:${Math.round(pct*100)}%;height:4px;border-radius:2px;background:${c}"></div></div>
    </div>`;
  }).join('');

  const checks=[
    ['Revenue imported', totalRev(mo)>0],
    ['Expenses imported', totalOpex(mo)>0],
    ['Cash entered', (mo.cash?.opening_balance||0)>0],
    ['Pipeline entered', (mo.pipeline?.length||0)>0],
  ];
  document.getElementById('inputStatus').innerHTML = checks.map(([n,ok])=>
    `<div style="display:flex;align-items:center;gap:6px;padding:3px 0"><span style="color:${ok?'var(--pos)':'var(--neg)'};font-size:12px">${ok?'✓':'○'}</span><span style="font-size:11px;color:${ok?'var(--ink)':'var(--hair)'}">${n}</span></div>`
  ).join('');
}
function setMonth(p) {
  activeMonth=p; renderSidebar();
  const at=document.querySelector('.tab.active');
  const i=[...document.querySelectorAll('.tab')].indexOf(at);
  if(i>=0) renderTab(TAB_NAMES[i]);
}

// ── Firm tab ─────────────────────────────────────────────────────────────────
function renderFirm() {
  const mo=getMo(), prior=getPrior(), tr=getTrailing(6), prs=principals();
  const labels=tr.map(m=>pLabel(m.period));

  const mets=[
    {l:'Net Revenue', v:f$(netRev(mo)), d:prior?sgn(netRev(mo)-netRev(prior))+fP((netRev(mo)-netRev(prior))/(netRev(prior)||1)):null, cls:netRev(mo)>=(prior?netRev(prior):0)?'t-pos':'t-neg'},
    {l:'Design Fees', v:f$(totalFees(mo)), d:fP(totalFees(mo)/(totalRev(mo)||1))+' of gross', cls:'t-neutral'},
    {l:'Net Margin',  v:fP(netMargin(mo)), d:prior?sgn(netMargin(mo)-netMargin(prior))+(Math.round((netMargin(mo)-netMargin(prior))*1000)/10)+'pp vs prior':null, cls:netMargin(mo)>0.25?'t-pos':netMargin(mo)>0.10?'t-warn':'t-neg'},
    {l:'Pipeline Remaining', v:f$(pipStats(mo).remaining), d:pipStats(mo).count+' active projects', cls:'t-neutral'},
    {l:'Cash Runway', v:cashRunway(mo)>50?'Healthy':cashRunway(mo).toFixed(1)+' mo', cls:cashRunway(mo)>6?'t-pos':cashRunway(mo)>3?'t-warn':'t-neg'},
    {l:'Total Expenses', v:f$(totalOpex(mo)), d:prior?sgn(totalOpex(mo)-totalOpex(prior))+fP((totalOpex(mo)-totalOpex(prior))/(totalOpex(prior)||1)):null, cls:totalOpex(mo)<=(prior?totalOpex(prior):0)?'t-pos':'t-neg'},
  ];
  document.getElementById('firmMetrics').innerHTML = mets.map(m=>
    `<div class="metric-card ${m.cls}"><div class="ml">${m.l}</div><div class="mv">${m.v}</div>${m.d?`<div class="md">${m.d}</div>`:''}</div>`
  ).join('');

  mkChart('firmRevChart',{type:'bar',data:{labels,datasets:prs.map((p,i)=>({
    label:p.name, data:tr.map(m=>prFees(m,p.id)),
    backgroundColor:p.id==='scott'?'#2a4a6a':'#1a5c2e',
    borderRadius:i===prs.length-1?2:0, borderSkipped:false, stack:'r'
  }))},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>' '+ctx.dataset.label+': '+f$(ctx.parsed.y)}}},scales:{...bs(),x:{...bs().x,stacked:true},y:{...bs().y,stacked:true,ticks:{...bs().y.ticks,callback:f$}}}}});

  mkChart('firmMarginChart',{type:'line',data:{labels,datasets:[
    {label:'Net Margin',data:tr.map(netMargin),borderColor:'#1a5c2e',borderWidth:2,pointRadius:3,pointBackgroundColor:'#1a5c2e',tension:.3,fill:false},
    {label:'Op Margin', data:tr.map(m=>netRev(m)?opIncome(m)/netRev(m):0),borderColor:'#74130c',borderWidth:1.5,pointRadius:2,pointBackgroundColor:'#74130c',tension:.3,fill:false,borderDash:[4,3]},
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>' '+fP(ctx.parsed.y)}}},scales:{...bs(),y:{...bs().y,ticks:{...bs().y.ticks,callback:fP},min:-.1,max:.8}}}});

  const brk=expBreak(mo), brkVals=Object.values(brk), brkKeys=Object.keys(brk);
  const expC=['#4a4a4a','#74130c','#2a4a6a','#1a5c52','#b07d15','#1a5c2e','#6b3a7d','#7a3a10','#2a6a4a','#5a2a6a','#4a3a2a'];
  mkChart('firmExpDonut',{type:'doughnut',data:{labels:brkKeys,datasets:[{data:brkVals.map(Math.round),backgroundColor:expC,borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>' '+ctx.label+': '+f$(ctx.parsed)}}}}});

  // Actions
  const actions=[];
  if((mo.expenses?.contractors||0)>10000) actions.push({t:'warn',s:'<strong>Contractor spend at '+f$(mo.expenses.contractors)+'.</strong> Third consecutive elevated month. Model hire vs. continue.'});
  if((mo.cash?.ar_over_90||0)>5000) actions.push({t:'urgent',s:'<strong>'+f$(mo.cash.ar_over_90)+' AR over 90 days.</strong> Review with Aprio.'});
  if(pipStats(mo).remaining<150000) actions.push({t:'warn',s:'<strong>Pipeline below $150K remaining.</strong> Confirm new SD commissions to fill forward book.'});
  if(netMargin(mo)>0.30) actions.push({t:'good',s:'<strong>Net margin '+fP(netMargin(mo))+'</strong> — above target. Strong month for principal distributions.'});
  if(!actions.length) actions.push({t:'good',s:'No flags this period.'});
  const pc={urgent:'pill-urgent',warn:'pill-watch',good:'pill-good'};
  let html='';
  if(mo.notes) html=`<div class="notes-box">"${mo.notes}"</div>`;
  html+=actions.map(a=>`<div class="action-item"><span class="pill ${pc[a.t]||'pill-watch'}">${a.t.charAt(0).toUpperCase()+a.t.slice(1)}</span><div class="action-text">${a.s}</div></div>`).join('');
  document.getElementById('firmActions').innerHTML=html;
}

// ── Principal tab (Scott or Bill) ─────────────────────────────────────────────
function renderPrincipal(pid) {
  const mo=getMo(), tr=getTrailing(6), prs=principals();
  const p=prs.find(x=>x.id===pid)||{id:pid,name:pid};
  const labels=tr.map(m=>pLabel(m.period));
  const color=pid==='scott'?'#2a4a6a':'#1a5c2e';

  // YTD totals for tax calculation
  const ytdMos=state.months.filter(m=>m.period.startsWith(activeMonth?.slice(0,4)||'2025'));
  const ytdFees=ytdMos.reduce((s,m)=>s+prFees(m,pid),0);
  const ytdReimb=ytdMos.reduce((s,m)=>s+prReimb(m,pid),0);
  const monthsElapsed=ytdMos.length||1;

  // Metrics
  const fees=prFees(mo,pid), reimb=prReimb(mo,pid);
  const prior=getPrior();
  const pFeesPrior=prior?prFees(prior,pid):0;
  const pct=totalFees(mo)?fees/totalFees(mo):0;
  const mets=[
    {l:'Design Fees', v:f$(fees), d:prior?sgn(fees-pFeesPrior)+fP((fees-pFeesPrior)/(pFeesPrior||1)):null, cls:'t-'+pid},
    {l:'Reimbursables', v:f$(reimb), d:fP(totalRev(mo)?reimb/(fees+reimb):0)+' of revenue', cls:'t-neutral'},
    {l:'Share of Firm', v:fP(pct), d:f$(totalFees(mo))+' total fees', cls:'t-neutral'},
    {l:'YTD Fees', v:f$(ytdFees), d:monthsElapsed+' months', cls:'t-'+pid},
    {l:'Active Projects', v:prPipeline(mo,pid).length+'', d:f$(prPipeline(mo,pid).reduce((s,x)=>s+(x.fee||0),0))+' contracted', cls:'t-neutral'},
    {l:'Remaining Pipeline', v:f$(prPipeline(mo,pid).reduce((s,x)=>s+((x.fee||0)-(Math.round((x.fee||0)*(x.billed_pct||0)/100))),0)), d:'unbilled', cls:'t-pos'},
  ];
  document.getElementById(`${pid}Metrics`).innerHTML=mets.map(m=>
    `<div class="metric-card ${m.cls}"><div class="ml">${m.l}</div><div class="mv">${m.v}</div>${m.d?`<div class="md">${m.d}</div>`:''}</div>`
  ).join('');

  // Revenue trend
  mkChart(`${pid}RevChart`,{type:'bar',data:{labels,datasets:[{label:'Fees',data:tr.map(m=>prFees(m,pid)),backgroundColor:color,borderRadius:2},{label:'Reimb.',data:tr.map(m=>prReimb(m,pid)),backgroundColor:color+'55',borderRadius:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>' '+ctx.dataset.label+': '+f$(ctx.parsed.y)}}},scales:{...bs(),y:{...bs().y,ticks:{...bs().y.ticks,callback:f$}}}}});

  // Pipeline table
  const phases={'SD':'pill-sd','SD/DD':'pill-sd','DD':'pill-dd','CD':'pill-cd','CA':'pill-ca'};
  const pip=prPipeline(mo,pid).sort((a,b)=>['SD','SD/DD','DD','CD','CA'].indexOf(b.phase)-['SD','SD/DD','DD','CD','CA'].indexOf(a.phase));
  document.getElementById(`${pid}PipelineTable`).innerHTML=pip.map(x=>{
    const rem=(x.fee||0)-Math.round((x.fee||0)*(x.billed_pct||0)/100);
    return `<tr><td>${x.client}</td><td><span class="pill ${phases[x.phase]||'pill-sd'}">${x.phase}</span></td><td>${f$(x.fee||0)}</td><td style="color:${rem>50000?'var(--pos)':'var(--hair)'}">${f$(rem)}</td></tr>`;
  }).join('')||'<tr><td colspan="4" style="color:var(--hair);text-align:center;padding:16px">No pipeline data for this period — add projects in Import / Data.</td></tr>';

  // Tax panel
  renderTaxPanel(pid, ytdFees, ytdReimb, monthsElapsed);
}

// ── Tax panel ────────────────────────────────────────────────────────────────
function renderTaxPanel(pid, ytdFees, ytdReimb, monthsElapsed) {
  const taxSettings = (state.taxSettings||{})[pid] || {};
  const wages        = taxSettings.wages        || 75000;
  const otherIncome  = taxSettings.other_income || 0;
  const filingStatus = taxSettings.filing_status || 'mfj';
  const priorFed     = taxSettings.prior_year_fed || 0;
  const priorAla     = taxSettings.prior_year_ala || 0;

  // Annualize YTD distributions (fees + reimbursables - wages already taken)
  const ytdGross    = ytdFees + ytdReimb;
  const annualFees  = Math.round(ytdGross * (12/monthsElapsed));
  const annualDist  = Math.max(0, annualFees - wages);  // estimated distributions (fees minus salary already counted as wages)

  const tax = TaxCalc.estimateTax({
    wages, distributions: annualDist, otherIncome, filingStatus, priorYearFedTax: priorFed, priorYearAlaTax: priorAla
  });

  const color = pid==='scott' ? '#2a4a6a' : '#1a5c2e';
  const el = document.getElementById(`${pid}TaxPanel`);

  el.innerHTML = `
    <div class="metric-grid" style="margin-bottom:16px">
      <div class="metric-card t-fed"><div class="ml">Federal Income Tax</div><div class="mv">${f$(tax.fedTax)}</div><div class="md">${fP(tax.effFedRate)} effective rate</div></div>
      <div class="metric-card t-neutral"><div class="ml">FICA (Payroll Taxes)</div><div class="mv">${f$(tax.fica)}</div><div class="md">On W-2 wages of ${f$(wages)}</div></div>
      <div class="metric-card t-ala"><div class="ml">Alabama Income Tax</div><div class="mv">${f$(tax.alaTax)}</div><div class="md">4.95% above exempt</div></div>
      <div class="metric-card t-neg"><div class="ml">Total Tax Burden</div><div class="mv">${f$(tax.totalTax)}</div><div class="md">${fP(tax.effTotalRate)} of gross income</div></div>
      <div class="metric-card t-pos"><div class="ml">Net After-Tax Income</div><div class="mv">${f$(tax.netAfterTax)}</div><div class="md">Estimated annual</div></div>
      <div class="metric-card t-neutral"><div class="ml">QBI Deduction</div><div class="mv">${f$(tax.qbiDeduction)}</div><div class="md">20% of S-corp income</div></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div>
        <div style="font-size:9px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--hair);margin-bottom:10px">Tax Basis</div>
        <table class="dt">
          <tr><td style="color:var(--hair)">W-2 wages</td><td>${fF(wages)}</td></tr>
          <tr><td style="color:var(--hair)">S-corp distributions (est.)</td><td>${fF(annualDist)}</td></tr>
          <tr><td style="color:var(--hair)">Other income</td><td>${fF(otherIncome)}</td></tr>
          <tr><td style="color:var(--hair)">Gross income</td><td>${fF(tax.grossIncome)}</td></tr>
          <tr><td style="color:var(--hair)">Standard deduction (MFJ)</td><td style="color:var(--neg)">− ${fF(30000)}</td></tr>
          <tr><td style="color:var(--hair)">QBI deduction</td><td style="color:var(--neg)">− ${fF(tax.qbiDeduction)}</td></tr>
          <tr class="total-row"><td>Federal taxable income</td><td>${fF(tax.federalTaxable)}</td></tr>
        </table>
        <div style="margin-top:10px;font-size:11px;color:var(--hair)">Marginal federal rate: <strong>${fP(tax.margFed)}</strong></div>
        <div style="font-size:11px;color:var(--pos);margin-top:4px">Architecture is excluded from SSTB — full QBI deduction applies with no phase-out.</div>
      </div>
      <div>
        <div style="font-size:9px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--hair);margin-bottom:10px">2026 Estimated Quarterly Payments</div>
        <p style="font-size:11px;color:var(--hair);margin-bottom:10px;line-height:1.5">Distributions are not withheld — pay quarterly to avoid underpayment penalties. W-2 wages are handled through payroll.</p>
        ${tax.quarters.map(q=>`
          <div class="quarter-row">
            <div>
              <div style="font-size:12px">${q.label}</div>
              <div class="quarter-due">${q.period}</div>
            </div>
            <div class="quarter-amt">${fF(q.amount)}</div>
          </div>`).join('')}
        <div style="margin-top:10px;font-size:11px;color:var(--hair)">Annual estimate total: <strong>${fF(tax.annualEstimate)}</strong> (federal + Alabama, excluding FICA)</div>
      </div>
    </div>

    <div class="tax-disclaimer">
      This is an estimate based on annualized YTD revenue of ${f$(annualFees)}, W-2 wages of ${f$(wages)}, married filing jointly, standard deduction, and the 20% QBI deduction. It does not account for itemized deductions, capital gains, investment income, Alabama withholding credits, or changes in revenue trajectory. Consult Todd Richard at Aprio before making quarterly payment decisions.
      <br><br>
      <strong>Key CMA S-corp advantage:</strong> Distributions of ${f$(annualDist)} are not subject to FICA (15.3%), saving approximately ${f$(Math.min(annualDist,176100)*0.153)} vs. paying everything as wages. Architecture is explicitly not an SSTB, so the 20% QBI deduction applies at all income levels.
    </div>`;
}

// ── Pipeline tab ─────────────────────────────────────────────────────────────
function renderPipeline() {
  const mo=getMo(), prs=principals();
  const pl=pipStats(mo);
  const mets=[
    {l:'Total Contracted', v:f$(pl.totalContract), d:pl.count+' active projects', cls:'t-neutral'},
    {l:'Total Billed',     v:f$(pl.totalBilled), d:fP(pl.totalContract?pl.totalBilled/pl.totalContract:0)+' of contracted', cls:'t-neutral'},
    {l:'Remaining Fees',  v:f$(pl.remaining), d:'unbilled contract value', cls:'t-pos'},
    {l:'Avg Project Fee', v:f$(pl.count?pl.totalContract/pl.count:0), d:'per project', cls:'t-neutral'},
  ];
  document.getElementById('plMetrics').innerHTML=mets.map(m=>
    `<div class="metric-card ${m.cls}"><div class="ml">${m.l}</div><div class="mv">${m.v}</div><div class="md">${m.d}</div></div>`
  ).join('');

  const phases=['SD','SD/DD','DD','CD','CA'];
  const pp={'SD':'pill-sd','SD/DD':'pill-sd','DD':'pill-dd','CD':'pill-cd','CA':'pill-ca'};
  const sorted=[...(mo.pipeline||[])].sort((a,b)=>phases.indexOf(b.phase)-phases.indexOf(a.phase));
  document.getElementById('plTableBody').innerHTML=sorted.map(x=>{
    const billed=Math.round((x.fee||0)*(x.billed_pct||0)/100);
    const rem=(x.fee||0)-billed;
    const pName=prs.find(p=>p.id===x.principal)?.name||x.principal;
    const c=x.principal==='scott'?'#2a4a6a':'#1a5c2e';
    return `<tr>
      <td><div>${x.client}</div><div style="margin-top:3px;width:100px;height:4px;background:var(--faint);border-radius:2px"><div style="width:${Math.min(100,x.billed_pct||0)}%;height:4px;border-radius:2px;background:${c}"></div></div></td>
      <td><span class="pill pill-${x.principal}">${pName}</span></td>
      <td><span class="pill ${pp[x.phase]||'pill-sd'}">${x.phase}</span></td>
      <td>${fF(x.fee||0)}</td><td>${x.billed_pct||0}%</td><td>${fF(billed)}</td>
      <td style="color:${rem>50000?'var(--pos)':'var(--hair)'}">${fF(rem)}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="7" style="color:var(--hair);text-align:center;padding:16px">No pipeline data — add projects in Import / Data tab.</td></tr>';

  const phOnly=['SD','DD','CD','CA'];
  const pCol={'SD':'#b07d15','DD':'#2a4a6a','CD':'#74130c','CA':'#1a5c2e'};
  const phTot={};
  (mo.pipeline||[]).forEach(x=>{const ph=x.phase.includes('SD')?'SD':x.phase;phTot[ph]=(phTot[ph]||0)+(x.fee||0);});
  mkChart('plPhaseChart',{type:'doughnut',data:{labels:phOnly,datasets:[{data:phOnly.map(ph=>phTot[ph]||0),backgroundColor:phOnly.map(ph=>pCol[ph]),borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>' '+ctx.label+': '+f$(ctx.parsed)}}}}});

  const prRem={};
  (mo.pipeline||[]).forEach(x=>{prRem[x.principal]=(prRem[x.principal]||0)+((x.fee||0)-Math.round((x.fee||0)*(x.billed_pct||0)/100));});
  mkChart('plRemainingChart',{type:'bar',data:{labels:prs.map(p=>p.name),datasets:[{label:'Remaining',data:prs.map(p=>prRem[p.id]||0),backgroundColor:prs.map(p=>p.id==='scott'?'#2a4a6a':'#1a5c2e'),borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>' '+f$(ctx.parsed.x)}}},scales:{...bs(),x:{...bs().x,ticks:{...bs().x.ticks,callback:f$}}}}});
}

// ── Expenses tab ──────────────────────────────────────────────────────────────
function renderExpenses() {
  const mo=getMo(), tr=getTrailing(6);
  const brk=expBreak(mo), total=Object.values(brk).reduce((s,v)=>s+v,0)||1;
  const cats=Object.keys(brk);
  const expC=['#4a4a4a','#74130c','#2a4a6a','#1a5c52','#b07d15','#1a5c2e','#6b3a7d','#7a3a10','#2a6a4a','#5a2a6a','#4a3a2a'];
  const labels=tr.map(m=>pLabel(m.period));

  mkChart('expDonut',{type:'doughnut',data:{labels:cats,datasets:[{data:Object.values(brk).map(Math.round),backgroundColor:expC,borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>' '+ctx.label+': '+f$(ctx.parsed)}}}}});
  document.getElementById('expBreakList').innerHTML=cats.map((cat,i)=>
    `<div class="exp-row"><div class="exp-name"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${expC[i]};margin-right:6px"></span>${cat}</div><div class="exp-bar-track"><div class="exp-bar-fill" style="width:${Math.round(brk[cat]/total*100)}%;background:${expC[i]}"></div></div><div class="exp-amt">${f$(brk[cat])}</div><div class="exp-pct">${fP(brk[cat]/total)}</div></div>`
  ).join('');

  mkChart('expTrendChart',{type:'line',data:{labels,datasets:cats.map((cat,i)=>({label:cat,data:tr.map(m=>Math.round(expBreak(m)[cat]||0)),borderColor:expC[i],borderWidth:1.5,pointRadius:2,tension:.3,fill:false}))},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>' '+ctx.dataset.label+': '+f$(ctx.parsed.y)}}},scales:{...bs(),y:{...bs().y,ticks:{...bs().y.ticks,callback:f$}}}}});
  document.getElementById('expTrendLeg').innerHTML=cats.map((c,i)=>`<span class="li"><span class="ls" style="background:${expC[i]}"></span>${c}</span>`).join('');

  const sw=mo.expenses?.computer_software||0;
  const tools=[{name:'QuickBooks Online',monthly:108},{name:'Microsoft 365',monthly:96},{name:'Zoom',monthly:32},{name:'Textures.com',monthly:22},{name:'Parallels Desktop',monthly:11}];
  const known=tools.reduce((s,t)=>s+t.monthly,0);
  document.getElementById('softAudit').innerHTML=`<table class="dt"><thead><tr><th>Tool</th><th>Est. Monthly</th><th>Status</th></tr></thead><tbody>
    ${tools.map(t=>`<tr><td>${t.name}</td><td>${f$(t.monthly)}</td><td><span class="pill pill-good">Active</span></td></tr>`).join('')}
    ${sw-known>0?`<tr><td style="color:var(--warn)">Unidentified (AutoCAD, Adobe, etc.)</td><td style="color:var(--warn)">${f$(sw-known)}</td><td><span class="pill pill-watch">Verify</span></td></tr>`:''}
    <tr class="total-row"><td>Total 60040</td><td>${f$(sw)}</td><td></td></tr></tbody></table>
    <p style="font-size:11px;color:var(--hair);margin-top:8px;font-style:italic">AutoCAD/Revit, Adobe CC, Enscape — verify individual line items under QB account 60040.</p>`;
}

// ── Cash & AR tab ─────────────────────────────────────────────────────────────
function renderCash() {
  const mo=getMo(), tr=getTrailing(6);
  const c=mo.cash||{};
  const arT=(c.ar_current||0)+(c.ar_31_60||0)+(c.ar_61_90||0)+(c.ar_over_90||0);
  const mets=[
    {l:'Cash Balance',   v:f$(c.opening_balance||0), cls:'t-neutral'},
    {l:'Total AR',       v:f$(arT), d:f$(c.ar_current||0)+' current', cls:'t-neutral'},
    {l:'AR Over 90 Days',v:f$(c.ar_over_90||0), cls:(c.ar_over_90||0)>5000?'t-neg':'t-pos'},
    {l:'Cash Runway',    v:cashRunway(mo)>50?'Healthy':cashRunway(mo).toFixed(1)+' mo', cls:cashRunway(mo)>6?'t-pos':cashRunway(mo)>3?'t-warn':'t-neg'},
  ];
  document.getElementById('cashMetrics').innerHTML=mets.map(m=>
    `<div class="metric-card ${m.cls}"><div class="ml">${m.l}</div><div class="mv">${m.v}</div>${m.d?`<div class="md">${m.d}</div>`:''}</div>`
  ).join('');
  const labels=tr.map(m=>pLabel(m.period));
  mkChart('cashChart',{type:'line',data:{labels,datasets:[{label:'Cash',data:tr.map(m=>m.cash?.opening_balance||0),borderColor:'#4a4a4a',borderWidth:1.5,pointRadius:3,pointBackgroundColor:'#4a4a4a',tension:.3,fill:true,backgroundColor:'rgba(74,74,74,.06)'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>' '+f$(ctx.parsed.y)}}},scales:{...bs(),y:{...bs().y,ticks:{...bs().y.ticks,callback:f$}}}}});
  mkChart('arChart',{type:'bar',data:{labels,datasets:[{label:'Current',data:tr.map(m=>m.cash?.ar_current||0),backgroundColor:'#1a5c2e',stack:'ar'},{label:'31–60',data:tr.map(m=>m.cash?.ar_31_60||0),backgroundColor:'#b07d15',stack:'ar'},{label:'61–90',data:tr.map(m=>m.cash?.ar_61_90||0),backgroundColor:'#74130c',stack:'ar'},{label:'>90',data:tr.map(m=>m.cash?.ar_over_90||0),backgroundColor:'#3a0a06',stack:'ar'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>' '+ctx.dataset.label+': '+f$(ctx.parsed.y)}}},scales:{...bs(),x:{...bs().x,stacked:true},y:{...bs().y,stacked:true,ticks:{...bs().y.ticks,callback:f$}}}}});

  const notes=[];
  if((c.ar_over_90||0)>5000) notes.push({t:'urgent',s:'<strong>'+f$(c.ar_over_90)+' over 90 days.</strong> Send to Aprio. Cross-check with CA project list for stalled billings.'});
  if(arT>0&&(c.ar_current||0)/arT<0.70) notes.push({t:'warn',s:'<strong>Less than 70% of AR is current.</strong> Follow up on 31–60 day invoices.'});
  if(!notes.length) notes.push({t:'good',s:'AR aging is within normal range.'});
  const pc={urgent:'pill-urgent',warn:'pill-watch',good:'pill-good'};
  document.getElementById('arNotes').innerHTML=notes.map(a=>`<div class="action-item"><span class="pill ${pc[a.t]}">${a.t.charAt(0).toUpperCase()+a.t.slice(1)}</span><div class="action-text">${a.s}</div></div>`).join('');
}

// ── Import / Data tab ─────────────────────────────────────────────────────────
function renderImport() {
  // Populate cash fields from active month
  const mo=getMo(), c=mo.cash||{};
  document.getElementById('inp_period').value=mo.period;
  [['inp_cash','opening_balance'],['inp_ar0','ar_current'],['inp_ar31','ar_31_60'],['inp_ar61','ar_61_90'],['inp_ar90','ar_over_90'],['inp_ap','ap_current']].forEach(([id,k])=>{const el=document.getElementById(id);if(el&&c[k])el.value=c[k];});

  renderPipelineInputs();
  renderTaxSettings();
}

function saveCashEntry() {
  const period=document.getElementById('inp_period').value.trim();
  if(!/^\d{4}-\d{2}$/.test(period)){alert('Period must be YYYY-MM format');return;}
  const g=id=>+(document.getElementById(id)?.value||0);
  let mo=state.months.find(m=>m.period===period);
  if(!mo){mo={period,revenue:{by_principal:[]},direct_costs:{},expenses:{},pipeline:[]};state.months.push(mo);state.months.sort((a,b)=>a.period.localeCompare(b.period));}
  mo.cash={opening_balance:g('inp_cash'),ar_current:g('inp_ar0'),ar_31_60:g('inp_ar31'),ar_61_90:g('inp_ar61'),ar_over_90:g('inp_ar90'),ap_current:g('inp_ap')};
  saveState();renderSidebar();alert('Cash entry saved for '+period+'.');
}

let pipelineRows=[];
function renderPipelineInputs() {
  const mo=getMo();
  pipelineRows=[...(mo.pipeline||[])];
  const prs=principals();
  document.getElementById('pipelineInputs').innerHTML=pipelineRows.map((x,i)=>`
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 0.5fr;gap:6px;margin-bottom:6px;align-items:center">
      <input type="text" value="${x.client||''}" id="pl_client_${i}" placeholder="Client name" style="background:var(--surface);border:.5px solid var(--faint);border-radius:3px;padding:5px 8px;font-size:12px;color:var(--ink)">
      <select id="pl_principal_${i}" style="background:var(--surface);border:.5px solid var(--faint);border-radius:3px;padding:5px 8px;font-size:12px;color:var(--ink)">
        ${prs.map(p=>`<option value="${p.id}" ${x.principal===p.id?'selected':''}>${p.name.split(' ')[0]}</option>`).join('')}
      </select>
      <select id="pl_phase_${i}" style="background:var(--surface);border:.5px solid var(--faint);border-radius:3px;padding:5px 8px;font-size:12px;color:var(--ink)">
        ${['SD','SD/DD','DD','CD','CA'].map(ph=>`<option value="${ph}" ${x.phase===ph?'selected':''}>${ph}</option>`).join('')}
      </select>
      <input type="number" value="${x.fee||''}" id="pl_fee_${i}" placeholder="Fee $" style="background:var(--surface);border:.5px solid var(--faint);border-radius:3px;padding:5px 8px;font-size:12px;color:var(--ink)">
      <input type="number" value="${x.billed_pct||''}" id="pl_billed_${i}" placeholder="% billed" style="background:var(--surface);border:.5px solid var(--faint);border-radius:3px;padding:5px 8px;font-size:12px;color:var(--ink)">
    </div>`).join('');
}
function addPipelineRow() {
  pipelineRows.push({client:'',principal:'scott',phase:'SD',fee:0,billed_pct:0});
  renderPipelineInputs();
}
function savePipeline() {
  const mo=getMo();
  mo.pipeline=pipelineRows.map((_,i)=>({
    client:document.getElementById('pl_client_'+i)?.value||'',
    principal:document.getElementById('pl_principal_'+i)?.value||'scott',
    phase:document.getElementById('pl_phase_'+i)?.value||'SD',
    fee:+(document.getElementById('pl_fee_'+i)?.value||0),
    billed_pct:+(document.getElementById('pl_billed_'+i)?.value||0),
  })).filter(x=>x.client);
  saveState();renderSidebar();alert('Pipeline saved for '+mo.period+'.');
}

function renderTaxSettings() {
  const ts=state.taxSettings||{};
  const prs=principals();
  document.getElementById('taxSettingsWrap').innerHTML=prs.map(p=>{
    const t=ts[p.id]||{};
    const c=p.id==='scott'?'var(--scott)':'var(--bill)';
    return `<div style="margin-bottom:16px;padding-bottom:16px;border-bottom:.5px solid var(--faint)">
      <div style="font-size:10px;font-weight:600;letter-spacing:.10em;text-transform:uppercase;color:${c};margin-bottom:10px">${p.name}</div>
      <div class="fg">
        <div class="field"><label class="fl">W-2 Salary (annual)</label><input type="number" id="ts_wages_${p.id}" value="${t.wages||75000}" placeholder="75000"><span class="fh">Reasonable compensation from S-corp</span></div>
        <div class="field"><label class="fl">Other Income</label><input type="number" id="ts_other_${p.id}" value="${t.other_income||0}" placeholder="0"><span class="fh">Spouse income, investments, other</span></div>
        <div class="field"><label class="fl">Filing Status</label>
          <select id="ts_filing_${p.id}">
            <option value="mfj" ${(t.filing_status||'mfj')==='mfj'?'selected':''}>Married Filing Jointly</option>
            <option value="single" ${t.filing_status==='single'?'selected':''}>Single</option>
          </select>
        </div>
        <div class="field"><label class="fl">Prior Year Federal Tax</label><input type="number" id="ts_prfed_${p.id}" value="${t.prior_year_fed||0}" placeholder="0"><span class="fh">For safe harbor calculation</span></div>
        <div class="field"><label class="fl">Prior Year Alabama Tax</label><input type="number" id="ts_prala_${p.id}" value="${t.prior_year_ala||0}" placeholder="0"></div>
      </div>
    </div>`;
  }).join('');
}
function saveTaxSettings() {
  const prs=principals();
  if(!state.taxSettings) state.taxSettings={};
  prs.forEach(p=>{
    state.taxSettings[p.id]={
      wages:+document.getElementById('ts_wages_'+p.id)?.value||75000,
      other_income:+document.getElementById('ts_other_'+p.id)?.value||0,
      filing_status:document.getElementById('ts_filing_'+p.id)?.value||'mfj',
      prior_year_fed:+document.getElementById('ts_prfed_'+p.id)?.value||0,
      prior_year_ala:+document.getElementById('ts_prala_'+p.id)?.value||0,
    };
  });
  saveState();alert('Tax settings saved.');
}

// ── Settings tab ──────────────────────────────────────────────────────────────
function renderSettings() {
  document.getElementById('set_name').value=state.company?.name||'';
  document.getElementById('set_staff').value=state.company?.staff_count||'';
  document.getElementById('principalEditor').innerHTML=(state.company.principals||[]).map((p,i)=>
    `<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <input type="text" value="${p.name}" id="pr_name_${i}" style="flex:1;padding:7px;background:var(--surface);border:.5px solid var(--faint);border-radius:3px;font-size:13px;color:var(--ink)">
      <button class="btn btn-sm" style="color:var(--neg)" onclick="removePrincipal(${i})">✕</button>
    </div>`
  ).join('');
}
function addPrincipal(){state.company.principals.push({id:'pr'+Date.now(),name:'New Principal'});renderSettings();}
function removePrincipal(i){state.company.principals.splice(i,1);renderSettings();}
function saveSettings(){
  state.company.name=document.getElementById('set_name').value;
  state.company.staff_count=+document.getElementById('set_staff').value||8;
  (state.company.principals||[]).forEach((p,i)=>{p.name=document.getElementById('pr_name_'+i)?.value||p.name;});
  saveState();init();
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  loadState();
  if (!state.months?.length) { showTab('import'); return; }
  activeMonth = state.months[state.months.length-1].period;
  renderSidebar();
  showTab('firm');
}
init();
