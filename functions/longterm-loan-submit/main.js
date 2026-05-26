const sdk = require('node-appwrite');
const { Client, Databases, Query } = sdk;

const client = new Client()
  .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT)
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(client);

const DATABASE_ID = process.env.DATABASE_ID;

const COLLECTIONS = {
  MEMBERS: process.env.MEMBERS_COLLECTION_ID,
  SAVINGS: process.env.SAVINGS_COLLECTION_ID,
  LOANS: process.env.LOANS_COLLECTION_ID,
  LOAN_GUARANTORS: process.env.LOAN_GUARANTORS_COLLECTION_ID,
  FINANCIAL_CONFIG: process.env.FINANCIAL_CONFIG_COLLECTION_ID
};

const LOAN_TYPES = {
  SHORT_TERM: 'short_term',
  LONG_TERM: 'long_term'
};

const LOAN_STATUSES = {
  PENDING_GUARANTOR_APPROVAL: 'pending_guarantor_approval',
  PENDING_ADMIN_APPROVAL: 'pending_admin_approval'
};
const {
  normalizeInterestCalculationMode,
  generateRepaymentSchedule
} = require('./loan-calculations');
const REPAYMENT_PLAN_VERSION = 2;

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

const ACTIVE_EXPOSURE_STATUSES = new Set([
  'active',
  'approved',
  LOAN_STATUSES.PENDING_GUARANTOR_APPROVAL,
  LOAN_STATUSES.PENDING_ADMIN_APPROVAL
]);

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    return JSON.parse(body);
  }
  return body;
}

function normalizeMemberId(value) {
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
    if (response.documents.length < limit) {
      break;
    }
    cursor = response.documents[response.documents.length - 1].$id;
  }

  return all;
}

function calculateLoanEligibility(totalSavings, eligibilityPercentage) {
  return Math.floor(totalSavings * (eligibilityPercentage / 100));
}

function calculateAvailableCredit(totalSavings, exposure, eligibilityPercentage) {
  const maxEligible = calculateLoanEligibility(totalSavings, eligibilityPercentage);
  return Math.max(0, maxEligible - exposure);
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
      generatedBy: 'longterm-loan-submit'
    })
  };
}

function normalizeGuarantorEntries(rawGuarantors, borrowerId, amount) {
  const list = Array.isArray(rawGuarantors) ? rawGuarantors : [];
  const dedupe = new Set();
  const normalized = [];

  for (const entry of list) {
    const guarantorId = String(entry?.guarantorId || '').trim();
    const guaranteeType = entry?.guaranteeType === 'percent' ? 'percent' : 'amount';

    if (!guarantorId) {
      throw new Error('Each guarantor entry must include a guarantor member ID.');
    }
    if (guarantorId === borrowerId) {
      throw new Error('Borrower cannot be listed as their own guarantor.');
    }
    if (dedupe.has(guarantorId)) {
      throw new Error('Duplicate guarantor entries are not allowed for the same loan.');
    }
    dedupe.add(guarantorId);

    const guaranteedPercent =
      guaranteeType === 'percent'
        ? toFloat(entry?.guaranteedPercent ?? entry?.guaranteedValue ?? 0, 0)
        : 0;
    const guaranteedAmount =
      guaranteeType === 'percent'
        ? Math.round((amount * guaranteedPercent) / 100)
        : toInteger(entry?.guaranteedAmount ?? entry?.guaranteedValue ?? 0, 0);

    if (guaranteeType === 'percent' && (guaranteedPercent <= 0 || guaranteedPercent > 100)) {
      throw new Error('Guarantor percentage must be greater than 0 and at most 100.');
    }

    if (guaranteedAmount <= 0) {
      throw new Error('Each guarantor must guarantee an amount greater than zero.');
    }

    normalized.push({
      guarantorId,
      guaranteeType,
      guaranteedPercent,
      guaranteedAmount
    });
  }

  return normalized;
}

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
      return { ...DEFAULT_FINANCIAL_CONFIG };
    }
    return { ...DEFAULT_FINANCIAL_CONFIG, ...response.documents[0] };
  } catch {
    return { ...DEFAULT_FINANCIAL_CONFIG };
  }
}

async function resolveBorrowerMember(memberIdFromPayload, requesterUserId) {
  if (!COLLECTIONS.MEMBERS) {
    const fallbackMemberId = normalizeMemberId(memberIdFromPayload);
    if (!fallbackMemberId) {
      throw new Error('Unable to resolve borrower identity.');
    }
    return { $id: fallbackMemberId };
  }

  if (!requesterUserId) {
    throw new Error('Authenticated member context is required.');
  }

  const byAuth = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.MEMBERS,
    [Query.equal('authUserId', requesterUserId), Query.limit(1)]
  );

  if (byAuth.documents.length === 0) {
    throw new Error('No member profile linked to current user.');
  }

  const member = byAuth.documents[0];
  const memberId = normalizeMemberId(memberIdFromPayload);
  if (memberId && memberId !== member.$id) {
    throw new Error('Member mismatch detected for loan submission.');
  }

  return member;
}

async function validateGuarantorMembers(guarantors) {
  if (!COLLECTIONS.MEMBERS || guarantors.length === 0) {
    return;
  }

  for (const guarantor of guarantors) {
    try {
      await databases.getDocument(DATABASE_ID, COLLECTIONS.MEMBERS, guarantor.guarantorId);
    } catch {
      throw new Error(`Guarantor member not found: ${guarantor.guarantorId}`);
    }
  }
}

async function getMemberSavings(memberId) {
  if (!COLLECTIONS.SAVINGS) return 0;
  const savings = await listAllDocuments(
    COLLECTIONS.SAVINGS,
    [Query.equal('memberId', memberId)]
  );
  return savings.reduce((sum, row) => sum + toInteger(row.amount, 0), 0);
}

async function getOutstandingExposure(memberId) {
  const loans = await listAllDocuments(
    COLLECTIONS.LOANS,
    [Query.equal('memberId', memberId)]
  );

  return loans
    .filter((loan) => ACTIVE_EXPOSURE_STATUSES.has(loan.status))
    .reduce((sum, loan) => sum + toInteger(loan.balance ?? loan.amount, 0), 0);
}

module.exports = async ({ req, res, log, error }) => {
  let createdLoanId = null;
  const createdGuarantorIds = [];

  try {
    if (!DATABASE_ID || !COLLECTIONS.LOANS || !COLLECTIONS.SAVINGS) {
      throw new Error('Function environment is missing required collection configuration.');
    }

    const payload = parseBody(req.body);
    if (payload?.action && payload.action !== 'submitLongTermLoan') {
      throw new Error('Invalid action for longterm-loan-submit.');
    }

    const requesterUserId = getRequesterUserId(req);
    const borrower = await resolveBorrowerMember(payload.memberId, requesterUserId);
    const borrowerId = borrower.$id;
    const config = await getFinancialConfig();

    const loanType =
      payload.loanType === LOAN_TYPES.SHORT_TERM
        ? LOAN_TYPES.SHORT_TERM
        : LOAN_TYPES.LONG_TERM;
    const amount = toInteger(payload.amount, 0);
    const selectedMonths = toInteger(payload.selectedMonths ?? payload.duration, 0);
    const termsAccepted = payload.termsAccepted === true;
    const repaymentType = payload.repaymentType === 'custom' ? 'custom' : 'equal';
    const purpose = String(payload.purpose || '').trim();
    const customPayments = Array.isArray(payload.customPayments) ? payload.customPayments : null;
    const createdAt = payload.applicationDate
      ? new Date(payload.applicationDate).toISOString()
      : new Date().toISOString();

    if (!termsAccepted) {
      throw new Error('Loan terms and conditions must be accepted.');
    }
    if (amount <= 0) {
      throw new Error('Loan amount must be greater than zero.');
    }
    if (amount < toInteger(config.minLoanAmount, 10000)) {
      throw new Error(`Minimum loan amount is ${toInteger(config.minLoanAmount, 10000)}.`);
    }
    if (amount > toInteger(config.maxLoanAmount, 5000000)) {
      throw new Error(`Maximum loan amount is ${toInteger(config.maxLoanAmount, 5000000)}.`);
    }
    if (selectedMonths <= 0) {
      throw new Error('Repayment months must be greater than zero.');
    }

    const maxMonths =
      loanType === LOAN_TYPES.LONG_TERM
        ? toInteger(config.longTermMaxRepaymentMonths, 24)
        : toInteger(config.maxLoanDuration, 6);
    if (selectedMonths > maxMonths) {
      throw new Error(`Selected months exceed configured maximum of ${maxMonths}.`);
    }
    if (repaymentType === 'custom' && !customPayments) {
      throw new Error('Custom repayment type requires monthly custom payment values.');
    }

    const monthlyRate =
      loanType === LOAN_TYPES.LONG_TERM
        ? toFloat(config.longTermInterestRate, 1.5) / 100
        : toFloat(config.loanInterestRate, 2) / 100;
    const interestCalculationMode = normalizeInterestCalculationMode(config.interestCalculationMode);

    const totalSavings = await getMemberSavings(borrowerId);
    const outstandingExposure = await getOutstandingExposure(borrowerId);
    const eligibilityPercentage = toFloat(config.loanEligibilityPercentage, 80);
    const availableCredit = calculateAvailableCredit(
      totalSavings,
      outstandingExposure,
      eligibilityPercentage
    );
    const borrowerCoverage = Math.max(0, Math.min(amount, availableCredit));
    const guarantorGapAmount = Math.max(0, amount - borrowerCoverage);
    const guarantorRequired = loanType === LOAN_TYPES.LONG_TERM && guarantorGapAmount > 0;

    if (loanType === LOAN_TYPES.SHORT_TERM && guarantorGapAmount > 0) {
      throw new Error('Short-term loan request exceeds available credit.');
    }

    let normalizedGuarantors = [];
    let guarantorRequestedAmount = 0;

    if (guarantorRequired) {
      if (!COLLECTIONS.LOAN_GUARANTORS) {
        throw new Error('Loan guarantors collection is not configured.');
      }
      normalizedGuarantors = normalizeGuarantorEntries(payload.guarantors, borrowerId, amount);
      if (normalizedGuarantors.length === 0) {
        throw new Error('At least one guarantor is required for this application.');
      }
      await validateGuarantorMembers(normalizedGuarantors);
      guarantorRequestedAmount = normalizedGuarantors.reduce(
        (sum, row) => sum + row.guaranteedAmount,
        0
      );
      if (guarantorRequestedAmount < guarantorGapAmount) {
        throw new Error(
          `Guarantor coverage is insufficient. Required: ${guarantorGapAmount}, provided: ${guarantorRequestedAmount}.`
        );
      }
    }

    const repaymentPlan = generateRepaymentSchedule({
      principal: amount,
      months: selectedMonths,
      monthlyRate,
      customPayments: repaymentType === 'custom' ? customPayments : null,
      interestCalculationMode
    });
    const repaymentPlanAudit = buildRepaymentPlanAudit({
      loanType,
      repaymentType,
      principal: amount,
      months: selectedMonths,
      monthlyRate,
      interestCalculationMode,
      hasCustomPayments: repaymentType === 'custom' && Array.isArray(customPayments),
      generatedAt: createdAt
    });

    const loanPayload = {
      memberId: borrowerId,
      amount,
      duration: selectedMonths,
      selectedMonths,
      loanType,
      termsAccepted,
      purpose,
      repaymentType,
      repaymentPlan: JSON.stringify(repaymentPlan),
      ...repaymentPlanAudit,
      status: guarantorRequired
        ? LOAN_STATUSES.PENDING_GUARANTOR_APPROVAL
        : LOAN_STATUSES.PENDING_ADMIN_APPROVAL,
      createdAt,
      guarantorRequired,
      borrowerCoverage,
      guarantorGapAmount,
      guarantorRequestedAmount,
      guarantorApprovedAmount: 0,
      guarantorApprovalStatus: guarantorRequired ? 'pending' : 'not_required',
      securedOriginalTotal: 0,
      securedOutstandingTotal: 0,
      guarantorPrincipalRecoveredTotal: 0,
      borrowerPrincipalRecoveredTotal: 0,
      repaymentAllocationStatus: guarantorRequired ? 'pending_guarantor' : 'not_required'
    };

    const createdLoan = await databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.LOANS,
      sdk.ID.unique(),
      loanPayload
    );

    createdLoanId = createdLoan.$id;

    if (guarantorRequired) {
      const now = new Date().toISOString();
      for (const guarantor of normalizedGuarantors) {
        const createdGuarantor = await databases.createDocument(
          DATABASE_ID,
          COLLECTIONS.LOAN_GUARANTORS,
          sdk.ID.unique(),
          {
            loanId: createdLoan.$id,
            borrowerId,
            guarantorId: guarantor.guarantorId,
            guaranteeType: guarantor.guaranteeType,
            guaranteedPercent:
              guarantor.guaranteeType === 'percent' ? guarantor.guaranteedPercent : 0,
            guaranteedAmount: guarantor.guaranteedAmount,
            approvedAmount: 0,
            securedOutstanding: 0,
            status: 'pending',
            comment: '',
            requestedAt: now,
            createdAt: now,
            updatedAt: now
          }
        );
        createdGuarantorIds.push(createdGuarantor.$id);
      }
    }

    return res.json({
      success: true,
      loanId: createdLoan.$id,
      status: loanPayload.status,
      guarantorRequestsCreated: createdGuarantorIds.length,
      summary: {
        totalSavings,
        outstandingExposure,
        availableCredit,
        borrowerCoverage,
        guarantorGapAmount,
        guarantorRequestedAmount
      }
    });
  } catch (err) {
    if (createdLoanId) {
      for (const guarantorId of createdGuarantorIds) {
        try {
          await databases.deleteDocument(DATABASE_ID, COLLECTIONS.LOAN_GUARANTORS, guarantorId);
        } catch (cleanupError) {
          error(`Cleanup failed for guarantor ${guarantorId}: ${cleanupError.message}`);
        }
      }
      try {
        await databases.deleteDocument(DATABASE_ID, COLLECTIONS.LOANS, createdLoanId);
      } catch (cleanupError) {
        error(`Cleanup failed for loan ${createdLoanId}: ${cleanupError.message}`);
      }
    }

    let errorMessage = err.message;
    if (String(err.message || '').includes('Unknown attribute: "selectedMonths"')) {
      errorMessage =
        `${err.message}. The loans collection schema is outdated for long-term loans. ` +
        'Run scripts/migrate-loan-schema-v2.js and ensure LOANS_COLLECTION_ID points to the same loans collection used by this function.';
    } else if (
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

    error(`longterm-loan-submit error: ${errorMessage}`);
    if (err.stack) {
      log(err.stack);
    }
    return res.json({ success: false, error: errorMessage }, 400);
  }
};
