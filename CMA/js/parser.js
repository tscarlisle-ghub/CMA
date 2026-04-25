// parser.js — QuickBooks P&L Detail parser for CMA
// Handles the "Profit and Loss Detail" export format from QuickBooks

// Account → field mapping (QB account code prefix → internal field)
const ACCOUNT_MAP = {
  '44100': { section: 'fees',         field: 'services' },
  '43500': { section: 'reimbursables',field: 'billable_expense_income' },
  '43530': { section: 'other_income', field: 'other' },

  '60000': { section: 'expenses', field: 'advertising' },
  '60015': { section: 'expenses', field: 'bank_charges' },
  '60020': { section: 'expenses', field: 'car_truck' },
  '60025': { section: 'expenses', field: 'charitable' },
  '60035': { section: 'expenses', field: 'cleaning' },
  '60040': { section: 'expenses', field: 'computer_software' },
  '60050': { section: 'expenses', field: 'contractors' },
  '60060': { section: 'expenses', field: 'depreciation' },
  '60065': { section: 'expenses', field: 'dues_subscriptions' },
  '60085': { section: 'expenses', field: 'gas' },
  '60095': { section: 'expenses', field: 'insurance_eo' },
  '60100': { section: 'expenses', field: 'insurance_general' },
  '60106': { section: 'expenses', field: 'health_insurance' },
  '60115': { section: 'expenses', field: 'internet' },
  '60125': { section: 'expenses', field: 'legal_professional' },
  '60130': { section: 'expenses', field: 'meals_entertainment' },
  '60135': { section: 'expenses', field: 'office_supplies' },
  '60155': { section: 'expenses', field: 'payroll_processing' },
  '60160': { section: 'expenses', field: 'payroll_taxes' },
  '60165': { section: 'expenses', field: 'phone' },
  '60170': { section: 'expenses', field: 'printing' },
  '60175': { section: 'expenses', field: 'photography' },
  '60195': { section: 'expenses', field: 'rent' },
  '60200': { section: 'expenses', field: 'payroll_wages' },
  '60205': { section: 'expenses', field: 'payroll_wages' },
  '60210': { section: 'expenses', field: 'payroll_wages' },
  '61000': { section: 'expenses', field: 'payroll_wages' },
  '61100': { section: 'expenses', field: 'payroll_wages' },
  '61500': { section: 'expenses', field: 'payroll_wages' },
};

// Class name → principal ID
const CLASS_MAP = {
  'scott': 'scott',
  'bill':  'bill',
  'Scott': 'scott',
  'Bill':  'bill',
};

// ── Main parse function ───────────────────────────────────────────────────────
// Takes an ArrayBuffer from FileReader, returns parsed data object
function parseQBExcel(arrayBuffer) {
  if (!window.XLSX) throw new Error('SheetJS not loaded');

  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Extract date range from header (row 2: "January-December, 2025")
  let reportYear = new Date().getFullYear();
  let reportPeriod = '';
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    const cell = String(row[0] || '');
    const yearMatch = cell.match(/(\d{4})/);
    if (yearMatch) { reportYear = +yearMatch[1]; reportPeriod = cell; break; }
    // Also check other columns
    for (const c of row) {
      const cs = String(c || '');
      const ym = cs.match(/(\d{4})/);
      if (ym) { reportYear = +ym[1]; reportPeriod = cs; break; }
    }
    if (reportPeriod) break;
  }

  // Find the header row (contains "Transaction date", "Amount", etc.)
  let headerRow = -1;
  let colMap = {};
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i].map(c => String(c||'').toLowerCase().trim());
    if (row.includes('transaction date') || row.includes('amount')) {
      headerRow = i;
      row.forEach((h, idx) => {
        if (h.includes('transaction date') || h === 'date') colMap.date = idx;
        if (h === 'amount') colMap.amount = idx;
        if (h.includes('class')) colMap.classField = idx;
        if (h.includes('name')) colMap.name = idx;
        if (h.includes('description')) colMap.desc = idx;
        if (h.includes('num')) colMap.num = idx;
      });
      break;
    }
  }

  // Parse transactions: accumulate by month, by account, by class
  // Structure: { 'YYYY-MM': { fees_scott, fees_bill, expenses: {...}, reimbursables_scott, reimbursables_bill } }
  const monthly = {};
  const annual  = { fees: {}, reimbursables: 0, other_income: 0, expenses: {} };

  let currentAccount = '';
  let currentAccountCode = '';

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => !c)) continue;

    const firstCell = String(row[0] || '').trim();

    // Detect account section header (e.g., "44100 Services" or "60050 Contractors")
    const accountHeader = firstCell.match(/^(\d{4,6})\s+(.+)/);
    if (accountHeader && !firstCell.toLowerCase().startsWith('total')) {
      currentAccountCode = accountHeader[1];
      currentAccount = firstCell;
      continue;
    }

    // Detect "Total for XXXXX" rows
    if (firstCell.toLowerCase().startsWith('total for ')) {
      // Extract total amount (last numeric cell)
      let total = 0;
      for (let j = row.length - 1; j >= 0; j--) {
        const v = parseFloat(String(row[j] || '').replace(/,/g,''));
        if (!isNaN(v) && v !== 0) { total = v; break; }
      }
      const code = currentAccountCode;
      const mapping = ACCOUNT_MAP[code];
      if (mapping) {
        if (mapping.section === 'fees') annual.fees.total = (annual.fees.total||0) + total;
        else if (mapping.section === 'reimbursables') annual.reimbursables += total;
        else if (mapping.section === 'other_income') annual.other_income += total;
        else if (mapping.section === 'expenses') {
          annual.expenses[mapping.field] = (annual.expenses[mapping.field]||0) + total;
        }
      }
      continue;
    }

    // Transaction row — needs a date and amount
    if (headerRow < 0) continue;
    const dateCell = row[colMap.date !== undefined ? colMap.date : 0];
    const amtCell  = row[colMap.amount !== undefined ? colMap.amount : (row.length - 2)];
    const classCell = colMap.classField !== undefined ? String(row[colMap.classField]||'').trim() : '';

    if (!dateCell || !amtCell) continue;

    // Parse date
    let txDate = null;
    if (dateCell instanceof Date) {
      txDate = dateCell;
    } else {
      const ds = String(dateCell).trim();
      // Try MM/DD/YYYY
      const m = ds.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) txDate = new Date(+m[3], +m[1]-1, +m[2]);
    }
    if (!txDate || isNaN(txDate.getTime())) continue;

    const amount = parseFloat(String(amtCell).replace(/,/g,''));
    if (isNaN(amount) || amount === 0) continue;

    const period  = `${txDate.getFullYear()}-${String(txDate.getMonth()+1).padStart(2,'0')}`;
    const principalId = CLASS_MAP[classCell] || null;
    const mapping = ACCOUNT_MAP[currentAccountCode];
    if (!mapping) continue;

    if (!monthly[period]) {
      monthly[period] = {
        period,
        fees_scott: 0, fees_bill: 0, fees_unassigned: 0,
        reimb_scott: 0, reimb_bill: 0,
        expenses: {},
      };
    }
    const mo = monthly[period];

    if (mapping.section === 'fees') {
      if (principalId === 'scott') mo.fees_scott += amount;
      else if (principalId === 'bill') mo.fees_bill += amount;
      else mo.fees_unassigned += amount;
    } else if (mapping.section === 'reimbursables') {
      if (principalId === 'scott') mo.reimb_scott += amount;
      else if (principalId === 'bill') mo.reimb_bill += amount;
      else { mo.reimb_scott += amount * 0.5; mo.reimb_bill += amount * 0.5; }
    } else if (mapping.section === 'expenses') {
      mo.expenses[mapping.field] = (mo.expenses[mapping.field]||0) + amount;
    }
  }

  // Convert to the dashboard's month schema
  const months = Object.values(monthly)
    .sort((a, b) => a.period.localeCompare(b.period))
    .map(mo => ({
      period: mo.period,
      revenue: {
        by_principal: [
          { principal_id:'scott', fees: Math.round(mo.fees_scott + mo.fees_unassigned/2), reimbursables: Math.round(mo.reimb_scott) },
          { principal_id:'bill',  fees: Math.round(mo.fees_bill  + mo.fees_unassigned/2), reimbursables: Math.round(mo.reimb_bill) },
        ]
      },
      direct_costs: {
        subconsultants:        0,
        reprographics:         Math.round(mo.expenses.printing || 0),
        reimbursable_expenses: 0,
        other_direct:          0,
      },
      expenses: {
        payroll_wages:       Math.round(mo.expenses.payroll_wages || 0),
        payroll_taxes:       Math.round(mo.expenses.payroll_taxes || 0),
        health_insurance:    Math.round(mo.expenses.health_insurance || 0),
        contractors:         Math.round(mo.expenses.contractors || 0),
        computer_software:   Math.round(mo.expenses.computer_software || 0),
        dues_subscriptions:  Math.round(mo.expenses.dues_subscriptions || 0),
        rent:                Math.round(mo.expenses.rent || 0),
        insurance_eo:        Math.round(mo.expenses.insurance_eo || 0),
        insurance_general:   Math.round(mo.expenses.insurance_general || 0),
        legal_professional:  Math.round(mo.expenses.legal_professional || 0),
        meals_entertainment: Math.round(mo.expenses.meals_entertainment || 0),
        office_supplies:     Math.round(mo.expenses.office_supplies || 0),
        advertising:         Math.round(mo.expenses.advertising || 0),
        car_truck:           Math.round(mo.expenses.car_truck || 0),
        phone:               Math.round(mo.expenses.phone || 0),
        internet:            Math.round(mo.expenses.internet || 0),
        printing:            0,  // already captured in reprographics
        gas:                 Math.round(mo.expenses.gas || 0),
        cleaning:            Math.round(mo.expenses.cleaning || 0),
        bank_charges:        Math.round(mo.expenses.bank_charges || 0),
        payroll_processing:  Math.round(mo.expenses.payroll_processing || 0),
        photography:         Math.round(mo.expenses.photography || 0),
        other:               Math.round(mo.expenses.charitable || 0),
      },
      cash:     { opening_balance:0, ar_current:0, ar_31_60:0, ar_61_90:0, ar_over_90:0, ap_current:0 },
      pipeline: [],
    }));

  return {
    reportYear,
    reportPeriod,
    months,
    annual,
    principalTotals: {
      scott: Object.values(monthly).reduce((s,m) => s + m.fees_scott + m.reimb_scott, 0),
      bill:  Object.values(monthly).reduce((s,m) => s + m.fees_bill  + m.reimb_bill, 0),
    },
  };
}

window.QBParser = { parseQBExcel };
