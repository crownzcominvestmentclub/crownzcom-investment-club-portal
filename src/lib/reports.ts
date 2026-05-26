import type {
  Expense,
  InterestAllocation,
  InterestMonthly,
  LedgerEntry,
  Loan,
  LoanRepayment,
  Member,
  RetainedEarnings,
  Savings,
  Subscription,
  UnitTrust,
} from "@/lib/types";
import { formatMonth, formatUGX } from "@/lib/format";
import {
  calculateOutstandingLoans,
  calculateTotalSavings,
  getActiveLoanCount,
} from "@/lib/calculations";

export type ReportCell = string | number | boolean | null | undefined;
export type ReportRows = ReportCell[][];

/**
 * Reusable report dataset helpers for consistent export data across admin/member reports
 */

export interface ReportDatasets {
  members: Member[];
  savings: Savings[];
  loans: Loan[];
  expenses: Expense[];
  subscriptions: Subscription[];
  unitTrust: UnitTrust[];
  ledger: LedgerEntry[];
  interest: InterestMonthly[];
  retainedEarnings: RetainedEarnings[];
}

export interface AgmMonthlyPerformanceRow {
  month: string;
  savingsAdded: number;
  trustInterest: number;
  loanInterest: number;
  accruedInterest: number;
  retained: number;
  distributed: number;
  trustNetMovement: number;
  closingTrustPosition: number;
}

export interface AgmSnapshot {
  generatedAt: string;
  overview: {
    totalMembers: number;
    activeMembers: number;
    totalSavings: number;
    loanPortfolioIssued: number;
    outstandingLoans: number;
    subscriptionsCollected: number;
    operatingExpenses: number;
    unitTrustBalance: number;
    bankBalance: number;
    combinedClubPosition: number;
  };
  interestSummary: {
    trustInterestEarned: number;
    loanInterestEarned: number;
    accruedInterest: number;
    retainedTotal: number;
    distributedTotal: number;
  };
  monthlyPerformance: AgmMonthlyPerformanceRow[];
  projections: {
    basedOnMonths: number;
    annualSavingsAdded: number;
    annualTrustInterest: number;
  };
}

export function prepareMemberReportData(members: Member[], savings: Savings[], loans: Loan[]): ReportRows {
  const headers = ["Member ID", "Name", "Email", "Status", "Join Date", "Total Savings", "Active Loans", "Outstanding Amount"];
  const savingsByMember = new Map<string, Savings[]>();
  const loansByMember = new Map<string, Loan[]>();

  for (const saving of savings) {
    const current = savingsByMember.get(saving.memberId) ?? [];
    current.push(saving);
    savingsByMember.set(saving.memberId, current);
  }

  for (const loan of loans) {
    const current = loansByMember.get(loan.memberId) ?? [];
    current.push(loan);
    loansByMember.set(loan.memberId, current);
  }

  const rows = members.map((member) => {
    const memberSavings = savingsByMember.get(member.id) ?? [];
    const memberLoans = loansByMember.get(member.id) ?? [];
    const totalSavings = calculateTotalSavings(memberSavings);
    const activeLoans = getActiveLoanCount(memberLoans);
    const outstanding = calculateOutstandingLoans(memberLoans);

    return [
      member.id,
      member.name,
      member.email,
      member.status,
      member.joinDate,
      totalSavings,
      activeLoans,
      outstanding,
    ];
  });

  return [headers, ...rows];
}

export function prepareSavingsReportData(members: Member[], savings: Savings[]): ReportRows {
  const headers = ["Member Name", "Period", "Amount", "Created At"];
  const membersById = new Map(members.map((member) => [member.id, member.name]));

  const rows = savings.map((saving) => [
    membersById.get(saving.memberId) ?? saving.memberId,
    saving.month,
    saving.amount,
    saving.createdAt,
  ]).sort((a, b) => String(b[3]).localeCompare(String(a[3])));

  return [headers, ...rows];
}

export function prepareLoansReportData(members: Member[], loans: Loan[]): ReportRows {
  const headers = ["Member Name", "Loan Type", "Amount", "Balance", "Status", "Applied Date", "Approved Date"];
  const membersById = new Map(members.map((member) => [member.id, member.name]));

  const rows = loans.map((loan) => [
    membersById.get(loan.memberId) ?? loan.memberId,
    loan.loanType,
    loan.amount,
    loan.balance,
    loan.status,
    loan.createdAt,
    loan.approvedAt ?? "",
  ]).sort((a, b) => String(b[5]).localeCompare(String(a[5])));

  return [headers, ...rows];
}

export function prepareExpensesReportData(expenses: Expense[]): ReportRows {
  const headers = ["Description", "Category", "Amount", "Date"];

  const rows = expenses.map((expense) => [
    expense.description,
    expense.category,
    expense.amount,
    expense.date,
  ]).sort((a, b) => String(b[3]).localeCompare(String(a[3])));

  return [headers, ...rows];
}

export function prepareSubscriptionsReportData(members: Member[], subscriptions: Subscription[]): ReportRows {
  const headers = ["Member Name", "Period Year", "Amount", "Status", "Paid At"];
  const membersById = new Map(members.map((member) => [member.id, member.name]));

  const rows = subscriptions.map((subscription) => [
    membersById.get(subscription.memberId) ?? subscription.memberId,
    subscription.month.slice(0, 4),
    subscription.amount,
    subscription.status ?? "paid",
    subscription.paidAt ?? subscription.createdAt,
  ]).sort((a, b) => String(b[4]).localeCompare(String(a[4])));

  return [headers, ...rows];
}

export function prepareUnitTrustReportData(unitTrust: UnitTrust[]): ReportRows {
  const headers = ["Type", "Amount", "Description", "Date"];

  const rows = unitTrust.map((entry) => [
    entry.type,
    entry.amount,
    entry.description ?? "",
    entry.date,
  ]).sort((a, b) => String(b[3]).localeCompare(String(a[3])));

  return [headers, ...rows];
}

export function prepareLedgerReportData(ledger: LedgerEntry[]): ReportRows {
  const headers = ["Type", "Amount", "Month", "Year", "Notes", "Recorded At"];

  const rows = ledger.map((entry) => [
    entry.type,
    entry.amount,
    entry.month,
    entry.year,
    entry.notes,
    entry.createdAt,
  ]).sort((a, b) => String(b[5]).localeCompare(String(a[5])));

  return [headers, ...rows];
}

export function prepareInterestReportData(interest: InterestMonthly[]): ReportRows {
  const headers = ["Month", "Loan Interest", "Trust Interest", "Total Interest"];

  const rows = interest.map((entry) => [
    entry.month,
    entry.loanInterestTotal,
    entry.trustInterestTotal,
    entry.loanInterestTotal + entry.trustInterestTotal,
  ]).sort((a, b) => String(b[0]).localeCompare(String(a[0])));

  return [headers, ...rows];
}

export function prepareRetainedEarningsReportData(retained: RetainedEarnings[]): ReportRows {
  const headers = ["Month", "Source", "Gross Interest", "Retention %", "Retained Amount", "Distributed Amount", "Recorded At", "Notes"];

  const rows = retained.map((entry) => [
    entry.month,
    entry.source,
    entry.grossInterest,
    entry.retentionPercentage,
    entry.retainedAmount,
    entry.distributedAmount,
    entry.createdAt,
    entry.notes ?? "",
  ]).sort((a, b) => String(b[0]).localeCompare(String(a[0])));

  return [headers, ...rows];
}

export interface AgmOptions {
  bankBalance?: number;
}

function getUnitTrustAmount(entry: UnitTrust) {
  return Number(entry.amountFloat ?? entry.amount ?? 0) || 0;
}

export function buildAgmSnapshot({
  members,
  savings,
  loans,
  subscriptions,
  expenses,
  unitTrust,
  interest,
  retainedEarnings,
}: ReportDatasets, options: AgmOptions = {}): AgmSnapshot {
  const activeMembers = members.filter((member) => member.status === "active").length;
  const totalMembers = members.length;
  const totalSavings = savings.reduce((sum, saving) => sum + saving.amount, 0);
  const loanPortfolioIssued = loans.reduce((sum, loan) => sum + loan.amount, 0);
  const outstanding = loans.filter((loan) => loan.status === "active").reduce((sum, loan) => sum + loan.balance, 0);
  const subscriptionsCollected = subscriptions.reduce((sum, subscription) => sum + subscription.amount, 0);
  const expensesTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const unitTrustBalance = unitTrust.reduce((sum, entry) => sum + (entry.type === "withdrawal" ? -getUnitTrustAmount(entry) : getUnitTrustAmount(entry)), 0);
  const bankBalance = Number(options.bankBalance ?? 0) || 0;
  const combinedClubPosition = unitTrustBalance + bankBalance;

  const savingsByMonth = new Map<string, number>();
  savings.forEach((saving) => {
    savingsByMonth.set(saving.month, (savingsByMonth.get(saving.month) ?? 0) + saving.amount);
  });

  const interestByMonth = new Map<string, { trust: number; loan: number }>();
  unitTrust
    .filter((entry) => entry.type === "interest")
    .forEach((entry) => {
      const key = String(entry.date).slice(0, 7);
      const current = interestByMonth.get(key) ?? { trust: 0, loan: 0 };
      current.trust += getUnitTrustAmount(entry);
      interestByMonth.set(key, current);
    });

  loans.forEach((loan) => {
    (loan.repaymentPlan ?? []).forEach((item) => {
      if (!item.paidAt && !item.paymentId) return;
      const key = String(item.paidAt ?? item.month).slice(0, 7);
      const current = interestByMonth.get(key) ?? { trust: 0, loan: 0 };
      current.loan += Number(item.interest ?? 0) || 0;
      interestByMonth.set(key, current);
    });
  });

  const trustMovementByMonth = new Map<string, number>();
  unitTrust.forEach((entry) => {
    const key = String(entry.date).slice(0, 7);
    const signedAmount = entry.type === "withdrawal" ? -getUnitTrustAmount(entry) : getUnitTrustAmount(entry);
    trustMovementByMonth.set(key, (trustMovementByMonth.get(key) ?? 0) + signedAmount);
  });

  const retainedByMonth = new Map<string, { retained: number; distributed: number }>();
  retainedEarnings.forEach((entry) => {
    const key = `${entry.year}-${String(entry.month).padStart(2, "0")}`;
    const current = retainedByMonth.get(key) ?? { retained: 0, distributed: 0 };
    current.retained += entry.retainedAmount;
    current.distributed += entry.distributedAmount;
    retainedByMonth.set(key, current);
  });

  const monthKeys = Array.from(
    new Set([
      ...Array.from(savingsByMonth.keys()),
      ...Array.from(interestByMonth.keys()),
      ...Array.from(retainedByMonth.keys()),
      ...Array.from(trustMovementByMonth.keys()),
    ]),
  ).sort((a, b) => a.localeCompare(b));

  let runningTrustPosition = 0;
  const monthlyRows = monthKeys.map((month) => {
    const savingsAdded = savingsByMonth.get(month) ?? 0;
    const interestEntry = interestByMonth.get(month) ?? { trust: 0, loan: 0 };
    const retainedEntry = retainedByMonth.get(month) ?? { retained: 0, distributed: 0 };
    const accruedInterest = interestEntry.trust + interestEntry.loan;
    const trustNetMovement = trustMovementByMonth.get(month) ?? 0;
    runningTrustPosition += trustNetMovement;

    return {
      month,
      savingsAdded,
      trustInterest: interestEntry.trust,
      loanInterest: interestEntry.loan,
      accruedInterest,
      retained: retainedEntry.retained,
      distributed: retainedEntry.distributed,
      trustNetMovement,
      closingTrustPosition: runningTrustPosition,
    };
  });

  const totals = monthlyRows.reduce(
    (sum, row) => ({
      savingsAdded: sum.savingsAdded + row.savingsAdded,
      trustInterest: sum.trustInterest + row.trustInterest,
      loanInterest: sum.loanInterest + row.loanInterest,
      accruedInterest: sum.accruedInterest + row.accruedInterest,
      retained: sum.retained + row.retained,
      distributed: sum.distributed + row.distributed,
      trustNetMovement: sum.trustNetMovement + row.trustNetMovement,
    }),
    {
      savingsAdded: 0,
      trustInterest: 0,
      loanInterest: 0,
      accruedInterest: 0,
      retained: 0,
      distributed: 0,
      trustNetMovement: 0,
    },
  );

  const projectionBaseRows = monthlyRows.slice(-12);
  const projectionBaseMonths = projectionBaseRows.length;
  const projectionTotals = projectionBaseRows.reduce(
    (sum, row) => ({
      savingsAdded: sum.savingsAdded + row.savingsAdded,
      trustInterest: sum.trustInterest + row.trustInterest,
    }),
    {
      savingsAdded: 0,
      trustInterest: 0,
    },
  );
  const projectionDivisor = Math.max(projectionBaseMonths, 1);

  return {
    generatedAt: new Date().toLocaleString(),
    overview: {
      totalMembers,
      activeMembers,
      totalSavings,
      loanPortfolioIssued,
      outstandingLoans: outstanding,
      subscriptionsCollected,
      operatingExpenses: expensesTotal,
      unitTrustBalance,
      bankBalance,
      combinedClubPosition,
    },
    interestSummary: {
      trustInterestEarned: totals.trustInterest,
      loanInterestEarned: totals.loanInterest,
      accruedInterest: totals.accruedInterest,
      retainedTotal: totals.retained,
      distributedTotal: totals.distributed,
    },
    monthlyPerformance: monthlyRows,
    projections: {
      basedOnMonths: projectionBaseMonths,
      annualSavingsAdded: Math.round(projectionTotals.savingsAdded / projectionDivisor) * 12,
      annualTrustInterest: Math.round(((projectionTotals.trustInterest / projectionDivisor) * 12) * 100) / 100,
    },
  };
}

export function prepareAgmReportData(datasets: ReportDatasets, options: AgmOptions = {}): ReportRows {
  const snapshot = buildAgmSnapshot(datasets, options);
  return [
    ["Section", "Metric", "Value", "Notes"],
    ["Overview", "Total members", snapshot.overview.totalMembers, ""],
    ["Overview", "Active members", snapshot.overview.activeMembers, ""],
    ["Overview", "Total savings", snapshot.overview.totalSavings, ""],
    ["Overview", "Loan portfolio issued", snapshot.overview.loanPortfolioIssued, ""],
    ["Overview", "Outstanding loans", snapshot.overview.outstandingLoans, ""],
    ["Overview", "Subscriptions collected", snapshot.overview.subscriptionsCollected, ""],
    ["Overview", "Operating expenses", snapshot.overview.operatingExpenses, ""],
    ["Overview", "Unit trust balance", snapshot.overview.unitTrustBalance, ""],
    ["Overview", "Bank balance", snapshot.overview.bankBalance, "Manual AGM input"],
    ["Overview", "Combined club position", snapshot.overview.combinedClubPosition, "Unit trust balance + bank balance"],
    ["Interest", "Trust interest earned", snapshot.interestSummary.trustInterestEarned, ""],
    ["Interest", "Loan interest earned", snapshot.interestSummary.loanInterestEarned, ""],
    ["Interest", "Accrued interest", snapshot.interestSummary.accruedInterest, ""],
    ["Interest", "Retained total", snapshot.interestSummary.retainedTotal, ""],
    ["Interest", "Distributed total", snapshot.interestSummary.distributedTotal, ""],
    ...snapshot.monthlyPerformance.map((row) => [
      "Monthly performance",
      formatMonth(row.month),
      `${formatUGX(row.savingsAdded)} savings, ${formatUGX(row.trustInterest)} trust interest, ${formatUGX(row.loanInterest)} loan interest, ${formatUGX(row.retained)} retained, ${formatUGX(row.distributed)} distributed`,
      `Closing trust position ${formatUGX(row.closingTrustPosition)}`,
    ]),
    ["Projection", "12-month savings added", snapshot.projections.annualSavingsAdded, ""],
    ["Projection", "12-month trust interest", snapshot.projections.annualTrustInterest, ""],
    ["Projection", "Projection basis", `Based on the most recent ${snapshot.projections.basedOnMonths} recorded month(s) of savings and trust interest`, ""],
  ];
}

export function prepareMemberSummaryReportData({
  memberName,
  savings,
  loans,
  repayments,
  subscriptions,
}: {
  memberName: string;
  savings: Savings[];
  loans: Loan[];
  repayments: LoanRepayment[];
  subscriptions: Subscription[];
}): ReportRows {
  const totalSavings = savings.reduce((sum, saving) => sum + saving.amount, 0);
  const totalOutstanding = loans.filter((loan) => loan.status === "active").reduce((sum, loan) => sum + loan.balance, 0);
  const totalRepaid = repayments.reduce((sum, repayment) => sum + repayment.amount, 0);
  const totalSubscriptions = subscriptions.reduce((sum, subscription) => sum + subscription.amount, 0);

  return [
    ["Metric", "Value"],
    ["Member", memberName],
    ["Savings records", savings.length],
    ["Total savings", totalSavings],
    ["Loans submitted", loans.length],
    ["Active loans", loans.filter((loan) => loan.status === "active").length],
    ["Outstanding loans", totalOutstanding],
    ["Repayments recorded", repayments.length],
    ["Total repaid", totalRepaid],
    ["Subscriptions paid", totalSubscriptions],
  ];
}

export function prepareMemberRepaymentsReportData(loans: Loan[], repayments: LoanRepayment[]): ReportRows {
  const loanTypeById = new Map(loans.map((loan) => [loan.id, loan.loanType]));

  return [
    ["Loan ID", "Loan Type", "Month", "Amount", "Paid At", "Status"],
    ...repayments
      .map((repayment) => [
        repayment.loanId,
        loanTypeById.get(repayment.loanId) ?? "",
        repayment.month,
        repayment.amount,
        repayment.paidAt,
        repayment.paymentStatus,
      ])
      .sort((a, b) => String(b[4]).localeCompare(String(a[4]))),
  ];
}

export function prepareInterestDistributionReportData(allocations: InterestAllocation[]): ReportRows {
  return [
    ["Month", "Loan Interest", "Trust Interest", "Total Interest", "Recorded At"],
    ...allocations
      .map((entry) => [
        entry.month,
        entry.loanInterest,
        entry.trustInterest,
        entry.totalInterest,
        entry.createdAt,
      ])
      .sort((a, b) => String(b[4]).localeCompare(String(a[4]))),
  ];
}

export function buildMemberStatementLines({
  memberName,
  savings,
  loans,
  repayments,
  subscriptions,
}: {
  memberName: string;
  savings: Savings[];
  loans: Loan[];
  repayments: LoanRepayment[];
  subscriptions: Subscription[];
}) {
  const lines: string[] = [];
  lines.push(`Member statement for ${memberName}`);
  lines.push(`Generated ${new Date().toLocaleString()}`);
  lines.push("");
  lines.push("=== Savings ===");
  lines.push("Month,Amount (UGX)");
  savings.forEach((saving) => lines.push(`${saving.month},${saving.amount}`));
  lines.push("");
  lines.push("=== Loans ===");
  lines.push("Type,Amount,Balance,Status,Submitted");
  loans.forEach((loan) => lines.push(`${loan.loanType},${loan.amount},${loan.balance},${loan.status},${loan.createdAt}`));
  lines.push("");
  lines.push("=== Repayments ===");
  lines.push("LoanId,Month,Amount,Paid");
  repayments.forEach((repayment) => lines.push(`${repayment.loanId},${repayment.month},${repayment.amount},${repayment.paidAt}`));
  lines.push("");
  lines.push("=== Subscriptions ===");
  lines.push("Year,Amount,Status,Paid At");
  subscriptions.forEach((subscription) =>
    lines.push(
      `${subscription.month.slice(0, 4)},${subscription.amount},${subscription.status ?? "paid"},${subscription.paidAt ?? subscription.createdAt}`
    )
  );
  return lines;
}

export function downloadCsvReport(filename: string, rows: ReportRows) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  downloadBlob(filename, new Blob([csv], { type: "text/csv;charset=utf-8;" }));
}

export function downloadPdfReport(filename: string, title: string, rows: ReportRows) {
  const blob = buildTablePdfBlob(title, rows);
  downloadBlob(filename, blob);
}

export function downloadAgmPdfReport(filename: string, title: string, snapshot: AgmSnapshot) {
  const blob = buildAgmPdfBlob(title, snapshot);
  downloadBlob(filename, blob);
}

function formatReportCell(cell: ReportCell) {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") return cell.toLocaleString("en-US");
  return String(cell);
}

function buildTablePdfBlob(title: string, rows: ReportRows) {
  const header = (rows[0] ?? []).map(formatReportCell);
  const body = rows.slice(1).map((row) => row.map(formatReportCell));
  const landscape = header.length > 5;
  const pageWidth = landscape ? 842 : 595;
  const pageHeight = landscape ? 595 : 842;
  const marginX = 32;
  const marginTop = 40;
  const marginBottom = 32;
  const titleFontSize = 18;
  const subtitleFontSize = 10;
  const tableFontSize = header.length > 6 ? 8 : 9;
  const lineHeight = tableFontSize + 4;
  const cellPadding = 4;
  const tableTop = marginTop + 44;
  const tableWidth = pageWidth - marginX * 2;
  const availableHeight = pageHeight - tableTop - marginBottom;

  const allRows = [header, ...body];
  const colWidths = calculateColumnWidths(allRows, tableWidth, tableFontSize);
  const wrappedRows = allRows.map((row) => wrapRow(row, colWidths, tableFontSize));

  const pageRows: Array<typeof wrappedRows> = [];
  let currentPage: typeof wrappedRows = [wrappedRows[0]];
  let usedHeight = rowHeightFor(wrappedRows[0], lineHeight, cellPadding);
  for (const row of wrappedRows.slice(1)) {
    const height = rowHeightFor(row, lineHeight, cellPadding);
    if (usedHeight + height > availableHeight && currentPage.length > 1) {
      pageRows.push(currentPage);
      currentPage = [wrappedRows[0], row];
      usedHeight = rowHeightFor(wrappedRows[0], lineHeight, cellPadding) + height;
    } else {
      currentPage.push(row);
      usedHeight += height;
    }
  }
  if (currentPage.length > 0) pageRows.push(currentPage);

  const objects: string[] = [];
  const addObject = (content: string) => {
    objects.push(content);
    return objects.length;
  };

  const regularFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const boldFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  const contentIds: number[] = [];
  const pageIds: number[] = [];
  pageRows.forEach((rowsForPage, pageIndex) => {
    const stream = buildPdfTableContentStream({
      title,
      generatedAt: new Date().toLocaleString(),
      rows: rowsForPage,
      colWidths,
      pageWidth,
      pageHeight,
      marginX,
      marginTop,
      tableTop,
      titleFontSize,
      subtitleFontSize,
      tableFontSize,
      lineHeight,
      cellPadding,
      pageIndex,
    });
    contentIds.push(addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
    pageIds.push(0);
  });

  const pagesId = addObject("<< /Type /Pages /Kids [] /Count 0 >>");
  pageRows.forEach((_, index) => {
    pageIds[index] = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentIds[index]} 0 R /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> >>`,
    );
  });

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new Blob([pdf], { type: "application/pdf" });
}

function buildAgmPdfBlob(title: string, snapshot: AgmSnapshot) {
  const pageWidth = 842;
  const pageHeight = 595;
  const marginX = 32;
  const marginTop = 34;
  const marginBottom = 28;
  const titleFontSize = 18;
  const subtitleFontSize = 10;
  const bodyFontSize = 9;
  const lineHeight = 13;
  const cellPadding = 4;
  const summaryRows = [
    ["Total members", formatUGX(snapshot.overview.totalMembers)],
    ["Active members", formatUGX(snapshot.overview.activeMembers)],
    ["Total savings", formatUGX(snapshot.overview.totalSavings)],
    ["Loan portfolio issued", formatUGX(snapshot.overview.loanPortfolioIssued)],
    ["Outstanding loans", formatUGX(snapshot.overview.outstandingLoans)],
    ["Subscriptions collected", formatUGX(snapshot.overview.subscriptionsCollected)],
    ["Operating expenses", formatUGX(snapshot.overview.operatingExpenses)],
    ["Unit trust balance", formatUGX(snapshot.overview.unitTrustBalance)],
    ["Bank balance", formatUGX(snapshot.overview.bankBalance)],
    ["Combined club position", formatUGX(snapshot.overview.combinedClubPosition)],
  ];

  const interestRows = [
    ["Trust interest earned", formatUGX(snapshot.interestSummary.trustInterestEarned)],
    ["Loan interest earned", formatUGX(snapshot.interestSummary.loanInterestEarned)],
    ["Accrued interest", formatUGX(snapshot.interestSummary.accruedInterest)],
    ["Retained", formatUGX(snapshot.interestSummary.retainedTotal)],
    ["Distributed", formatUGX(snapshot.interestSummary.distributedTotal)],
  ];
  const monthlyRows = [
    ["Period", "Savings", "Trust Int.", "Loan Int.", "Accrued", "Retained", "Distributed", "Closing Trust"],
    ...snapshot.monthlyPerformance.map((row) => [
      formatMonth(row.month),
      formatUGX(row.savingsAdded),
      formatUGX(row.trustInterest),
      formatUGX(row.loanInterest),
      formatUGX(row.accruedInterest),
      formatUGX(row.retained),
      formatUGX(row.distributed),
      formatUGX(row.closingTrustPosition),
    ]),
  ];
  const projectionNote = `Projection: The next 12 months are projected from the most recent ${snapshot.projections.basedOnMonths} recorded month(s) only. We take the average monthly savings added and the average monthly trust interest from that period, then annualise those averages. This gives projected savings added of ${formatUGX(snapshot.projections.annualSavingsAdded)} and projected trust interest of ${formatUGX(snapshot.projections.annualTrustInterest)}. Loan interest is not projected here because future borrowing is uncertain.`;
  const colWidths = calculateColumnWidths(monthlyRows, pageWidth - marginX * 2, bodyFontSize);
  const wrappedRows = monthlyRows.map((row) => wrapRow(row, colWidths, bodyFontSize));
  const headerRow = wrappedRows[0];
  const bodyRows = wrappedRows.slice(1);

  const pageStreams: string[] = [];
  const createPageContext = () => {
    const commands: string[] = [];
    const drawText = (text: string, x: number, y: number, font: "F1" | "F2", size: number) => {
      commands.push("BT");
      commands.push(`/${font} ${size} Tf`);
      commands.push(`${x.toFixed(2)} ${y.toFixed(2)} Td`);
      commands.push(`(${escapePdfText(text)}) Tj`);
      commands.push("ET");
    };
    const drawLine = (x1: number, y1: number, x2: number, y2: number, width = 0.8) => {
      commands.push(`${width} w`);
      commands.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    };
    const drawRect = (x: number, y: number, width: number, height: number, gray = 0.95) => {
      drawFilledRect(commands, x, y, width, height, gray);
    };
    return { commands, drawText, drawLine, drawRect };
  };

  const firstPage = createPageContext();
  firstPage.drawRect(marginX, pageHeight - marginTop - 28, pageWidth - marginX * 2, 34, 0.94);
  firstPage.drawText(title, marginX, pageHeight - marginTop, "F2", titleFontSize);
  firstPage.drawText("Crownzcom Investment Club", marginX, pageHeight - marginTop - 16, "F1", subtitleFontSize);
  firstPage.drawText(`Generated ${snapshot.generatedAt}`, marginX + 170, pageHeight - marginTop - 16, "F1", subtitleFontSize);

  let y = pageHeight - marginTop - 42;
  firstPage.drawText("Executive summary", marginX, y, "F2", 12);
  y -= 12;
  y = drawTwoColumnTable(firstPage.commands, summaryRows, marginX, y, 360, bodyFontSize, lineHeight, cellPadding, firstPage.drawLine, firstPage.drawText, firstPage.drawRect);
  firstPage.drawText("Interest summary", 430, pageHeight - marginTop - 42, "F2", 12);
  drawTwoColumnTable(firstPage.commands, interestRows, 430, pageHeight - marginTop - 54, 380, bodyFontSize, lineHeight, cellPadding, firstPage.drawLine, firstPage.drawText, firstPage.drawRect);

  y -= 24;
  firstPage.drawText("Monthly performance", marginX, y, "F2", 12);
  y -= 12;
  const availableFirstPage = y - marginBottom;

  const wrappedPages: string[][][][] = [];
  let currentPageRows: string[][][] = [headerRow];
  let usedHeight = rowHeightFor(headerRow, lineHeight, cellPadding);
  let availableHeight = availableFirstPage;
  for (const row of bodyRows) {
    const rowHeight = rowHeightFor(row, lineHeight, cellPadding);
    if (usedHeight + rowHeight > availableHeight && currentPageRows.length > 1) {
      wrappedPages.push(currentPageRows);
      currentPageRows = [headerRow, row];
      usedHeight = rowHeightFor(headerRow, lineHeight, cellPadding) + rowHeight;
      availableHeight = pageHeight - (marginTop + 42 + 12 + 12) - marginBottom;
    } else {
      currentPageRows.push(row);
      usedHeight += rowHeight;
    }
  }
  if (currentPageRows.length > 0) wrappedPages.push(currentPageRows);

  drawWrappedGrid(firstPage.commands, wrappedPages[0] ?? [headerRow], marginX, y, colWidths, bodyFontSize, lineHeight, cellPadding, firstPage.drawLine, firstPage.drawText, firstPage.drawRect);
  pageStreams.push(firstPage.commands.join("\n"));

  wrappedPages.slice(1).forEach((pageRows, index) => {
    const page = createPageContext();
    page.drawText(`Page ${index + 2}`, pageWidth - marginX - 34, pageHeight - marginTop - 18, "F1", subtitleFontSize);
    let pageY = pageHeight - marginTop - 42;
    page.drawText("Monthly performance (continued)", marginX, pageY, "F2", 12);
    pageY -= 12;
    drawWrappedGrid(page.commands, pageRows, marginX, pageY, colWidths, bodyFontSize, lineHeight, cellPadding, page.drawLine, page.drawText, page.drawRect);
    pageStreams.push(page.commands.join("\n"));
  });

  const projectionLines = wrapText(projectionNote, pageWidth - marginX * 2, bodyFontSize);
  const projectionHeight = projectionLines.length * lineHeight + 20;
  const lastPageRows = wrappedPages[wrappedPages.length - 1] ?? [headerRow];
  const lastPageTableHeight = lastPageRows.reduce((sum, row) => sum + rowHeightFor(row, lineHeight, cellPadding), 0);
  const lastPageHasSummary = wrappedPages.length === 1;
  const lastPageTableStartY = lastPageHasSummary ? y : pageHeight - marginTop - 54;
  const lastPageBottomY = lastPageTableStartY - lastPageTableHeight;

  if (lastPageBottomY - projectionHeight < marginBottom) {
    const page = createPageContext();
    page.drawText(`Page ${pageStreams.length + 1}`, pageWidth - marginX - 34, pageHeight - marginTop - 18, "F1", subtitleFontSize);
    let pageY = pageHeight - marginTop - 42;
    page.drawText("Projection note", marginX, pageY, "F2", 12);
    pageY -= 18;
    drawParagraph(page.commands, projectionLines, marginX, pageY, bodyFontSize, lineHeight, page.drawText);
    pageStreams.push(page.commands.join("\n"));
  } else {
    const lastStreamCommands = pageStreams[pageStreams.length - 1].split("\n");
    const appendPage = createPageContext();
    appendPage.commands.push(...lastStreamCommands);
    let pageY = lastPageBottomY - 18;
    appendPage.drawText("Projection note", marginX, pageY, "F2", 12);
    pageY -= 18;
    drawParagraph(appendPage.commands, projectionLines, marginX, pageY, bodyFontSize, lineHeight, appendPage.drawText);
    pageStreams[pageStreams.length - 1] = appendPage.commands.join("\n");
  }

  return buildPdfFromPageStreams(pageStreams, pageWidth, pageHeight);
}

function drawTwoColumnTable(
  commands: string[],
  rows: string[][],
  x: number,
  yStart: number,
  width: number,
  fontSize: number,
  lineHeight: number,
  cellPadding: number,
  drawLine: (x1: number, y1: number, x2: number, y2: number, width?: number) => void,
  drawText: (text: string, x: number, y: number, font: "F1" | "F2", size: number) => void,
  drawFilledRectFn?: (x: number, y: number, width: number, height: number, gray?: number) => void,
) {
  const leftWidth = width * 0.58;
  const rightWidth = width - leftWidth;
  let y = yStart;
  rows.forEach((row, index) => {
    const top = y;
    const bottom = y - (lineHeight + cellPadding * 2);
    if (drawFilledRectFn) {
      if (index === 0) {
        drawFilledRectFn(x, bottom, width, lineHeight + cellPadding * 2, 0.93);
      } else if (index % 2 === 0) {
        drawFilledRectFn(x, bottom, width, lineHeight + cellPadding * 2, 0.98);
      }
    }
    drawLine(x, top, x + width, top, index === 0 ? 0.9 : 0.6);
    drawLine(x, bottom, x + width, bottom, 0.6);
    drawLine(x, top, x, bottom, 0.6);
    drawLine(x + leftWidth, top, x + leftWidth, bottom, 0.6);
    drawLine(x + width, top, x + width, bottom, 0.6);
    drawText(row[0], x + cellPadding, top - fontSize - cellPadding + 2, "F1", fontSize);
    drawText(row[1], x + leftWidth + cellPadding, top - fontSize - cellPadding + 2, "F2", fontSize);
    y = bottom;
  });
  return y;
}

function drawSimpleGrid(
  commands: string[],
  rows: string[][],
  x: number,
  yStart: number,
  width: number,
  fontSize: number,
  lineHeight: number,
  cellPadding: number,
  drawLine: (x1: number, y1: number, x2: number, y2: number, width?: number) => void,
  drawText: (text: string, x: number, y: number, font: "F1" | "F2", size: number) => void,
) {
  const colWidths = calculateColumnWidths(rows, width, fontSize);
  const wrappedRows = rows.map((row) => wrapRow(row, colWidths, fontSize));
  let y = yStart;
  wrappedRows.forEach((row, rowIndex) => {
    const rowHeight = rowHeightFor(row, lineHeight, cellPadding);
    const top = y;
    const bottom = y - rowHeight;
    drawLine(x, top, x + width, top, rowIndex === 0 ? 1 : 0.6);
    drawLine(x, bottom, x + width, bottom, 0.6);
    let cursor = x;
    row.forEach((cell, cellIndex) => {
      drawLine(cursor, top, cursor, bottom, 0.6);
      cell.forEach((line, lineIndex) => {
        drawText(
          line,
          cursor + cellPadding,
          top - fontSize - cellPadding - lineIndex * lineHeight + 2,
          rowIndex === 0 || rowIndex === wrappedRows.length - 1 ? "F2" : "F1",
          fontSize,
        );
      });
      cursor += colWidths[cellIndex];
      if (cellIndex === row.length - 1) {
        drawLine(cursor, top, cursor, bottom, 0.6);
      }
    });
    y = bottom;
  });
}

function buildPdfFromCommands(commands: string[], pageWidth: number, pageHeight: number) {
  return buildPdfFromPageStreams([commands.join("\n")], pageWidth, pageHeight);
}

function buildPdfFromPageStreams(streams: string[], pageWidth: number, pageHeight: number) {
  const objects: string[] = [];
  const addObject = (content: string) => {
    objects.push(content);
    return objects.length;
  };
  const regularFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const boldFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const contentIds = streams.map((stream) => addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
  const pagesId = addObject("<< /Type /Pages /Kids [] /Count 0 >>");
  const pageIds = contentIds.map((contentId) =>
    addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> >>`,
    ),
  );
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((pageId) => `${pageId} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function drawWrappedGrid(
  commands: string[],
  wrappedRows: string[][][],
  x: number,
  yStart: number,
  colWidths: number[],
  fontSize: number,
  lineHeight: number,
  cellPadding: number,
  drawLine: (x1: number, y1: number, x2: number, y2: number, width?: number) => void,
  drawText: (text: string, x: number, y: number, font: "F1" | "F2", size: number) => void,
  drawFilledRect?: (x: number, y: number, width: number, height: number, gray?: number) => void,
) {
  const width = colWidths.reduce((sum, colWidth) => sum + colWidth, 0);
  let y = yStart;
  wrappedRows.forEach((row, rowIndex) => {
    const rowHeight = rowHeightFor(row, lineHeight, cellPadding);
    const top = y;
    const bottom = y - rowHeight;
    if (drawFilledRect) {
      if (rowIndex === 0) {
        drawFilledRect(x, bottom, width, rowHeight, 0.93);
      } else if (rowIndex % 2 === 0) {
        drawFilledRect(x, bottom, width, rowHeight, 0.975);
      }
    }
    drawLine(x, top, x + width, top, rowIndex === 0 ? 1 : 0.6);
    drawLine(x, bottom, x + width, bottom, 0.6);
    let cursor = x;
    row.forEach((cell, cellIndex) => {
      drawLine(cursor, top, cursor, bottom, 0.6);
      cell.forEach((line, lineIndex) => {
        drawText(
          line,
          cursor + cellPadding,
          top - fontSize - cellPadding - lineIndex * lineHeight + 2,
          rowIndex === 0 ? "F2" : "F1",
          fontSize,
        );
      });
      cursor += colWidths[cellIndex];
      if (cellIndex === row.length - 1) {
        drawLine(cursor, top, cursor, bottom, 0.6);
      }
    });
    y = bottom;
  });
}

function drawParagraph(
  commands: string[],
  lines: string[],
  x: number,
  yStart: number,
  fontSize: number,
  lineHeight: number,
  drawText: (text: string, x: number, y: number, font: "F1" | "F2", size: number) => void,
) {
  lines.forEach((line, index) => {
    drawText(line, x, yStart - index * lineHeight, "F1", fontSize);
  });
}

function drawFilledRect(
  commands: string[],
  x: number,
  y: number,
  width: number,
  height: number,
  gray = 0.95,
) {
  commands.push(`${gray.toFixed(3)} g`);
  commands.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
  commands.push("0 g");
}

function calculateColumnWidths(rows: string[][], tableWidth: number, fontSize: number) {
  const colCount = rows[0]?.length ?? 0;
  const weights = Array.from({ length: colCount }, (_, colIndex) => {
    const longest = Math.max(
      ...rows.map((row) => Math.min((row[colIndex] ?? "").length, 36)),
      8,
    );
    return Math.max(longest * fontSize * 0.5, 54);
  });
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  return weights.map((value) => (value / total) * tableWidth);
}

function wrapRow(row: string[], colWidths: number[], fontSize: number) {
  return row.map((cell, index) => wrapText(cell, colWidths[index] - 8, fontSize));
}

function wrapText(text: string, width: number, fontSize: number) {
  const safe = text.trim() || "";
  if (!safe) return [""];
  const approxChars = Math.max(4, Math.floor(width / (fontSize * 0.52)));
  const words = safe.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= approxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    if (word.length <= approxChars) {
      current = word;
      continue;
    }
    for (let i = 0; i < word.length; i += approxChars) {
      const chunk = word.slice(i, i + approxChars);
      if (i + approxChars >= word.length) {
        current = chunk;
      } else {
        lines.push(chunk);
      }
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [safe];
}

function rowHeightFor(row: string[][], lineHeight: number, cellPadding: number) {
  const maxLines = Math.max(...row.map((cell) => cell.length), 1);
  return maxLines * lineHeight + cellPadding * 2;
}

function buildPdfTableContentStream({
  title,
  generatedAt,
  rows,
  colWidths,
  pageWidth,
  pageHeight,
  marginX,
  marginTop,
  tableTop,
  titleFontSize,
  subtitleFontSize,
  tableFontSize,
  lineHeight,
  cellPadding,
  pageIndex,
}: {
  title: string;
  generatedAt: string;
  rows: string[][][];
  colWidths: number[];
  pageWidth: number;
  pageHeight: number;
  marginX: number;
  marginTop: number;
  tableTop: number;
  titleFontSize: number;
  subtitleFontSize: number;
  tableFontSize: number;
  lineHeight: number;
  cellPadding: number;
  pageIndex: number;
}) {
  const commands: string[] = [];
  const drawText = (text: string, x: number, y: number, font: "F1" | "F2", size: number) => {
    commands.push("BT");
    commands.push(`/${font} ${size} Tf`);
    commands.push(`${x.toFixed(2)} ${y.toFixed(2)} Td`);
    commands.push(`(${escapePdfText(text)}) Tj`);
    commands.push("ET");
  };
  const drawLine = (x1: number, y1: number, x2: number, y2: number, width = 0.8) => {
    commands.push(`${width} w`);
    commands.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  };
  const drawRect = (x: number, y: number, width: number, height: number, gray = 0.95) => {
    drawFilledRect(commands, x, y, width, height, gray);
  };

  drawRect(marginX, pageHeight - marginTop - 28, pageWidth - marginX * 2, 34, 0.94);
  drawRect(marginX, 18, pageWidth - marginX * 2, 14, 0.96);

  drawText(title, marginX, pageHeight - marginTop, "F2", titleFontSize);
  drawText("Crownzcom Investment Club", marginX, pageHeight - marginTop - 16, "F1", subtitleFontSize);
  drawText(`Generated ${generatedAt}`, marginX + 170, pageHeight - marginTop - 16, "F1", subtitleFontSize);
  drawText(`Page ${pageIndex + 1}`, pageWidth - marginX - 40, pageHeight - marginTop - 16, "F1", subtitleFontSize);
  drawText("Prepared from live Worker-backed report data", marginX, 26, "F1", 8);

  let y = pageHeight - tableTop;
  const tableWidth = colWidths.reduce((sum, width) => sum + width, 0);

  rows.forEach((row, rowIndex) => {
    const rowHeight = rowHeightFor(row, lineHeight, cellPadding);
    const top = y;
    const bottom = y - rowHeight;
    if (rowIndex === 0) {
      drawRect(marginX, bottom, tableWidth, rowHeight, 0.93);
    } else if (rowIndex % 2 === 0) {
      drawRect(marginX, bottom, tableWidth, rowHeight, 0.98);
    }

    drawLine(marginX, top, marginX + tableWidth, top, rowIndex === 0 ? 1.1 : 0.7);
    drawLine(marginX, bottom, marginX + tableWidth, bottom, 0.7);

    let x = marginX;
    row.forEach((cellLines, cellIndex) => {
      drawLine(x, top, x, bottom, 0.7);
      const font = rowIndex === 0 ? "F2" : "F1";
      cellLines.forEach((line, lineIndex) => {
        drawText(line, x + cellPadding, top - cellPadding - tableFontSize - lineIndex * lineHeight + 2, font, tableFontSize);
      });
      x += colWidths[cellIndex];
      if (cellIndex === row.length - 1) {
        drawLine(x, top, x, bottom, 0.7);
      }
    });

    y = bottom;
  });

  return commands.join("\n");
}

function escapePdfText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, "?");
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
