const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'backups', 'appwrite-2026-04-18');
const COLLECTIONS_DIR = path.join(BACKUP_DIR, 'databases', '697c8ef300284cc12596', 'collections');
const STORAGE_DIR = path.join(BACKUP_DIR, 'storage');
const OUT_DIR = path.join(ROOT, 'worker', 'import-sql');

const escapeString = (value) => {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
};

const toInt = (value) => {
  if (value === null || value === undefined || value === '') return 'NULL';
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.trunc(n)}` : 'NULL';
};

const toBooleanInt = (value) => (value ? '1' : '0');

const toTimestamp = (value) => {
  if (!value) return 'NULL';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'NULL';
  return `${date.valueOf()}`;
};

const parseYearMonth = (value) => {
  if (!value) return { year: null, month: null };
  const match = /^\s*(\d{4})-(\d{1,2})\s*$/.exec(value);
  if (!match) return { year: null, month: null };
  return { year: Number(match[1]), month: Number(match[2]) };
};

const normalizeUnitTrustKind = (value) => {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'purchase' || type === 'deposit') return 'deposit';
  if (type === 'withdrawal' || type === 'redeem') return 'withdrawal';
  if (type === 'interest') return 'interest';
  return 'deposit';
};

const loadJson = async (relativePath) => {
  const file = path.join(BACKUP_DIR, relativePath);
  const text = await fs.readFile(file, 'utf8');
  return JSON.parse(text);
};

const loadCollection = async (collectionName) => {
  const file = path.join(COLLECTIONS_DIR, collectionName, 'documents.json');
  const text = await fs.readFile(file, 'utf8');
  return JSON.parse(text);
};

const loadFileMetadata = async () => {
  const metadata = {};
  const documentFiles = await loadJson(path.join('storage', 'documents', 'files.json'));
  for (const file of documentFiles) {
    metadata[file.$id] = file;
  }
  const brandingFiles = await loadJson(path.join('storage', 'branding', 'files.json'));
  for (const file of brandingFiles) {
    metadata[file.$id] = file;
  }
  return metadata;
};

const buildInsert = (table, columns, values) => `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});`;

const build = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const fileMetadata = await loadFileMetadata();
  const documentCategories = await loadCollection('document_categories');
  const categoryMap = new Map(documentCategories.map((row) => [row.name, row.$id]));

  const collections = [
    'members',
    'savings',
    'subscriptions',
    'loans',
    'loan_charges',
    'loan_repayments',
    'loan_early_repayment_requests',
    'expenses',
    'unit_trust',
    'documents',
    'document_categories',
    '698362d8002f547b05d3', // ledger_entries
    '6981fca000395c3160fb', // financial_config
    'interest_allocations',
  ];

  const output = [];
  output.push('PRAGMA foreign_keys = OFF;');
  output.push('BEGIN TRANSACTION;');

  const push = (stmt) => output.push(stmt);

  // members
  const members = await loadCollection('members');
  for (const row of members) {
    push(
      buildInsert('members', [
        'id',
        'full_name',
        'email',
        'phone',
        'status',
        'joined_at',
        'membership_number',
        'appwrite_auth_user_id',
      ], [
        escapeString(row.$id),
        escapeString(row.name),
        escapeString(row.email),
        escapeString(row.phone),
        escapeString(row.status || 'active'),
        toTimestamp(row.joinDate),
        escapeString(row.membershipNumber),
        escapeString(row.authUserId),
      ])
    );
  }

  // savings
  const savings = await loadCollection('savings');
  for (const row of savings) {
    const { year, month } = parseYearMonth(row.month);
    push(
      buildInsert('savings', [
        'id',
        'member_id',
        'period_month',
        'period_year',
        'amount',
        'status',
        'paid_at',
        'created_at',
        'created_by',
      ], [
        escapeString(row.$id),
        escapeString(row.memberId),
        toInt(month),
        toInt(year),
        toInt(row.amount),
        escapeString('paid'),
        toTimestamp(row.createdAt || row.$createdAt),
        toTimestamp(row.createdAt || row.$createdAt),
        'NULL',
      ])
    );
  }

  // subscriptions
  const subscriptions = await loadCollection('subscriptions');
  for (const row of subscriptions) {
    const { year } = parseYearMonth(row.month);
    push(
      buildInsert('subscriptions', [
        'id',
        'member_id',
        'period_year',
        'amount',
        'status',
        'paid_at',
        'created_at',
      ], [
        escapeString(row.$id),
        escapeString(row.memberId),
        toInt(year),
        toInt(row.amount),
        escapeString('paid'),
        toTimestamp(row.createdAt || row.$createdAt),
        toTimestamp(row.createdAt || row.$createdAt),
      ])
    );
  }

  // loans
  const loans = await loadCollection('loans');
  for (const row of loans) {
    push(
      buildInsert('loans', [
        'id',
        'member_id',
        'type',
        'principal',
        'interest_rate_pct',
        'term_months',
        'purpose',
        'status',
        'outstanding',
        'applied_at',
        'approved_at',
        'rejected_reason',
        'due_at',
        'selected_months',
        'repayment_type',
        'repayment_plan',
        'terms_accepted',
        'borrower_coverage',
      ], [
        escapeString(row.$id),
        escapeString(row.memberId),
        escapeString(row.loanType),
        toInt(row.amount),
        toInt(row.monthlyInterestRateApplied ?? 0),
        toInt(row.selectedMonths ?? row.duration),
        escapeString(row.purpose),
        escapeString(row.status),
        toInt(row.balance),
        toTimestamp(row.createdAt),
        toTimestamp(row.approvedAt),
        'NULL',
        'NULL',
        toInt(row.selectedMonths ?? row.duration),
        escapeString(row.repaymentType),
        escapeString(row.repaymentPlan),
        toBooleanInt(row.termsAccepted),
        toInt(row.borrowerCoverage),
      ])
    );
  }

  // loan_charges
  const loanCharges = await loadCollection('loan_charges');
  for (const row of loanCharges) {
    const kind = /bank.*charge/i.test(row.description) ? 'processing_fee' : 'other';
    push(
      buildInsert('loan_charges', [
        'id',
        'loan_id',
        'kind',
        'amount',
        'note',
        'created_at',
      ], [
        escapeString(row.$id),
        escapeString(row.loanId),
        escapeString(kind),
        toInt(row.amount),
        escapeString(row.description),
        toTimestamp(row.createdAt),
      ])
    );
  }

  // loan_repayments
  const loanRepayments = await loadCollection('loan_repayments');
  for (const row of loanRepayments) {
    push(
      buildInsert('loan_repayments', [
        'id',
        'loan_id',
        'amount',
        'principal_portion',
        'interest_portion',
        'guarantor_portion',
        'paid_at',
        'recorded_by',
        'created_at',
      ], [
        escapeString(row.$id),
        escapeString(row.loanId),
        toInt(row.amount),
        toInt(row.amount),
        '0',
        '0',
        toTimestamp(row.paidAt),
        'NULL',
        toTimestamp(row.$createdAt),
      ])
    );
  }

  // loan_early_repayment_requests
  const earlyRequests = await loadCollection('loan_early_repayment_requests');
  for (const row of earlyRequests) {
    push(
      buildInsert('early_repayment_requests', [
        'id',
        'loan_id',
        'member_id',
        'amount',
        'status',
        'requested_at',
        'resolved_at',
        'interest_calculation_mode',
        'monthly_interest_rate',
        'penalty_rate',
        'interest_amount',
        'principal_amount',
        'charge_amount',
        'balance_at_request',
        'requested_for_date',
        'paid_at',
        'admin_comment',
      ], [
        escapeString(row.$id),
        escapeString(row.loanId),
        escapeString(row.memberId),
        toInt(row.amount),
        escapeString(row.status),
        toTimestamp(row.requestedAt),
        toTimestamp(row.resolvedAt),
        escapeString(row.interestCalculationModeApplied),
        toInt(row.monthlyInterestRateApplied),
        toInt(row.penaltyRateApplied),
        toInt(row.interestAmount),
        toInt(row.principalAmount),
        toInt(row.chargeAmount),
        toInt(row.balanceAtRequest),
        toTimestamp(row.requestedForDate),
        toTimestamp(row.paidAt),
        escapeString(row.adminComment),
      ])
    );
  }

  // expenses
  const expenses = await loadCollection('expenses');
  for (const row of expenses) {
    push(
      buildInsert('expenses', [
        'id',
        'category',
        'amount',
        'note',
        'incurred_at',
        'created_at',
        'created_by',
      ], [
        escapeString(row.$id),
        escapeString(row.category),
        toInt(row.amount),
        escapeString(row.description),
        toTimestamp(row.date),
        toTimestamp(row.createdAt),
        'NULL',
      ])
    );
  }

  // unit_trust
  const unitTrust = await loadCollection('unit_trust');
  for (const row of unitTrust) {
    push(
      buildInsert('unit_trust', [
        'id',
        'kind',
        'amount',
        'occurred_at',
        'note',
        'created_at',
      ], [
        escapeString(row.$id),
        escapeString(normalizeUnitTrustKind(row.type)),
        toInt(row.amount),
        toTimestamp(row.date),
        escapeString(row.description),
        toTimestamp(row.$createdAt),
      ])
    );
  }

  // document_categories
  for (const row of documentCategories) {
    push(
      buildInsert('document_categories', ['id', 'name'], [escapeString(row.$id), escapeString(row.name)])
    );
  }

  // documents
  const documents = await loadCollection('documents');
  for (const row of documents) {
    const { year, month } = parseYearMonth(row.period);
    const categoryId = categoryMap.get(row.category) || null;
    const metadata = fileMetadata[row.fileId] || {};
    push(
      buildInsert('documents', [
        'id',
        'category_id',
        'title',
        'object_key',
        'content_type',
        'size_bytes',
        'uploaded_at',
        'uploaded_by',
        'scope',
        'tags',
        'period',
        'notes',
      ], [
        escapeString(row.$id),
        escapeString(categoryId),
        escapeString(row.title),
        escapeString(`${row.bucketId}/${row.fileId}`),
        escapeString(metadata.mimeType || null),
        toInt(metadata.sizeOriginal ?? null),
        toTimestamp(row.uploadedAt),
        'NULL',
        escapeString(row.bucketId),
        escapeString(row.tags),
        escapeString(row.period),
        escapeString(row.notes),
      ])
    );
  }

  // ledger_entries
  const ledgerEntries = await loadCollection('698362d8002f547b05d3');
  for (const row of ledgerEntries) {
    const account = row.type ? String(row.type).toLowerCase() : 'ledger';
    const direction = row.amount >= 0 ? 'credit' : 'debit';
    const refType = row.loanId ? 'loan' : row.memberId ? 'member' : null;
    const refId = row.loanId || row.memberId || null;
    const { year, month } = parseYearMonth(row.month);
    const occurredAt = year && month ? new Date(Date.UTC(year, month - 1, 1)).valueOf() : toTimestamp(row.createdAt);
    push(
      buildInsert('ledger', [
        'id',
        'occurred_at',
        'account',
        'direction',
        'amount',
        'ref_type',
        'ref_id',
        'memo',
        'created_at',
      ], [
        escapeString(row.$id),
        toInt(occurredAt),
        escapeString(account),
        escapeString(direction),
        toInt(row.amount),
        escapeString(refType),
        escapeString(refId),
        escapeString(row.notes || row.type),
        toTimestamp(row.createdAt),
      ])
    );
  }

  // financial_config
  const configs = await loadCollection('6981fca000395c3160fb');
  if (configs.length > 0) {
    const config = configs[0];
    push(
      buildInsert('financial_config', [
        'id',
        'currency',
        'monthly_contribution',
        'short_term_rate_pct',
        'long_term_rate_pct',
        'loan_eligibility_pct',
        'late_penalty_pct',
        'default_bank_charge',
        'early_repayment_penalty',
        'min_loan_amount',
        'max_loan_amount',
        'long_term_max_repayment_months',
        'interest_calculation_mode',
        'updated_at',
      ], [
        '1',
        escapeString('UGX'),
        '100000',
        toInt(config.loanInterestRate),
        toInt(config.longTermInterestRate),
        toInt(config.loanEligibilityPercentage),
        toInt(config.defaultBankCharge ? 2 : 0),
        toInt(config.defaultBankCharge),
        toInt(config.earlyRepaymentPenalty),
        toInt(config.minLoanAmount),
        toInt(config.maxLoanAmount),
        toInt(config.longTermMaxRepaymentMonths),
        escapeString(config.interestCalculationMode),
        toTimestamp(config.$createdAt),
      ])
    );
  }

  // interest_allocations
  const allocations = await loadCollection('interest_allocations');
  for (const row of allocations) {
    const { year, month } = parseYearMonth(row.month);
    push(
      buildInsert('interest_allocations', [
        'id',
        'member_id',
        'loan_interest',
        'unit_trust_interest',
        'total_interest',
        'period_month',
        'period_year',
        'created_at',
      ], [
        escapeString(row.$id),
        escapeString(row.memberId),
        toInt(row.loanInterest),
        toInt(row.unitTrustInterest),
        toInt(row.totalInterest),
        toInt(month),
        toInt(year),
        toTimestamp(row.createdAt),
      ])
    );
  }

  output.push('COMMIT;');

  const outFile = path.join(OUT_DIR, 'd1-import.sql');
  await fs.writeFile(outFile, output.join('\n') + '\n', 'utf8');
  console.log(`Generated D1 import SQL: ${outFile}`);
};

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
