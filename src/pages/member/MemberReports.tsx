import { useMemo } from "react";
import { Download, FileText, Wallet, Banknote, Receipt, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import {
  useInterestAllocations,
  useLoanRepayments,
  useLoansByMember,
  useSavingsByMember,
  useSubscriptions,
} from "@/hooks/data";
import { formatDate, formatMonth, formatUGX } from "@/lib/format";
import {
  downloadCsvReport,
  downloadPdfReport,
  prepareInterestDistributionReportData,
  prepareLoansReportData,
  prepareMemberRepaymentsReportData,
  prepareMemberSummaryReportData,
  prepareSavingsReportData,
} from "@/lib/reports";
import type { LoanStatus } from "@/lib/types";

export default function MemberReports() {
  const { user } = useAuth();
  const memberId = user?.memberId;

  const savings = useSavingsByMember(memberId);
  const loans = useLoansByMember(memberId);
  const repayments = useLoanRepayments();
  const subs = useSubscriptions();
  const interestAllocations = useInterestAllocations(memberId);

  const myLoanIds = useMemo(() => new Set((loans.data ?? []).map((loan) => loan.id)), [loans.data]);
  const myRepayments = useMemo(
    () => (repayments.data ?? []).filter((repayment) => myLoanIds.has(repayment.loanId)).sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt))),
    [repayments.data, myLoanIds],
  );
  const mySubs = useMemo(
    () => (subs.data ?? []).filter((subscription) => subscription.memberId === memberId).sort((a, b) => String(b.month).localeCompare(String(a.month))),
    [subs.data, memberId],
  );

  const totalSavings = savings.data?.reduce((sum, saving) => sum + saving.amount, 0) ?? 0;
  const totalRepaid = myRepayments.reduce((sum, repayment) => sum + repayment.amount, 0);
  const totalSubs = mySubs.reduce((sum, subscription) => sum + subscription.amount, 0);
  const outstanding = (loans.data ?? []).filter((loan) => loan.status === "active").reduce((sum, loan) => sum + loan.balance, 0);

  const datasets = useMemo(() => ({
    summary: prepareMemberSummaryReportData({
      memberName: user?.name ?? "Member",
      savings: savings.data ?? [],
      loans: loans.data ?? [],
      repayments: myRepayments,
      subscriptions: mySubs,
    }),
    savings: prepareSavingsReportData(
      [{ id: memberId ?? "member", name: user?.name ?? "Member", email: user?.email ?? "", membershipNumber: "", joinDate: "", status: "active" }],
      savings.data ?? [],
    ),
    loans: prepareLoansReportData(
      [{ id: memberId ?? "member", name: user?.name ?? "Member", email: user?.email ?? "", membershipNumber: "", joinDate: "", status: "active" }],
      loans.data ?? [],
    ),
    repayments: prepareMemberRepaymentsReportData(loans.data ?? [], myRepayments),
    interestDistribution: prepareInterestDistributionReportData(interestAllocations.data ?? []),
  }), [user?.name, user?.email, memberId, savings.data, loans.data, myRepayments, mySubs, interestAllocations.data]);

  if (!memberId) {
    return (
      <>
        <PageHeader title="My reports" />
        <EmptyState title="No member profile linked" description="An administrator can link your profile from the Members module." />
      </>
    );
  }

  const loading = savings.isLoading || loans.isLoading || repayments.isLoading;
  const hasInterestDistribution = (interestAllocations.data?.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title="My reports"
        description="Download your summary, savings, loans, repayments and interest distribution reports."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total savings" value={formatUGX(totalSavings)} icon={Wallet} accent="primary" loading={loading} />
        <KpiCard label="Loans outstanding" value={formatUGX(outstanding)} icon={Banknote} accent="warning" loading={loading} />
        <KpiCard label="Total repaid" value={formatUGX(totalRepaid)} icon={Receipt} accent="success" loading={loading} hint={`${myRepayments.length} payments`} />
        <KpiCard label="Subscriptions paid" value={formatUGX(totalSubs)} icon={FileText} accent="info" loading={loading} />
      </div>

      <Tabs defaultValue="summary" className="mt-6">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="savings">Savings</TabsTrigger>
          <TabsTrigger value="loans">Loans</TabsTrigger>
          <TabsTrigger value="repayments">Repayments</TabsTrigger>
          <TabsTrigger value="interest">Interest distribution</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4">
          <MemberReportCard
            title="Summary report"
            description="Personal summary across savings, loans, repayments and subscriptions."
            csvName="member-summary-report.csv"
            pdfName="member-summary-report.pdf"
            pdfTitle="Member Summary Report"
            rows={datasets.summary}
          >
            <SimpleTable
              loading={loading}
              headers={["Metric", "Value"]}
              rows={(datasets.summary.slice(1) as string[][]).map((row) => [row[0], String(row[1])])}
              rowCount={6}
              emptyTitle="No summary available"
            />
          </MemberReportCard>
        </TabsContent>

        <TabsContent value="savings" className="mt-4">
          <MemberReportCard
            title="Savings report"
            description="Your recorded savings contribution history."
            csvName="member-savings-report.csv"
            pdfName="member-savings-report.pdf"
            pdfTitle="Member Savings Report"
            rows={datasets.savings}
          >
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Month</th><th className="text-right">Amount</th><th>Recorded</th></tr></thead>
                <tbody>
                  {savings.isLoading && Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 3 }).map((__, j) => <td key={j}><Skeleton className="h-4 w-20" /></td>)}</tr>
                  ))}
                  {!savings.isLoading && [...(savings.data ?? [])].sort((a, b) => String(b.month).localeCompare(String(a.month))).map((saving) => (
                    <tr key={saving.id}>
                      <td>{formatMonth(saving.month)}</td>
                      <td className="text-right font-mono">{formatUGX(saving.amount)}</td>
                      <td className="text-muted-foreground">{formatDate(saving.createdAt)}</td>
                    </tr>
                  ))}
                  {!savings.isLoading && (savings.data?.length ?? 0) === 0 && (
                    <tr><td colSpan={3} className="py-12"><EmptyState title="No savings yet" /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </MemberReportCard>
        </TabsContent>

        <TabsContent value="loans" className="mt-4">
          <MemberReportCard
            title="Loan report"
            description="All of your submitted loans and their current balances."
            csvName="member-loans-report.csv"
            pdfName="member-loans-report.pdf"
            pdfTitle="Member Loan Report"
            rows={datasets.loans}
          >
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Type</th><th className="text-right">Amount</th><th className="text-right">Balance</th><th>Status</th><th>Submitted</th></tr></thead>
                <tbody>
                  {(loans.data ?? []).map((loan) => (
                    <tr key={loan.id}>
                      <td className="capitalize">{String(loan.loanType).replace("_", " ")}</td>
                      <td className="text-right font-mono">{formatUGX(loan.amount)}</td>
                      <td className="text-right font-mono">{formatUGX(loan.balance)}</td>
                      <td><StatusBadge status={loan.status as LoanStatus} /></td>
                      <td className="text-muted-foreground">{formatDate(loan.createdAt)}</td>
                    </tr>
                  ))}
                  {(loans.data?.length ?? 0) === 0 && (
                    <tr><td colSpan={5} className="py-12"><EmptyState title="No loans yet" /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </MemberReportCard>
        </TabsContent>

        <TabsContent value="repayments" className="mt-4">
          <MemberReportCard
            title="Repayment report"
            description="Every repayment recorded against your loans."
            csvName="member-repayments-report.csv"
            pdfName="member-repayments-report.pdf"
            pdfTitle="Member Repayment Report"
            rows={datasets.repayments}
          >
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Loan</th><th>Month</th><th className="text-right">Amount</th><th>Paid</th></tr></thead>
                <tbody>
                  {myRepayments.map((repayment) => (
                    <tr key={repayment.id}>
                      <td className="font-mono text-xs">{repayment.loanId}</td>
                      <td>{formatMonth(repayment.month)}</td>
                      <td className="text-right font-mono">{formatUGX(repayment.amount)}</td>
                      <td className="text-muted-foreground">{formatDate(repayment.paidAt)}</td>
                    </tr>
                  ))}
                  {myRepayments.length === 0 && (
                    <tr><td colSpan={4} className="py-12"><EmptyState title="No repayments yet" /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </MemberReportCard>
        </TabsContent>

        <TabsContent value="interest" className="mt-4">
          <MemberReportCard
            title="Interest distribution report"
            description="Monthly interest distribution snapshots when interest allocations are available."
            csvName="member-interest-distribution-report.csv"
            pdfName="member-interest-distribution-report.pdf"
            pdfTitle="Interest Distribution Report"
            rows={datasets.interestDistribution}
            disabled={!hasInterestDistribution}
          >
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Month</th><th className="text-right">Loan Interest</th><th className="text-right">Trust Interest</th><th className="text-right">Total</th></tr></thead>
                <tbody>
                  {interestAllocations.isLoading && Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 4 }).map((__, j) => <td key={j}><Skeleton className="h-4 w-20" /></td>)}</tr>
                  ))}
                  {!interestAllocations.isLoading && (interestAllocations.data ?? []).map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatMonth(entry.month)}</td>
                      <td className="text-right font-mono">{formatUGX(entry.loanInterest)}</td>
                      <td className="text-right font-mono">{formatUGX(entry.trustInterest)}</td>
                      <td className="text-right font-mono">{formatUGX(entry.totalInterest)}</td>
                    </tr>
                  ))}
                  {!interestAllocations.isLoading && !hasInterestDistribution && (
                    <tr><td colSpan={4} className="py-12"><EmptyState title="No interest distributions available yet" /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </MemberReportCard>
        </TabsContent>
      </Tabs>
    </>
  );
}

function MemberReportCard({
  title,
  description,
  csvName,
  pdfName,
  pdfTitle,
  rows,
  disabled,
  children,
}: {
  title: string;
  description: string;
  csvName: string;
  pdfName: string;
  pdfTitle: string;
  rows: (string | number | boolean | null | undefined)[][];
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const canExport = !disabled && rows.length > 1;

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-sm)]">
      <div className="flex flex-col gap-3 border-b bg-muted/20 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex gap-2 rounded-xl border bg-background/80 p-1">
          <Button variant="outline" size="sm" disabled={!canExport} onClick={() => downloadCsvReport(csvName, rows)}>
            <Download className="mr-1 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" disabled={!canExport} onClick={() => downloadPdfReport(pdfName, pdfTitle, rows)}>
            <Download className="mr-1 h-4 w-4" /> PDF
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}

function SimpleTable({
  loading,
  headers,
  rows,
  rowCount,
  emptyTitle,
}: {
  loading: boolean;
  headers: string[];
  rows: Array<Array<string>>;
  rowCount: number;
  emptyTitle: string;
}) {
  return (
    <div className="overflow-x-auto rounded-b-2xl">
      <table className="data-table">
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>
          {loading && Array.from({ length: rowCount }).map((_, i) => (
            <tr key={i}>{headers.map((header) => <td key={header}><Skeleton className="h-4 w-20" /></td>)}</tr>
          ))}
          {!loading && rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${row[0] ?? "row"}`}>
              {row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>)}
            </tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={headers.length} className="py-12"><EmptyState title={emptyTitle} /></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
