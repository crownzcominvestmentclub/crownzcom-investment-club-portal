const sdk = require('node-appwrite');
const { Client, Databases, Query } = sdk;
const { allocateProRataByOutstanding } = require('./waterfall');
const {
  INTEREST_CALCULATION_MODES,
  normalizeInterestCalculationMode,
  generateRepaymentSchedule,
  calculateScheduledInterest,
  calculateEarlyPayoffInterest
} = require('./loan-calculations');

const client = new Client()
  .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT)
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(client);

const DATABASE_ID = process.env.DATABASE_ID;
const COLLECTIONS = {
  LOANS: process.env.LOANS_COLLECTION_ID,
  LOAN_CHARGES: process.env.LOAN_CHARGES_COLLECTION_ID,
  LOAN_REPAYMENTS: process.env.LOAN_REPAYMENTS_COLLECTION_ID,
  LOAN_GUARANTORS: process.env.LOAN_GUARANTORS_COLLECTION_ID,
  LOAN_EARLY_REPAYMENTS: process.env.LOAN_EARLY_REPAYMENTS_COLLECTION_ID,
  SAVINGS: process.env.SAVINGS_COLLECTION_ID,
  FINANCIAL_CONFIG: process.env.FINANCIAL_CONFIG_COLLECTION_ID,
  LEDGER_ENTRIES: process.env.LEDGER_ENTRIES_COLLECTION_ID
};

const createLedgerEntry = async ({ type, amount, memberId, loanId, date, notes }) => {
  if (!COLLECTIONS.LEDGER_ENTRIES) return;
  const createdAt = date || new Date().toISOString();
  const month = createdAt.slice(0, 7);
  const year = parseInt(month.split('-')[0], 10);
  await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.LEDGER_ENTRIES,
    sdk.ID.unique(),
    {
      type,
      amount: parseInt(amount) || 0,
      memberId: memberId || null,
      loanId: loanId || null,
      month,
      year,
      createdAt,
      notes: notes || ''
    }
  );
};

const normalizeMemberId = (value) => {
  if (!value) return null;
  return typeof value === 'object' && value.$id ? value.$id : value;
};

const toInteger = (value, fallback = 0) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toFloat = (value, fallback = 0) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

async function listAllDocuments(collectionId, queries = []) {
  const all = [];
  let cursor = null;
  const limit = 100;

  while (true) {
    const pageQueries = [
      ...queries,
      Query.limit(limit),
      ...(cursor ? [Query.cursorAfter(cursor)] : [])
    ];
    const response = await databases.listDocuments(DATABASE_ID, collectionId, pageQueries);
    all.push(...response.documents);
    if (response.documents.length < limit) break;
    cursor = response.documents[response.documents.length - 1].$id;
  }

  return all;
}

function parseRepaymentPlan(loan) {
  if (!loan?.repaymentPlan) return [];
  try {
    const parsed = JSON.parse(loan.repaymentPlan);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getInstallmentMonthNumber(loan, requestedForDate, scheduleLength = 0) {
  if (!requestedForDate) return null;
  const start = new Date(loan.disbursedAt || loan.approvedAt || loan.createdAt || loan.$createdAt || 0);
  const target = new Date(requestedForDate);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(target.getTime())) {
    return null;
  }
  const monthDiff =
    (target.getFullYear() - start.getFullYear()) * 12 +
    (target.getMonth() - start.getMonth());
  const monthNumber = monthDiff + 1;
  if (scheduleLength > 0) {
    return Math.max(1, Math.min(scheduleLength, monthNumber));
  }
  return Math.max(1, monthNumber);
}

function getOpeningBalanceForMonth(schedule, monthNumber, fallbackAmount) {
  const month = toInteger(monthNumber, 0);
  if (month <= 1) return toInteger(fallbackAmount, 0);
  const previous = schedule.find((row) => toInteger(row?.month, 0) === month - 1);
  if (previous && previous.balance !== undefined && previous.balance !== null) {
    return Math.max(0, toInteger(previous.balance, fallbackAmount));
  }
  return Math.max(0, toInteger(fallbackAmount, 0));
}

async function listLoanRepayments(loanId) {
  return listAllDocuments(
    COLLECTIONS.LOAN_REPAYMENTS,
    [Query.equal('loanId', loanId)]
  );
}

async function getLoanChargeTotal(loanId) {
  const charges = await listAllDocuments(
    COLLECTIONS.LOAN_CHARGES,
    [Query.equal('loanId', loanId)]
  );
  return charges.reduce((sum, charge) => sum + toInteger(charge.amount, 0), 0);
}

function getNextUnpaidMonth(plan, repayments) {
  const schedule = Array.isArray(plan) ? plan : [];
  if (schedule.length === 0) return null;
  const paidMonths = new Set(
    repayments.map((repayment) => toInteger(repayment.month, 0)).filter((month) => month > 0)
  );
  const ordered = schedule
    .slice()
    .sort((a, b) => toInteger(a.month, 0) - toInteger(b.month, 0));

  for (const item of ordered) {
    const month = toInteger(item.month, 0);
    if (month > 0 && !paidMonths.has(month)) {
      return month;
    }
  }
  return null;
}

function hasRepaymentForMonth(repayments, monthNumber) {
  const target = toInteger(monthNumber, 0);
  if (target <= 0) return false;
  return repayments.some((repayment) => toInteger(repayment.month, 0) === target);
}

function getLoanMonthlyRate(loan, config) {
  const storedPercent = toFloat(loan.monthlyInterestRateApplied, NaN);
  if (Number.isFinite(storedPercent) && storedPercent >= 0) {
    return storedPercent / 100;
  }

  return loan.loanType === 'long_term'
    ? toFloat(config.longTermInterestRate, 1.5) / 100
    : toFloat(config.loanInterestRate, 2) / 100;
}

function getLoanCalculationContext(loan, config) {
  return {
    mode: normalizeInterestCalculationMode(
      loan.interestCalculationModeApplied || config.interestCalculationMode
    ),
    monthlyRate: getLoanMonthlyRate(loan, config)
  };
}

async function buildEarlyPayoffQuote({ loan, config, monthNumber, schedule }) {
  const currentBalance = Math.max(0, toInteger(loan.balance ?? loan.amount, 0));
  const plan = Array.isArray(schedule) ? schedule : parseRepaymentPlan(loan);
  const openingBalance = getOpeningBalanceForMonth(plan, monthNumber, currentBalance);
  const principalOutstanding = Math.min(currentBalance, openingBalance || currentBalance);
  const { mode: interestCalculationMode, monthlyRate } = getLoanCalculationContext(loan, config);
  const earlyPenaltyRate = toFloat(config.earlyRepaymentPenalty, 1) / 100;
  const repayments = await listLoanRepayments(loan.$id);
  const hasFirstMonthRepayment = repayments.some((repayment) => toInteger(repayment.month, 0) === 1);
  const bankCharge = await getLoanChargeTotal(loan.$id);
  const chargeAmount = toInteger(monthNumber, 0) === 1 && !hasFirstMonthRepayment ? bankCharge : 0;

  const interestBase = interestCalculationMode === INTEREST_CALCULATION_MODES.REDUCING_BALANCE
    ? principalOutstanding
    : Math.max(0, toInteger(loan.amount, principalOutstanding));
  const regularInterest = Math.ceil(interestBase * monthlyRate);
  const penaltyInterest = Math.ceil(interestBase * earlyPenaltyRate);
  const totalInterest = regularInterest + penaltyInterest;
  const paymentAmount = Math.ceil(principalOutstanding + totalInterest + chargeAmount);

  return {
    paymentAmount,
    principalPaid: principalOutstanding,
    interestPaid: totalInterest,
    chargeAmount,
    interestCalculationMode,
    monthlyRatePercent: Number((monthlyRate * 100).toFixed(6)),
    penaltyRatePercent: Number((earlyPenaltyRate * 100).toFixed(6)),
    currentBalance: principalOutstanding
  };
}

const DEFAULT_FINANCIAL_CONFIG = {
  loanInterestRate: 2,
  longTermInterestRate: 1.5,
  interestCalculationMode: 'flat',
  loanEligibilityPercentage: 80,
  defaultBankCharge: 5000,
  earlyRepaymentPenalty: 1,
  maxLoanDuration: 6,
  longTermMaxRepaymentMonths: 24,
  minLoanAmount: 10000,
  maxLoanAmount: 5000000
};

const REPAYMENT_PLAN_VERSION = 2;

const parseBody = (body) => {
  if (!body) return {};
  if (typeof body === 'string') {
    return JSON.parse(body);
  }
  return body;
};

async function getFinancialConfig() {
  if (!COLLECTIONS.FINANCIAL_CONFIG) {
    return { ...DEFAULT_FINANCIAL_CONFIG };
  }
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.FINANCIAL_CONFIG,
      [Query.limit(1)]
    );
    if (response.documents.length === 0) {
      const created = await databases.createDocument(
        DATABASE_ID,
        COLLECTIONS.FINANCIAL_CONFIG,
        sdk.ID.unique(),
        { ...DEFAULT_FINANCIAL_CONFIG }
      );
      return { ...DEFAULT_FINANCIAL_CONFIG, ...created };
    }
    return { ...DEFAULT_FINANCIAL_CONFIG, ...response.documents[0] };
  } catch {
    return { ...DEFAULT_FINANCIAL_CONFIG };
  }
}

function normalizeLoanType(value) {
  return value === 'long_term' ? 'long_term' : 'short_term';
}

function buildRepaymentPlanAudit({
  loanType,
  repaymentType,
  principal,
  months,
  monthlyRate,
  interestCalculationMode,
  hasCustomPayments,
  generatedAt
}) {
  const mode = normalizeInterestCalculationMode(interestCalculationMode);
  const monthlyRatePercent = Number((monthlyRate * 100).toFixed(6));

  return {
    interestCalculationModeApplied: mode,
    monthlyInterestRateApplied: monthlyRatePercent,
    repaymentPlanVersion: REPAYMENT_PLAN_VERSION,
    repaymentPlanGeneratedAt: generatedAt || new Date().toISOString(),
    repaymentPlanBasis: JSON.stringify({
      loanType,
      repaymentType,
      principal: toInteger(principal, 0),
      months: toInteger(months, 0),
      monthlyRatePercent,
      interestCalculationMode: mode,
      hasCustomPayments: Boolean(hasCustomPayments),
      generatedBy: 'loan-management-update'
    })
  };
}

module.exports = async ({ req, res, log, error }) => {
  try {
    const { action, ...data } = parseBody(req.body);

    switch (action) {
      case 'approveLoan':
        return res.json(await approveLoan(data.loanId));
      case 'rejectLoan':
        return res.json(await rejectLoan(data.loanId));
      case 'addLoanCharge':
        return res.json(await addLoanCharge(data.loanId, data.description, data.amount));
      case 'updateLoanCharge':
        return res.json(await updateLoanCharge(data.chargeId, data.description, data.amount));
      case 'deleteLoanCharge':
        return res.json(await deleteLoanCharge(data.chargeId));
      case 'recordRepayment':
        return res.json(await recordRepayment(data.loanId, data.amount, data.month, data.isEarlyPayment, data.paidAt));
      case 'requestEarlyRepayment':
        return res.json(await requestEarlyRepayment(data.loanId, data.memberId, data.requestedForDate));
      case 'cancelEarlyRepaymentRequest':
        return res.json(await cancelEarlyRepaymentRequest(data.requestId, data.memberId));
      case 'markEarlyRepaymentPaid':
        return res.json(await markEarlyRepaymentPaid(data.requestId, data.paidAt));
      case 'updateLoanDetails':
        return res.json(await updateLoanDetails(data.loanId, data.updates));
      case 'deleteLoan':
        return res.json(await deleteLoan(data.loanId));
      case 'validateLoanApplication':
        return res.json(await validateLoanApplication(data.loanId));
      default:
        throw new Error('Invalid action');
    }
  } catch (err) {
    error('Function error: ' + err.message);
    return res.json({ success: false, error: err.message }, 400);
  }
};

async function approveLoan(loanId) {
  const loan = await databases.getDocument(DATABASE_ID, COLLECTIONS.LOANS, loanId);
  const memberId = normalizeMemberId(loan.memberId);
  const config = await getFinancialConfig();
  
  // Validate eligibility
  const memberSavings = await getMemberSavings(memberId);
  const outstandingBalance = await getOutstandingLoanBalance(memberId);
  const maxEligible = memberSavings * (config.loanEligibilityPercentage / 100);
  const availableCredit = Math.max(0, maxEligible - outstandingBalance);
  
  if (loan.amount > availableCredit) {
    throw new Error('Loan amount exceeds 80% of member savings');
  }

  await databases.updateDocument(DATABASE_ID, COLLECTIONS.LOANS, loanId, {
    status: 'active',
    approvedAt: new Date().toISOString(),
    balance: loan.amount
  });

  await createLedgerEntry({
    type: 'LoanDisbursement',
    amount: loan.amount,
    memberId,
    loanId,
    date: new Date().toISOString(),
    notes: 'Loan approved and disbursed'
  });

  return { success: true, message: 'Loan approved and activated successfully' };
}

async function rejectLoan(loanId) {
  await databases.updateDocument(DATABASE_ID, COLLECTIONS.LOANS, loanId, {
    status: 'rejected',
    rejectedAt: new Date().toISOString()
  });

  return { success: true, message: 'Loan rejected successfully' };
}

async function addLoanCharge(loanId, description, amount) {
  const loan = await databases.getDocument(DATABASE_ID, COLLECTIONS.LOANS, loanId);
  const memberId = normalizeMemberId(loan.memberId);
  const chargeData = {
    loanId: loanId,
    description: description,
    amount: parseInt(amount),
    createdAt: new Date().toISOString()
  };

  await databases.createDocument(DATABASE_ID, COLLECTIONS.LOAN_CHARGES, sdk.ID.unique(), chargeData);
  await createLedgerEntry({
    type: 'TransferCharge',
    amount: chargeData.amount,
    memberId,
    loanId,
    date: chargeData.createdAt,
    notes: description || 'Loan transfer charge'
  });
  return { success: true, message: 'Bank charge added successfully' };
}

async function updateLoanCharge(chargeId, description, amount) {
  const existing = await databases.getDocument(DATABASE_ID, COLLECTIONS.LOAN_CHARGES, chargeId);
  const previousAmount = parseInt(existing.amount) || 0;
  await databases.updateDocument(DATABASE_ID, COLLECTIONS.LOAN_CHARGES, chargeId, {
    description: description,
    amount: parseInt(amount)
  });

  const diff = (parseInt(amount) || 0) - previousAmount;
  if (diff !== 0) {
    const loan = await databases.getDocument(DATABASE_ID, COLLECTIONS.LOANS, existing.loanId?.$id || existing.loanId);
    const memberId = normalizeMemberId(loan.memberId);
    await createLedgerEntry({
      type: 'TransferCharge',
      amount: diff,
      memberId,
      loanId: loan.$id,
      date: new Date().toISOString(),
      notes: `Transfer charge adjustment: ${description || 'updated'}`
    });
  }

  return { success: true, message: 'Bank charge updated successfully' };
}

async function deleteLoanCharge(chargeId) {
  const existing = await databases.getDocument(DATABASE_ID, COLLECTIONS.LOAN_CHARGES, chargeId);
  const amount = parseInt(existing.amount) || 0;
  const loanId = existing.loanId?.$id || existing.loanId;
  const loan = await databases.getDocument(DATABASE_ID, COLLECTIONS.LOANS, loanId);
  const memberId = normalizeMemberId(loan.memberId);

  await databases.deleteDocument(DATABASE_ID, COLLECTIONS.LOAN_CHARGES, chargeId);

  if (amount !== 0) {
    await createLedgerEntry({
      type: 'TransferCharge',
      amount: -amount,
      memberId,
      loanId,
      date: new Date().toISOString(),
      notes: 'Transfer charge removed'
    });
  }

  return { success: true, message: 'Bank charge removed successfully' };
}

async function recordRepayment(loanId, amount, month, isEarlyPayment = false, paidAt = null) {
  const loan = await databases.getDocument(DATABASE_ID, COLLECTIONS.LOANS, loanId);
  
  if (loan.status !== 'active') {
    throw new Error('Can only record repayments for active loans');
  }

  const config = await getFinancialConfig();
  const monthNumber = toInteger(month, 0);
  if (monthNumber <= 0) {
    throw new Error('Invalid repayment month');
  }
  const repaymentPlan = loan.repaymentPlan ? JSON.parse(loan.repaymentPlan) : [];
  const planItem = repaymentPlan.find(item => toInteger(item.month, 0) === monthNumber);
  if (!planItem && !isEarlyPayment) {
    throw new Error('Repayment schedule not found for selected month');
  }

  const chargeResponse = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.LOAN_CHARGES,
    [Query.equal('loanId', loanId)]
  );
  const bankCharge = chargeResponse.documents.reduce((sum, charge) => sum + toInteger(charge.amount, 0), 0);

  const existingRepayments = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.LOAN_REPAYMENTS,
    [Query.equal('loanId', loanId)]
  );
  const hasFirstMonthRepayment = existingRepayments.documents.some(r => toInteger(r.month, 0) === 1);

  let paymentAmount = 0;
  let principalPaid = 0;
  let interestPaid = 0;
  const currentBalance = Math.max(0, toInteger(loan.balance ?? loan.amount, 0));
  const { mode: interestCalculationMode, monthlyRate } = getLoanCalculationContext(loan, config);
  const earlyPenaltyRate = toFloat(config.earlyRepaymentPenalty, 1) / 100;

  if (isEarlyPayment) {
    const quote = await buildEarlyPayoffQuote({
      loan,
      config,
      monthNumber,
      schedule: repaymentPlan
    });
    paymentAmount = quote.paymentAmount;
    principalPaid = quote.principalPaid;
    interestPaid = quote.interestPaid;
  } else {
    const scheduledPayment = toInteger(planItem.payment ?? planItem.amount, 0);
    const scheduledInterest = calculateScheduledInterest({
      loanAmount: loan.amount,
      planItem,
      currentBalance,
      monthlyRate,
      interestCalculationMode
    });
    const netWithoutCharges = Math.max(0, scheduledPayment);
    const normalizedInterest = Math.min(Math.max(0, scheduledInterest), netWithoutCharges);
    const scheduledPrincipal = Math.max(
      0,
      toInteger(planItem.principal, netWithoutCharges - normalizedInterest)
    );
    const chargeAmount = monthNumber === 1 && !hasFirstMonthRepayment ? bankCharge : 0;
    paymentAmount = Math.ceil(netWithoutCharges + chargeAmount);
    interestPaid = normalizedInterest;
    principalPaid = Math.max(0, Math.min(currentBalance, netWithoutCharges - interestPaid, scheduledPrincipal));
  }

  // Create repayment record
  const repaymentTimestamp = paidAt ? new Date(paidAt).toISOString() : new Date().toISOString();
  const repaymentData = {
    loanId: loanId,
    amount: paymentAmount,
    month: monthNumber,
    paidAt: repaymentTimestamp,
    isEarlyPayment: !!isEarlyPayment
  };

  await databases.createDocument(DATABASE_ID, COLLECTIONS.LOAN_REPAYMENTS, sdk.ID.unique(), repaymentData);
  await createLedgerEntry({
    type: 'LoanRepayment',
    amount: repaymentData.amount,
    memberId: normalizeMemberId(loan.memberId),
    loanId,
    date: repaymentData.paidAt,
    notes: `Repayment month ${monthNumber}`
  });

  let guarantorPrincipalAllocation = 0;
  let borrowerPrincipalAllocation = principalPaid;

  const existingGuarantorRecovered = toInteger(loan.guarantorPrincipalRecoveredTotal, 0);
  const existingBorrowerRecovered = toInteger(loan.borrowerPrincipalRecoveredTotal, 0);
  const existingSecuredOriginalTotal = toInteger(loan.securedOriginalTotal, 0);
  const hasGuarantorWorkflow = Boolean(loan.guarantorRequired) || existingSecuredOriginalTotal > 0;
  let securedOutstandingTotal = toInteger(loan.securedOutstandingTotal, 0);
  let settlementCompletedAt = loan.guarantorSettlementCompletedAt || null;

  if (hasGuarantorWorkflow && COLLECTIONS.LOAN_GUARANTORS) {
    const approvedRequests = await listAllDocuments(
      COLLECTIONS.LOAN_GUARANTORS,
      [Query.equal('loanId', loanId), Query.equal('status', 'approved')]
    );

    const requestOutstandingTotal = approvedRequests.reduce(
      (sum, request) =>
        sum + toInteger(request.securedOutstanding ?? request.approvedAmount ?? request.guaranteedAmount, 0),
      0
    );
    const securedOutstandingBefore = Math.max(0, requestOutstandingTotal);
    securedOutstandingTotal = securedOutstandingBefore;

    if (securedOutstandingBefore > 0 && principalPaid > 0) {
      const allocation = allocateProRataByOutstanding(approvedRequests, principalPaid);
      guarantorPrincipalAllocation = allocation.allocatable;
      borrowerPrincipalAllocation = Math.max(0, principalPaid - guarantorPrincipalAllocation);

      if (allocation.allocations.length > 0) {
        await Promise.all(
          allocation.allocations.map((item) =>
            databases.updateDocument(
              DATABASE_ID,
              COLLECTIONS.LOAN_GUARANTORS,
              item.requestId,
              {
                securedOutstanding: item.nextOutstanding,
                updatedAt: repaymentTimestamp
              }
            )
          )
        );
      }

      securedOutstandingTotal = Math.max(0, securedOutstandingBefore - guarantorPrincipalAllocation);
      if (securedOutstandingBefore > 0 && securedOutstandingTotal === 0 && !settlementCompletedAt) {
        settlementCompletedAt = repaymentTimestamp;
      }
    } else {
      borrowerPrincipalAllocation = principalPaid;
      if (securedOutstandingBefore === 0 && !settlementCompletedAt && existingSecuredOriginalTotal > 0) {
        settlementCompletedAt = repaymentTimestamp;
      }
    }
  }

  // Keep loan financial balance tied to total principal repayment.
  const newBalance = Math.max(0, currentBalance - principalPaid);
  const status = newBalance === 0 ? 'completed' : 'active';
  const repaymentAllocationStatus = !hasGuarantorWorkflow
    ? 'not_required'
    : securedOutstandingTotal > 0
      ? 'guarantor_priority'
      : 'borrower_priority';

  const loanUpdates = {
    balance: newBalance,
    status: status,
    guarantorPrincipalRecoveredTotal: existingGuarantorRecovered + guarantorPrincipalAllocation,
    borrowerPrincipalRecoveredTotal: existingBorrowerRecovered + borrowerPrincipalAllocation,
    securedOutstandingTotal: hasGuarantorWorkflow ? securedOutstandingTotal : 0,
    repaymentAllocationStatus,
    lastRepaymentAllocationAt: repaymentTimestamp
  };
  if (settlementCompletedAt) {
    loanUpdates.guarantorSettlementCompletedAt = settlementCompletedAt;
  }

  await databases.updateDocument(DATABASE_ID, COLLECTIONS.LOANS, loanId, loanUpdates);

  return { 
    success: true, 
    message: 'Repayment recorded successfully',
    paymentAmount: paymentAmount,
    newBalance: newBalance,
    status: status,
    allocation: {
      interestPaid,
      principalPaid,
      guarantorPrincipalAllocation,
      borrowerPrincipalAllocation,
      securedOutstandingTotal,
      repaymentAllocationStatus,
      interestCalculationMode,
      monthlyRateApplied: Number((monthlyRate * 100).toFixed(6))
    }
  };
}

async function requestEarlyRepayment(loanId, memberId, requestedForDate = null) {
  if (!COLLECTIONS.LOAN_EARLY_REPAYMENTS) {
    throw new Error('Early repayment requests collection is not configured.');
  }
  const loan = await databases.getDocument(DATABASE_ID, COLLECTIONS.LOANS, loanId);
  if (loan.status !== 'active') {
    throw new Error('Early repayment requests are only allowed for active loans.');
  }

  const borrowerId = normalizeMemberId(loan.memberId);
  const requesterId = normalizeMemberId(memberId);
  if (requesterId && borrowerId && requesterId !== borrowerId) {
    throw new Error('Early repayment request does not match the borrower.');
  }

  const existing = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.LOAN_EARLY_REPAYMENTS,
    [Query.equal('loanId', loanId), Query.equal('status', 'pending'), Query.limit(1)]
  );
  if (existing.documents.length > 0) {
    throw new Error('There is already a pending early repayment request for this loan.');
  }

  const repayments = await listLoanRepayments(loanId);
  const plan = parseRepaymentPlan(loan);
  const monthNumber = getNextUnpaidMonth(plan, repayments);
  if (!monthNumber) {
    throw new Error('No unpaid installment found for early repayment.');
  }

  const config = await getFinancialConfig();
  const quote = await buildEarlyPayoffQuote({ loan, config, monthNumber, schedule: plan });
  const nowIso = new Date().toISOString();
  const requestedForIso = requestedForDate ? new Date(requestedForDate).toISOString() : null;

  const payload = {
    loanId,
    memberId: borrowerId,
    status: 'pending',
    month: monthNumber,
    amount: quote.paymentAmount,
    interestCalculationModeApplied: quote.interestCalculationMode,
    monthlyInterestRateApplied: quote.monthlyRatePercent,
    penaltyRateApplied: quote.penaltyRatePercent,
    interestAmount: quote.interestPaid,
    principalAmount: quote.principalPaid,
    chargeAmount: quote.chargeAmount,
    balanceAtRequest: quote.currentBalance,
    requestedAt: nowIso,
    requestedForDate: requestedForIso
  };

  const created = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.LOAN_EARLY_REPAYMENTS,
    sdk.ID.unique(),
    payload
  );

  return {
    success: true,
    requestId: created.$id,
    amount: quote.paymentAmount,
    month: monthNumber
  };
}

async function markEarlyRepaymentPaid(requestId, paidAt = null) {
  if (!COLLECTIONS.LOAN_EARLY_REPAYMENTS) {
    throw new Error('Early repayment requests collection is not configured.');
  }

  const request = await databases.getDocument(
    DATABASE_ID,
    COLLECTIONS.LOAN_EARLY_REPAYMENTS,
    requestId
  );

  if (request.status !== 'pending') {
    throw new Error('This early repayment request has already been processed.');
  }

  const loanId = request.loanId?.$id || request.loanId;
  if (!loanId) {
    throw new Error('Early repayment request has no loan reference.');
  }

  const loan = await databases.getDocument(DATABASE_ID, COLLECTIONS.LOANS, loanId);
  if (loan.status !== 'active') {
    throw new Error('Loan is not active.');
  }

  const repayments = await listLoanRepayments(loanId);
  const monthNumber = toInteger(request.month, 0) || getNextUnpaidMonth(parseRepaymentPlan(loan), repayments);
  if (!monthNumber) {
    throw new Error('No unpaid installment found for this loan.');
  }

  if (hasRepaymentForMonth(repayments, monthNumber)) {
    await databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.LOAN_EARLY_REPAYMENTS,
      requestId,
      {
        status: 'void',
        resolvedAt: new Date().toISOString(),
        adminComment: 'Repayment already recorded for this month.'
      }
    );
    throw new Error('Repayment already recorded for this installment.');
  }

  const paidIso = paidAt
    ? new Date(paidAt).toISOString()
    : (request.requestedForDate ? new Date(request.requestedForDate).toISOString() : new Date().toISOString());
  const repaymentResult = await recordRepayment(loanId, null, monthNumber, true, paidIso);

  await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.LOAN_EARLY_REPAYMENTS,
    requestId,
    {
      status: 'paid',
      paidAt: paidIso,
      resolvedAt: new Date().toISOString(),
      amount: repaymentResult.paymentAmount || request.amount
    }
  );

  return {
    success: true,
    requestId,
    loanId,
    paidAt: paidIso,
    paymentAmount: repaymentResult.paymentAmount
  };
}

async function cancelEarlyRepaymentRequest(requestId, memberId) {
  if (!COLLECTIONS.LOAN_EARLY_REPAYMENTS) {
    throw new Error('Early repayment requests collection is not configured.');
  }

  const request = await databases.getDocument(
    DATABASE_ID,
    COLLECTIONS.LOAN_EARLY_REPAYMENTS,
    requestId
  );

  if (request.status !== 'pending') {
    throw new Error('Only pending early repayment requests can be cancelled.');
  }

  const requesterId = normalizeMemberId(memberId);
  const requestMemberId = normalizeMemberId(request.memberId);
  if (requesterId && requestMemberId && requesterId !== requestMemberId) {
    throw new Error('You are not allowed to cancel this request.');
  }

  await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.LOAN_EARLY_REPAYMENTS,
    requestId,
    {
      status: 'cancelled',
      resolvedAt: new Date().toISOString(),
      adminComment: 'Cancelled by member'
    }
  );

  return { success: true, requestId };
}

async function updateLoanDetails(loanId, updates = {}) {
  if (!loanId) {
    throw new Error('Loan ID is required.');
  }

  const loan = await databases.getDocument(DATABASE_ID, COLLECTIONS.LOANS, loanId);
  const config = await getFinancialConfig();

  const nextLoanType = normalizeLoanType(updates.loanType || loan.loanType);
  const nextAmount = toInteger(updates.amount ?? loan.amount, 0);
  const nextDuration = toInteger(updates.duration ?? loan.selectedMonths ?? loan.duration, 0);
  const nextStatus = updates.status || loan.status;
  const nextBalance = toInteger(
    updates.balance ?? loan.balance ?? loan.amount,
    toInteger(loan.amount, 0)
  );

  if (nextAmount <= 0) {
    throw new Error('Loan amount must be greater than zero.');
  }
  if (nextDuration <= 0) {
    throw new Error('Loan duration must be greater than zero.');
  }

  const requestedMode = updates.interestCalculationModeApplied;
  const mode = normalizeInterestCalculationMode(
    (requestedMode !== undefined && requestedMode !== null && String(requestedMode).trim() !== '')
      ? requestedMode
      : (loan.interestCalculationModeApplied || config.interestCalculationMode)
  );
  const monthlyRatePercent = Number.isFinite(toFloat(loan.monthlyInterestRateApplied, NaN))
    ? toFloat(loan.monthlyInterestRateApplied, 0)
    : (nextLoanType === 'long_term'
      ? toFloat(config.longTermInterestRate, 1.5)
      : toFloat(config.loanInterestRate, 2));
  const monthlyRate = monthlyRatePercent / 100;

  let customPayments = null;
  if (loan.repaymentType === 'custom') {
    const existingPlan = parseRepaymentPlan(loan);
    if (existingPlan.length !== nextDuration) {
      throw new Error('Custom repayment plan length does not match the updated duration.');
    }
    customPayments = existingPlan.map((row) => toInteger(row?.payment, 0));
  }

  const repaymentPlan = generateRepaymentSchedule({
    principal: nextAmount,
    months: nextDuration,
    monthlyRate,
    customPayments,
    interestCalculationMode: mode
  });
  const repaymentPlanAudit = buildRepaymentPlanAudit({
    loanType: nextLoanType,
    repaymentType: loan.repaymentType,
    principal: nextAmount,
    months: nextDuration,
    monthlyRate,
    interestCalculationMode: mode,
    hasCustomPayments: Array.isArray(customPayments),
    generatedAt: new Date().toISOString()
  });

  const payload = {
    amount: nextAmount,
    balance: nextBalance,
    status: nextStatus,
    loanType: nextLoanType,
    duration: nextDuration,
    selectedMonths: nextDuration,
    repaymentPlan: JSON.stringify(repaymentPlan),
    ...repaymentPlanAudit
  };

  await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.LOANS,
    loanId,
    payload
  );

  return { success: true, loanId };
}

async function deleteLoan(loanId) {
  if (!loanId) {
    throw new Error('Loan ID is required.');
  }

  const repayments = await listAllDocuments(
    COLLECTIONS.LOAN_REPAYMENTS,
    [Query.equal('loanId', loanId)]
  );
  for (const repayment of repayments) {
    await databases.deleteDocument(DATABASE_ID, COLLECTIONS.LOAN_REPAYMENTS, repayment.$id);
  }

  const charges = await listAllDocuments(
    COLLECTIONS.LOAN_CHARGES,
    [Query.equal('loanId', loanId)]
  );
  for (const charge of charges) {
    await databases.deleteDocument(DATABASE_ID, COLLECTIONS.LOAN_CHARGES, charge.$id);
  }

  if (COLLECTIONS.LOAN_GUARANTORS) {
    const guarantors = await listAllDocuments(
      COLLECTIONS.LOAN_GUARANTORS,
      [Query.equal('loanId', loanId)]
    );
    for (const guarantor of guarantors) {
      await databases.deleteDocument(DATABASE_ID, COLLECTIONS.LOAN_GUARANTORS, guarantor.$id);
    }
  }

  if (COLLECTIONS.LOAN_EARLY_REPAYMENTS) {
    const requests = await listAllDocuments(
      COLLECTIONS.LOAN_EARLY_REPAYMENTS,
      [Query.equal('loanId', loanId)]
    );
    for (const request of requests) {
      await databases.deleteDocument(DATABASE_ID, COLLECTIONS.LOAN_EARLY_REPAYMENTS, request.$id);
    }
  }

  if (COLLECTIONS.LEDGER_ENTRIES) {
    const ledgerEntries = await listAllDocuments(
      COLLECTIONS.LEDGER_ENTRIES,
      [Query.equal('loanId', loanId)]
    );
    for (const entry of ledgerEntries) {
      await databases.deleteDocument(DATABASE_ID, COLLECTIONS.LEDGER_ENTRIES, entry.$id);
    }
  }

  await databases.deleteDocument(DATABASE_ID, COLLECTIONS.LOANS, loanId);

  return { success: true, message: 'Loan deleted successfully.' };
}

async function validateLoanApplication(loanId) {
  const loan = await databases.getDocument(DATABASE_ID, COLLECTIONS.LOANS, loanId);
  const memberId = normalizeMemberId(loan.memberId);
  const config = await getFinancialConfig();
  const memberSavings = await getMemberSavings(memberId);
  const outstandingBalance = await getOutstandingLoanBalance(memberId);
  const maxLoanAmount = memberSavings * (config.loanEligibilityPercentage / 100);
  const availableCredit = Math.max(0, maxLoanAmount - outstandingBalance);
  
  return {
    success: true,
    isEligible: loan.amount <= availableCredit,
    memberSavings: memberSavings,
    maxLoanAmount: maxLoanAmount,
    requestedAmount: loan.amount
  };
}

async function getMemberSavings(memberId) {
  const normalizedId = normalizeMemberId(memberId);
  if (!normalizedId) return 0;
  const savingsResponse = await databases.listDocuments(
    DATABASE_ID, 
    COLLECTIONS.SAVINGS,
    [Query.equal('memberId', normalizedId)]
  );
  
  return savingsResponse.documents.reduce((total, saving) => total + saving.amount, 0);
}

async function getOutstandingLoanBalance(memberId) {
  const normalizedId = normalizeMemberId(memberId);
  if (!normalizedId) return 0;
  const loansResponse = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.LOANS,
    [Query.equal('memberId', normalizedId)]
  );
  return loansResponse.documents
    .filter(loan => loan.status === 'active')
    .reduce((sum, loan) => sum + (loan.balance || loan.amount), 0);
}
