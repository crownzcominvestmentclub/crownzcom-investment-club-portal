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

const RESPONSE_VALUES = {
  APPROVE: 'approve',
  APPROVED: 'approved',
  DECLINE: 'decline',
  DECLINED: 'declined'
};

const LOAN_STATUSES = {
  PENDING_GUARANTOR_APPROVAL: 'pending_guarantor_approval',
  PENDING_ADMIN_APPROVAL: 'pending_admin_approval',
  GUARANTOR_COVERAGE_FAILED: 'guarantor_coverage_failed'
};

const TERMINAL_LOAN_STATUSES = new Set([
  'rejected',
  'cancelled',
  'completed',
  LOAN_STATUSES.GUARANTOR_COVERAGE_FAILED
]);

const OPEN_GUARANTOR_WORKFLOW_STATUSES = new Set([
  LOAN_STATUSES.PENDING_GUARANTOR_APPROVAL,
  LOAN_STATUSES.PENDING_ADMIN_APPROVAL
]);

const BORROWER_EXPOSURE_STATUSES = new Set(['active', 'approved']);

const DEFAULT_FINANCIAL_CONFIG = {
  loanEligibilityPercentage: 80
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

function normalizeResponseValue(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === RESPONSE_VALUES.APPROVE || raw === RESPONSE_VALUES.APPROVED) {
    return RESPONSE_VALUES.APPROVED;
  }
  if (raw === RESPONSE_VALUES.DECLINE || raw === RESPONSE_VALUES.DECLINED) {
    return RESPONSE_VALUES.DECLINED;
  }
  return null;
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

async function resolveMemberByAuthUserId(authUserId) {
  if (!COLLECTIONS.MEMBERS) {
    throw new Error('Members collection is not configured.');
  }
  const response = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.MEMBERS,
    [Query.equal('authUserId', authUserId), Query.limit(1)]
  );
  if (response.documents.length === 0) {
    throw new Error('No member profile linked to current user.');
  }
  return response.documents[0];
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
    .filter((loan) => BORROWER_EXPOSURE_STATUSES.has(loan.status))
    .reduce((sum, loan) => sum + toInteger(loan.balance ?? loan.amount, 0), 0);
}

async function getApprovedGuaranteeReservations(guarantorId, excludeRequestId = null) {
  const approvedRequests = await listAllDocuments(
    COLLECTIONS.LOAN_GUARANTORS,
    [Query.equal('guarantorId', guarantorId), Query.equal('status', 'approved')]
  );

  const targetRequests = approvedRequests.filter((request) => request.$id !== excludeRequestId);
  if (targetRequests.length === 0) {
    return 0;
  }

  const loanIds = [...new Set(targetRequests.map((request) => normalizeId(request.loanId)).filter(Boolean))];
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

  return targetRequests.reduce((sum, request) => {
    const loanId = normalizeId(request.loanId);
    const loan = loanMap.get(loanId);
    if (loan && TERMINAL_LOAN_STATUSES.has(loan.status)) {
      return sum;
    }
    return sum + toInteger(
      request.securedOutstanding ?? request.approvedAmount ?? request.guaranteedAmount,
      0
    );
  }, 0);
}

function calculateAvailableCredit(totalSavings, outstandingExposure, eligibilityPercentage) {
  const maxEligible = Math.floor(totalSavings * (eligibilityPercentage / 100));
  return Math.max(0, maxEligible - outstandingExposure);
}

async function recomputeLoanGuarantorCoverage(loan, nowIso) {
  const loanId = loan.$id;
  const requests = await listAllDocuments(
    COLLECTIONS.LOAN_GUARANTORS,
    [Query.equal('loanId', loanId)]
  );

  let approvedRequests = requests.filter((request) => request.status === 'approved');
  const pendingRequests = requests.filter((request) => request.status === 'pending');

  let approvedTotal = approvedRequests.reduce(
    (sum, request) => sum + toInteger(request.approvedAmount ?? request.guaranteedAmount, 0),
    0
  );
  const pendingPotentialTotal = pendingRequests.reduce(
    (sum, request) => sum + toInteger(request.guaranteedAmount, 0),
    0
  );

  const guarantorGap = toInteger(loan.guarantorGapAmount, 0);
  const guarantorRequired = Boolean(loan.guarantorRequired);

  let nextLoanStatus = LOAN_STATUSES.PENDING_ADMIN_APPROVAL;
  let nextApprovalStatus = guarantorRequired ? 'pending' : 'not_required';

  if (!guarantorRequired || guarantorGap <= 0) {
    nextLoanStatus = LOAN_STATUSES.PENDING_ADMIN_APPROVAL;
    nextApprovalStatus = 'not_required';
  } else if (approvedTotal >= guarantorGap) {
    nextLoanStatus = LOAN_STATUSES.PENDING_ADMIN_APPROVAL;
    nextApprovalStatus = 'coverage_met';
  } else if (approvedTotal + pendingPotentialTotal < guarantorGap) {
    nextLoanStatus = LOAN_STATUSES.GUARANTOR_COVERAGE_FAILED;
    nextApprovalStatus = 'coverage_failed';
  } else {
    nextLoanStatus = LOAN_STATUSES.PENDING_GUARANTOR_APPROVAL;
    nextApprovalStatus = 'pending';
  }

  if (nextLoanStatus === LOAN_STATUSES.GUARANTOR_COVERAGE_FAILED && approvedRequests.length > 0) {
    await Promise.all(
      approvedRequests.map((request) =>
        databases.updateDocument(
          DATABASE_ID,
          COLLECTIONS.LOAN_GUARANTORS,
          request.$id,
          {
            status: 'released',
            releasedAt: nowIso,
            securedOutstanding: 0,
            updatedAt: nowIso
          }
        )
      )
    );
    approvedRequests = [];
    approvedTotal = 0;
  }

  const repaymentAllocationStatus = guarantorRequired && approvedTotal > 0
    ? 'guarantor_priority'
    : 'not_required';

  const loanUpdates = {
    status: nextLoanStatus,
    guarantorApprovedAmount: approvedTotal,
    guarantorApprovalStatus: nextApprovalStatus,
    securedOriginalTotal: approvedTotal,
    securedOutstandingTotal: approvedTotal,
    repaymentAllocationStatus
  };

  await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.LOANS,
    loanId,
    loanUpdates
  );

  return {
    loanStatus: nextLoanStatus,
    guarantorApprovalStatus: nextApprovalStatus,
    guarantorApprovedAmount: approvedTotal,
    guarantorGapAmount: guarantorGap,
    pendingPotentialAmount: pendingPotentialTotal
  };
}

module.exports = async ({ req, res, error, log }) => {
  try {
    if (!DATABASE_ID || !COLLECTIONS.LOANS || !COLLECTIONS.LOAN_GUARANTORS || !COLLECTIONS.MEMBERS) {
      throw new Error('Function environment is missing required collection configuration.');
    }

    const payload = parseBody(req.body);
    if (payload?.action && payload.action !== 'respondGuarantorRequest') {
      throw new Error('Invalid action for guarantor-response.');
    }

    const requesterUserId = getRequesterUserId(req);
    if (!requesterUserId) {
      throw new Error('Authenticated user context is required.');
    }

    const member = await resolveMemberByAuthUserId(requesterUserId);
    const memberId = member.$id;

    const requestId = String(payload.requestId || payload.guarantorRequestId || '').trim();
    if (!requestId) {
      throw new Error('Guarantor request ID is required.');
    }

    const responseValue = normalizeResponseValue(payload.response || payload.decision || payload.status);
    if (!responseValue) {
      throw new Error('Response must be one of: approve, approved, decline, declined.');
    }

    const comment = String(payload.comment || '').trim();
    if (comment.length > 500) {
      throw new Error('Comment cannot exceed 500 characters.');
    }

    const requestDoc = await databases.getDocument(
      DATABASE_ID,
      COLLECTIONS.LOAN_GUARANTORS,
      requestId
    );

    if (normalizeId(requestDoc.guarantorId) !== memberId) {
      throw new Error('You are not allowed to respond to this guarantor request.');
    }
    if (requestDoc.status !== 'pending') {
      throw new Error('This guarantor request has already been processed.');
    }

    const loanId = normalizeId(requestDoc.loanId);
    if (!loanId) {
      throw new Error('Guarantor request is missing a valid loan reference.');
    }

    const loan = await databases.getDocument(
      DATABASE_ID,
      COLLECTIONS.LOANS,
      loanId
    );

    if (TERMINAL_LOAN_STATUSES.has(loan.status)) {
      throw new Error(`Loan is already in terminal status: ${loan.status}.`);
    }

    if (!OPEN_GUARANTOR_WORKFLOW_STATUSES.has(loan.status)) {
      throw new Error(`Loan is not in guarantor response stage: ${loan.status}.`);
    }

    const nowIso = new Date().toISOString();
    const updatePayload = {
      status: responseValue,
      comment,
      respondedAt: nowIso,
      updatedAt: nowIso
    };

    if (responseValue === RESPONSE_VALUES.APPROVED) {
      const config = await getFinancialConfig();
      const totalSavings = await getMemberSavings(memberId);
      const outstandingExposure = await getOutstandingBorrowerExposure(memberId);
      const eligibilityPercentage = toFloat(config.loanEligibilityPercentage, 80);
      const availableCredit = calculateAvailableCredit(
        totalSavings,
        outstandingExposure,
        eligibilityPercentage
      );
      const existingReservations = await getApprovedGuaranteeReservations(memberId, requestId);
      const guarantorCapacity = Math.max(0, availableCredit - existingReservations);
      const requestedGuaranteeAmount = toInteger(requestDoc.guaranteedAmount, 0);

      if (requestedGuaranteeAmount <= 0) {
        throw new Error('Guarantor request amount is invalid.');
      }

      if (guarantorCapacity < requestedGuaranteeAmount) {
        throw new Error(
          `Insufficient guarantor capacity. Required: ${requestedGuaranteeAmount}, available: ${guarantorCapacity}.`
        );
      }

      updatePayload.approvedAmount = requestedGuaranteeAmount;
      updatePayload.securedOutstanding = requestedGuaranteeAmount;
      updatePayload.approvedAt = nowIso;
    } else {
      updatePayload.approvedAmount = 0;
      updatePayload.securedOutstanding = 0;
      updatePayload.declinedAt = nowIso;
    }

    await databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.LOAN_GUARANTORS,
      requestId,
      updatePayload
    );

    const coverage = await recomputeLoanGuarantorCoverage(loan, nowIso);

    return res.json({
      success: true,
      requestId,
      loanId,
      response: responseValue,
      coverage
    });
  } catch (err) {
    error(`guarantor-response error: ${err.message}`);
    if (err.stack) {
      log(err.stack);
    }
    return res.json({ success: false, error: err.message }, 400);
  }
};
