const sdk = require('node-appwrite');
const { Client, Databases, Users, Query } = sdk;

const client = new Client()
  .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT)
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(client);
const users = new Users(client);

const DATABASE_ID = process.env.DATABASE_ID;
const ADMIN_LABEL = process.env.ADMIN_LABEL || 'admin';
const ADMIN_USER_IDS = new Set(
  String(process.env.ADMIN_USER_IDS || process.env.APPWRITE_ADMIN_USER_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

const COLLECTIONS = {
  LOANS: process.env.LOANS_COLLECTION_ID,
  LOAN_GUARANTORS: process.env.LOAN_GUARANTORS_COLLECTION_ID,
  SAVINGS: process.env.SAVINGS_COLLECTION_ID,
  FINANCIAL_CONFIG: process.env.FINANCIAL_CONFIG_COLLECTION_ID,
  LEDGER_ENTRIES: process.env.LEDGER_ENTRIES_COLLECTION_ID
};

const LOAN_TYPES = {
  SHORT_TERM: 'short_term',
  LONG_TERM: 'long_term'
};

const LOAN_STATUSES = {
  ACTIVE: 'active',
  PENDING_ADMIN_APPROVAL: 'pending_admin_approval',
  GUARANTOR_COVERAGE_FAILED: 'guarantor_coverage_failed'
};
const {
  normalizeInterestCalculationMode,
  generateRepaymentSchedule
} = require('./loan-calculations');
const REPAYMENT_PLAN_VERSION = 2;

const TERMINAL_LOAN_STATUSES = new Set([
  'rejected',
  'cancelled',
  'completed',
  LOAN_STATUSES.GUARANTOR_COVERAGE_FAILED
]);

const EXPOSURE_STATUSES = new Set(['active', 'approved']);

const DEFAULT_FINANCIAL_CONFIG = {
  loanInterestRate: 2,
  longTermInterestRate: 1.5,
  interestCalculationMode: 'flat',
  loanEligibilityPercentage: 80,
  maxLoanDuration: 6,
  longTermMaxRepaymentMonths: 24,
  minLoanAmount: 10000,
  maxLoanAmount: 5000000
};

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'string') return JSON.parse(body);
  return body;
}

function normalizeId(value) {
  if (!value) return null;
  return typeof value === 'object' && value.$id ? value.$id : value;
}

function toInteger(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback = 0) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRequesterUserId(req) {
  const headers = req?.headers || {};
  return (
    headers['x-appwrite-user-id'] ||
    headers['X-Appwrite-User-Id'] ||
    headers['x-appwrite-userid'] ||
    headers['X-Appwrite-Userid'] ||
    null
  );
}

function calculateLoanEligibility(totalSavings, eligibilityPercentage) {
  return Math.floor(totalSavings * (eligibilityPercentage / 100));
}

function calculateAvailableCredit(totalSavings, outstandingExposure, eligibilityPercentage) {
  const maxEligible = calculateLoanEligibility(totalSavings, eligibilityPercentage);
  return Math.max(0, maxEligible - outstandingExposure);
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
      generatedBy: 'loan-final-approval'
    })
  };
}

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

async function getFinancialConfig() {
  if (!COLLECTIONS.FINANCIAL_CONFIG) return { ...DEFAULT_FINANCIAL_CONFIG };

  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.FINANCIAL_CONFIG,
      [Query.limit(1)]
    );
    if (response.documents.length === 0) {
      return { ...DEFAULT_FINANCIAL_CONFIG };
    }
    return { ...DEFAULT_FINANCIAL_CONFIG, ...response.documents[0] };
  } catch {
    return { ...DEFAULT_FINANCIAL_CONFIG };
  }
}

async function isAdminUser(userId) {
  if (!userId) return false;
  if (ADMIN_USER_IDS.has(userId)) return true;
  const user = await users.get(userId);
  return Array.isArray(user.labels) && user.labels.includes(ADMIN_LABEL);
}

async function getMemberSavings(memberId) {
  if (!COLLECTIONS.SAVINGS) return 0;
  const savings = await listAllDocuments(
    COLLECTIONS.SAVINGS,
    [Query.equal('memberId', memberId)]
  );
  return savings.reduce((sum, row) => sum + toInteger(row.amount, 0), 0);
}

async function getOutstandingBorrowerExposure(memberId) {
  const loans = await listAllDocuments(
    COLLECTIONS.LOANS,
    [Query.equal('memberId', memberId)]
  );
  return loans
    .filter((loan) => EXPOSURE_STATUSES.has(loan.status))
    .reduce((sum, loan) => sum + toInteger(loan.balance ?? loan.amount, 0), 0);
}

async function getApprovedGuarantorRequestsByLoan(loanId) {
  if (!COLLECTIONS.LOAN_GUARANTORS) return [];
  return listAllDocuments(
    COLLECTIONS.LOAN_GUARANTORS,
    [Query.equal('loanId', loanId), Query.equal('status', 'approved')]
  );
}

async function getPendingGuarantorRequestsByLoan(loanId) {
  if (!COLLECTIONS.LOAN_GUARANTORS) return [];
  return listAllDocuments(
    COLLECTIONS.LOAN_GUARANTORS,
    [Query.equal('loanId', loanId), Query.equal('status', 'pending')]
  );
}

async function getActiveApprovedGuaranteeReservations(guarantorId, excludeLoanId) {
  if (!COLLECTIONS.LOAN_GUARANTORS) return 0;

  const approvedRequests = await listAllDocuments(
    COLLECTIONS.LOAN_GUARANTORS,
    [Query.equal('guarantorId', guarantorId), Query.equal('status', 'approved')]
  );

  const relevant = approvedRequests.filter(
    (request) => normalizeId(request.loanId) && normalizeId(request.loanId) !== excludeLoanId
  );
  if (relevant.length === 0) return 0;

  const loanIds = [...new Set(relevant.map((request) => normalizeId(request.loanId)).filter(Boolean))];
  const loanMap = new Map();

  await Promise.all(
    loanIds.map(async (loanId) => {
      try {
        const loan = await databases.getDocument(DATABASE_ID, COLLECTIONS.LOANS, loanId);
        loanMap.set(loanId, loan);
      } catch {
        loanMap.set(loanId, null);
      }
    })
  );

  return relevant.reduce((sum, request) => {
    const loan = loanMap.get(normalizeId(request.loanId));
    if (loan && TERMINAL_LOAN_STATUSES.has(loan.status)) return sum;
    return sum + toInteger(
      request.securedOutstanding ?? request.approvedAmount ?? request.guaranteedAmount,
      0
    );
  }, 0);
}

function extractCustomPaymentsFromLoan(loan, months) {
  if (loan.repaymentType !== 'custom') return null;
  if (!loan.repaymentPlan) {
    throw new Error('Loan has custom repayment type but no repayment plan.');
  }

  let parsed;
  try {
    parsed = JSON.parse(loan.repaymentPlan);
  } catch {
    throw new Error('Loan custom repayment plan is invalid JSON.');
  }

  if (!Array.isArray(parsed) || parsed.length !== months) {
    throw new Error('Loan custom repayment plan is missing month entries.');
  }

  const payments = parsed.map((row) => toInteger(row?.payment, 0));
  if (payments.some((payment) => payment <= 0)) {
    throw new Error('Loan custom repayment plan contains invalid payment values.');
  }

  return payments;
}

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
      amount: toInteger(amount, 0),
      memberId: memberId || null,
      loanId: loanId || null,
      month,
      year,
      createdAt,
      notes: notes || ''
    }
  );
};

module.exports = async ({ req, res, log, error }) => {
  try {
    if (!DATABASE_ID || !COLLECTIONS.LOANS) {
      throw new Error('Function environment is missing required collection configuration.');
    }

    const payload = parseBody(req.body);
    if (payload?.action && payload.action !== 'finalApproveLoan') {
      throw new Error('Invalid action for loan-final-approval.');
    }

    const requesterUserId = getRequesterUserId(req);
    if (!requesterUserId) {
      throw new Error('Authenticated admin context is required.');
    }

    const admin = await isAdminUser(requesterUserId);
    if (!admin) {
      throw new Error('Only admin users can final-approve loans.');
    }

    const loanId = String(payload.loanId || '').trim();
    if (!loanId) {
      throw new Error('Loan ID is required.');
    }

    const loan = await databases.getDocument(DATABASE_ID, COLLECTIONS.LOANS, loanId);
    if (loan.status !== LOAN_STATUSES.PENDING_ADMIN_APPROVAL) {
      throw new Error(`Loan is not ready for final approval. Current status: ${loan.status}.`);
    }

    if (!loan.termsAccepted) {
      throw new Error('Loan terms and conditions were not accepted by borrower.');
    }

    const config = await getFinancialConfig();
    const amount = toInteger(loan.amount, 0);
    const loanType = loan.loanType === LOAN_TYPES.LONG_TERM ? LOAN_TYPES.LONG_TERM : LOAN_TYPES.SHORT_TERM;
    const months = toInteger(loan.selectedMonths ?? loan.duration, 0);

    if (amount <= 0) {
      throw new Error('Loan amount must be greater than zero.');
    }
    if (amount < toInteger(config.minLoanAmount, 10000)) {
      throw new Error(`Loan amount is below minimum configured amount (${toInteger(config.minLoanAmount, 10000)}).`);
    }
    if (amount > toInteger(config.maxLoanAmount, 5000000)) {
      throw new Error(`Loan amount exceeds maximum configured amount (${toInteger(config.maxLoanAmount, 5000000)}).`);
    }
    if (months <= 0) {
      throw new Error('Loan repayment months are invalid.');
    }

    const maxMonths = loanType === LOAN_TYPES.LONG_TERM
      ? toInteger(config.longTermMaxRepaymentMonths, 24)
      : toInteger(config.maxLoanDuration, 6);
    if (months > maxMonths) {
      throw new Error(`Loan months exceed configured maximum (${maxMonths}).`);
    }

    const borrowerId = normalizeId(loan.memberId);
    if (!borrowerId) {
      throw new Error('Loan borrower reference is invalid.');
    }

    const borrowerSavings = await getMemberSavings(borrowerId);
    const borrowerExposure = await getOutstandingBorrowerExposure(borrowerId);
    const eligibilityPercent = toFloat(config.loanEligibilityPercentage, 80);
    const borrowerAvailableCredit = calculateAvailableCredit(
      borrowerSavings,
      borrowerExposure,
      eligibilityPercent
    );
    const borrowerCoverageNow = Math.min(amount, borrowerAvailableCredit);
    const requiredGuarantorGapNow = Math.max(0, amount - borrowerCoverageNow);

    let approvedGuarantorTotal = 0;
    const guarantorRequired = Boolean(loan.guarantorRequired);
    const approvedGuarantorRequests = await getApprovedGuarantorRequestsByLoan(loanId);

    if (guarantorRequired || loanType === LOAN_TYPES.LONG_TERM) {
      approvedGuarantorTotal = approvedGuarantorRequests.reduce(
        (sum, request) => sum + toInteger(request.approvedAmount ?? request.guaranteedAmount, 0),
        0
      );
      if (requiredGuarantorGapNow > 0 && approvedGuarantorTotal < requiredGuarantorGapNow) {
        throw new Error(
          `Insufficient approved guarantor coverage. Required: ${requiredGuarantorGapNow}, approved: ${approvedGuarantorTotal}.`
        );
      }

      for (const request of approvedGuarantorRequests) {
        const guarantorId = normalizeId(request.guarantorId);
        const approvedAmount = toInteger(request.approvedAmount ?? request.guaranteedAmount, 0);
        if (!guarantorId || approvedAmount <= 0) {
          throw new Error(`Invalid approved guarantor entry detected (${request.$id}).`);
        }

        const guarantorSavings = await getMemberSavings(guarantorId);
        const guarantorExposure = await getOutstandingBorrowerExposure(guarantorId);
        const guarantorAvailableCredit = calculateAvailableCredit(
          guarantorSavings,
          guarantorExposure,
          eligibilityPercent
        );
        const otherReservations = await getActiveApprovedGuaranteeReservations(guarantorId, loanId);
        const guarantorCapacity = Math.max(0, guarantorAvailableCredit - otherReservations);

        if (guarantorCapacity < approvedAmount) {
          throw new Error(
            `Guarantor ${guarantorId} no longer has capacity. Required: ${approvedAmount}, available: ${guarantorCapacity}.`
          );
        }
      }
    } else if (borrowerAvailableCredit < amount) {
      throw new Error(
        `Borrower no longer has enough available credit. Required: ${amount}, available: ${borrowerAvailableCredit}.`
      );
    }

    const nowIso = payload.approvedAt
      ? new Date(payload.approvedAt).toISOString()
      : new Date().toISOString();
    const monthlyRate = loanType === LOAN_TYPES.LONG_TERM
      ? toFloat(config.longTermInterestRate, 1.5) / 100
      : toFloat(config.loanInterestRate, 2) / 100;
    const interestCalculationMode = normalizeInterestCalculationMode(config.interestCalculationMode);
    const customPayments = extractCustomPaymentsFromLoan(loan, months);
    const repaymentPlan = generateRepaymentSchedule({
      principal: amount,
      months,
      monthlyRate,
      customPayments,
      interestCalculationMode
    });
    const repaymentPlanAudit = buildRepaymentPlanAudit({
      loanType,
      repaymentType: loan.repaymentType,
      principal: amount,
      months,
      monthlyRate,
      interestCalculationMode,
      hasCustomPayments: Array.isArray(customPayments),
      generatedAt: nowIso
    });
    const securedTotal = Math.max(0, Math.min(approvedGuarantorTotal, requiredGuarantorGapNow || approvedGuarantorTotal));

    const loanUpdates = {
      status: LOAN_STATUSES.ACTIVE,
      approvedAt: nowIso,
      balance: amount,
      duration: months,
      selectedMonths: months,
      loanType,
      repaymentPlan: JSON.stringify(repaymentPlan),
      ...repaymentPlanAudit,
      borrowerCoverage: borrowerCoverageNow,
      guarantorGapAmount: requiredGuarantorGapNow,
      guarantorApprovedAmount: securedTotal,
      guarantorApprovalStatus: requiredGuarantorGapNow > 0 ? 'coverage_met' : 'not_required',
      securedOriginalTotal: requiredGuarantorGapNow > 0 ? securedTotal : 0,
      securedOutstandingTotal: requiredGuarantorGapNow > 0 ? securedTotal : 0,
      repaymentAllocationStatus: requiredGuarantorGapNow > 0 && securedTotal > 0 ? 'guarantor_priority' : 'not_required'
    };

    await databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.LOANS,
      loanId,
      loanUpdates
    );

    if (COLLECTIONS.LOAN_GUARANTORS) {
      await Promise.all(
        approvedGuarantorRequests.map((request) => {
          const approvedAmount = toInteger(request.approvedAmount ?? request.guaranteedAmount, 0);
          return databases.updateDocument(
            DATABASE_ID,
            COLLECTIONS.LOAN_GUARANTORS,
            request.$id,
            {
              approvedAmount,
              securedOutstanding: approvedAmount,
              updatedAt: nowIso
            }
          );
        })
      );

      const pendingRequests = await getPendingGuarantorRequestsByLoan(loanId);
      await Promise.all(
        pendingRequests.map((request) =>
          databases.updateDocument(
            DATABASE_ID,
            COLLECTIONS.LOAN_GUARANTORS,
            request.$id,
            {
              status: 'released',
              releasedAt: nowIso,
              updatedAt: nowIso,
              comment: request.comment || 'Released after final loan approval.'
            }
          )
        )
      );
    }

    await createLedgerEntry({
      type: 'LoanDisbursement',
      amount,
      memberId: borrowerId,
      loanId,
      date: nowIso,
      notes: 'Loan final-approved and disbursed'
    });

    return res.json({
      success: true,
      loanId,
      status: LOAN_STATUSES.ACTIVE,
      approvedAt: nowIso,
      summary: {
        borrowerAvailableCredit,
        borrowerCoverage: borrowerCoverageNow,
        requiredGuarantorGap: requiredGuarantorGapNow,
        approvedGuarantorCoverage: securedTotal
      }
    });
  } catch (err) {
    let errorMessage = err.message;
    if (
      String(err.message || '').includes('Unknown attribute: "interestCalculationModeApplied"') ||
      String(err.message || '').includes('Unknown attribute: "monthlyInterestRateApplied"') ||
      String(err.message || '').includes('Unknown attribute: "repaymentPlanVersion"') ||
      String(err.message || '').includes('Unknown attribute: "repaymentPlanGeneratedAt"') ||
      String(err.message || '').includes('Unknown attribute: "repaymentPlanBasis"')
    ) {
      errorMessage =
        `${err.message}. The loans collection schema is outdated for repayment plan metadata. ` +
        'Run scripts/migrate-loan-schema-v4.js and ensure LOANS_COLLECTION_ID points to the same loans collection used by this function.';
    }

    error(`loan-final-approval error: ${errorMessage}`);
    if (err.stack) {
      log(err.stack);
    }
    return res.json({ success: false, error: errorMessage }, 400);
  }
};
