// tax.js — Estimated tax calculations for CMA S-corp principals
// Architecture is explicitly excluded from SSTB — QBI deduction applies

// ── 2025 Federal brackets (Married Filing Jointly) ────────────────────────
const FED_BRACKETS_MFJ = [
  { max: 23200,   rate: 0.10 },
  { max: 94300,   rate: 0.12 },
  { max: 201050,  rate: 0.22 },
  { max: 383900,  rate: 0.24 },
  { max: 487450,  rate: 0.32 },
  { max: 731200,  rate: 0.35 },
  { max: Infinity, rate: 0.37 },
];
const FED_BRACKETS_SINGLE = [
  { max: 11600,   rate: 0.10 },
  { max: 47150,   rate: 0.12 },
  { max: 100525,  rate: 0.22 },
  { max: 191950,  rate: 0.24 },
  { max: 243725,  rate: 0.32 },
  { max: 609350,  rate: 0.35 },
  { max: Infinity, rate: 0.37 },
];

const STD_DEDUCTION_MFJ    = 30000;
const STD_DEDUCTION_SINGLE = 15000;

// Alabama 2025 — flat 4.95% above ~$3,000 single / $6,000 MFJ (simplified)
function alabamaTax(taxableIncome, filingStatus) {
  if (taxableIncome <= 0) return 0;
  const exempt = filingStatus === 'mfj' ? 6000 : 3000;
  return Math.max(0, (taxableIncome - exempt) * 0.0495);
}

// Federal ordinary income tax (progressive brackets)
function fedOrdinaryTax(taxableIncome, filingStatus) {
  const brackets = filingStatus === 'mfj' ? FED_BRACKETS_MFJ : FED_BRACKETS_SINGLE;
  let tax = 0, prev = 0;
  for (const b of brackets) {
    if (taxableIncome <= prev) break;
    tax += (Math.min(taxableIncome, b.max) - prev) * b.rate;
    prev = b.max;
  }
  return Math.max(0, tax);
}

// Effective marginal rate for display
function marginalRate(taxableIncome, filingStatus) {
  const brackets = filingStatus === 'mfj' ? FED_BRACKETS_MFJ : FED_BRACKETS_SINGLE;
  for (const b of brackets) {
    if (taxableIncome <= b.max) return b.rate;
  }
  return 0.37;
}

// FICA on W-2 wages (employee + employer share visible to principal)
function ficaOnWages(wages) {
  const ss = Math.min(wages, 176100) * 0.124;  // 12.4% SS (capped)
  const med = wages * 0.029;                    // 2.9% Medicare
  const addl = wages > 200000 ? (wages - 200000) * 0.009 : 0; // 0.9% additional Medicare
  return ss + med + addl;
}

// ── Main tax estimator ────────────────────────────────────────────────────────
// Inputs:
//   wages       — W-2 salary from S-corp
//   distributions — S-corp distributions received
//   otherIncome — spouse income or other (default 0)
//   filingStatus — 'mfj' | 'single'
//   priorYearTax — for safe harbor calculation

function estimateTax({
  wages = 0,
  distributions = 0,
  otherIncome = 0,
  filingStatus = 'mfj',
  priorYearFedTax = 0,
  priorYearAlaTax = 0,
} = {}) {

  const stdDed = filingStatus === 'mfj' ? STD_DEDUCTION_MFJ : STD_DEDUCTION_SINGLE;
  const grossIncome = wages + distributions + otherIncome;

  // QBI deduction: 20% of S-corp income (distributions = pass-through income)
  // Architecture is NOT SSTB — no phase-out applies
  // Limited to 20% of (taxable income - net capital gains)
  const qbiDeduction = Math.min(distributions * 0.20, (grossIncome - stdDed) * 0.20);

  const federalTaxable = Math.max(0, grossIncome - stdDed - qbiDeduction);
  const fedTax = fedOrdinaryTax(federalTaxable, filingStatus);
  const fica    = ficaOnWages(wages);  // both halves shown (employer pays half)
  const alaTax  = alabamaTax(Math.max(0, grossIncome - stdDed), filingStatus);
  const totalTax = fedTax + fica + alaTax;

  // Effective rates
  const effFedRate = grossIncome ? fedTax/grossIncome : 0;
  const effTotalRate = grossIncome ? totalTax/grossIncome : 0;
  const margFed = marginalRate(federalTaxable, filingStatus);

  // Quarterly estimated payments (federal + state, excluding W-2 withholding)
  // Distributions not withheld — principal must pay quarterly estimates
  const annualEstimate = fedTax + alaTax;  // FICA already withheld via payroll
  const safeHarbor = (priorYearFedTax + priorYearAlaTax) * 1.10; // 110% of prior year
  const quarterlyNeeded = Math.max(annualEstimate * 0.25, safeHarbor * 0.25);

  const QUARTERS = [
    { label: 'Q1 (due Apr 15)',  due: '2026-04-15', period: 'Jan–Mar 2026' },
    { label: 'Q2 (due Jun 16)',  due: '2026-06-16', period: 'Apr–May 2026' },
    { label: 'Q3 (due Sep 15)', due: '2026-09-15', period: 'Jun–Aug 2026' },
    { label: 'Q4 (due Jan 15)', due: '2027-01-15', period: 'Sep–Dec 2026' },
  ];

  return {
    grossIncome,
    qbiDeduction: Math.round(qbiDeduction),
    federalTaxable: Math.round(federalTaxable),
    fedTax:    Math.round(fedTax),
    fica:      Math.round(fica),
    alaTax:    Math.round(alaTax),
    totalTax:  Math.round(totalTax),
    netAfterTax: Math.round(grossIncome - totalTax),
    effFedRate,
    effTotalRate,
    margFed,
    annualEstimate: Math.round(annualEstimate),
    quarterlyPayment: Math.round(quarterlyNeeded),
    quarters: QUARTERS.map(q => ({ ...q, amount: Math.round(quarterlyNeeded) })),
  };
}

// Annualize from YTD figures
function annualizeTax(ytdWages, ytdDistributions, monthsElapsed, options = {}) {
  if (!monthsElapsed) return estimateTax(options);
  const factor = 12 / monthsElapsed;
  return estimateTax({
    ...options,
    wages: Math.round(ytdWages * factor),
    distributions: Math.round(ytdDistributions * factor),
  });
}

// Expose
window.TaxCalc = { estimateTax, annualizeTax, ficaOnWages };
