import { useMemo, useState } from "react";
import { Download, FileBarChart, TrendingUp, PiggyBank, BookOpen, Landmark } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useExpenses,
  useInterestMonthly,
  useLedger,
  useLoans,
  useMembers,
  useRetainedEarnings,
  useSavings,
  useSubscriptions,
  useUnitTrust,
} from "@/hooks/data";
import { formatDate, formatMonth, formatPercent, formatUGX } from "@/lib/format";
import {
  buildAgmSnapshot,
  downloadCsvReport,
  downloadAgmPdfReport,
  downloadPdfReport,
  prepareAgmReportData,
  prepareExpensesReportData,
  prepareInterestReportData,
  prepareLedgerReportData,
  prepareLoansReportData,
  prepareMemberReportData,
  prepareRetainedEarningsReportData,
  prepareSavingsReportData,
  prepareSubscriptionsReportData,
  prepareUnitTrustReportData,
} from "@/lib/reports";
import { cn } from "@/lib/utils";
import { reportsService } from "@/services";

export default function AdminReports() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const ledger = useLedger();
  const interest = useInterestMonthly();
  const retained = useRetainedEarnings();
  const savings = useSavings();
  const loans = useLoans();
  const trust = useUnitTrust();
  const expenses = useExpenses();
  const members = useMembers();
  const subscriptions = useSubscriptions();
  const [closeMonth, setCloseMonth] = useState(new Date().toISOString().slice(0, 7));
  const [closeNotes, setCloseNotes] = useState("");
  const [agmBankBalanceInput, setAgmBankBalanceInput] = useState("");
  const [preview, setPreview] = useState<any | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [posting, setPosting] = useState(false);
  const agmBankBalance = Number(agmBankBalanceInput || 0) || 0;

  const agmSnapshot = useMemo(() => buildAgmSnapshot({
    members: members.data ?? [],
    savings: savings.data ?? [],
    loans: loans.data ?? [],
    expenses: expenses.data ?? [],
    subscriptions: subscriptions.data ?? [],
    unitTrust: trust.data ?? [],
    ledger: ledger.data ?? [],
    interest: interest.data ?? [],
    retainedEarnings: retained.data ?? [],
  }, {
    bankBalance: agmBankBalance,
  }), [
    members.data,
    savings.data,
    loans.data,
    expenses.data,
    subscriptions.data,
    trust.data,
    ledger.data,
    interest.data,
    retained.data,
    agmBankBalance,
  ]);

  const totals = useMemo(() => {
    const totalSavings = savings.data?.reduce((sum, entry) => sum + entry.amount, 0) ?? 0;
    const portfolio = loans.data?.reduce((sum, loan) => sum + loan.amount, 0) ?? 0;
    const outstanding = loans.data?.filter((loan) => loan.status === "active").reduce((sum, loan) => sum + loan.balance, 0) ?? 0;
    const trustBal = trust.data?.reduce((sum, entry) => sum + (entry.type === "withdrawal" ? -entry.amount : entry.amount), 0) ?? 0;
    const totalExp = expenses.data?.reduce((sum, entry) => sum + entry.amount, 0) ?? 0;
    const interestTotal = agmSnapshot.interestSummary.accruedInterest;
    return { totalSavings, portfolio, outstanding, trustBal, totalExp, interestTotal };
  }, [savings.data, loans.data, trust.data, expenses.data, agmSnapshot]);

  const datasets = useMemo(() => ({
    members: prepareMemberReportData(members.data ?? [], savings.data ?? [], loans.data ?? []),
    savings: prepareSavingsReportData(members.data ?? [], savings.data ?? []),
    loans: prepareLoansReportData(members.data ?? [], loans.data ?? []),
    subscriptions: prepareSubscriptionsReportData(members.data ?? [], subscriptions.data ?? []),
    expenses: prepareExpensesReportData(expenses.data ?? []),
    unitTrust: prepareUnitTrustReportData(trust.data ?? []),
    interest: prepareInterestReportData(interest.data ?? []),
    ledger: prepareLedgerReportData(ledger.data ?? []),
    retained: prepareRetainedEarningsReportData(retained.data ?? []),
    agm: prepareAgmReportData({
      members: members.data ?? [],
      savings: savings.data ?? [],
      loans: loans.data ?? [],
      expenses: expenses.data ?? [],
      subscriptions: subscriptions.data ?? [],
      unitTrust: trust.data ?? [],
      ledger: ledger.data ?? [],
      interest: interest.data ?? [],
      retainedEarnings: retained.data ?? [],
    }, {
      bankBalance: agmBankBalance,
    }),
  }), [
    members.data,
    savings.data,
    loans.data,
    subscriptions.data,
    expenses.data,
    trust.data,
    interest.data,
    ledger.data,
    retained.data,
    agmBankBalance,
  ]);

  const handlePreviewClose = async () => {
    setPreviewing(true);
    try {
      const result = await reportsService.previewInterestClose(closeMonth, closeNotes.trim() || undefined);
      setPreview(result);
    } catch (error) {
      toast({ title: "Preview failed", description: error instanceof Error ? error.message : "We couldn't preview the month close.", variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  };

  const handlePostClose = async () => {
    setPosting(true);
    try {
      const result = await reportsService.postInterestClose(closeMonth, closeNotes.trim() || undefined);
      setPreview(result.preview ?? null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["reports", "interestMonthly"] }),
        qc.invalidateQueries({ queryKey: ["reports", "interestAllocations"] }),
        qc.invalidateQueries({ queryKey: ["reports", "retainedEarnings"] }),
      ]);
      toast({ title: "Month closed", description: `Interest allocations for ${closeMonth} were posted.` });
    } catch (error) {
      toast({ title: "Month close failed", description: error instanceof Error ? error.message : "We couldn't post the month close.", variant: "destructive" });
    } finally {
      setPosting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description="Live reporting across members, savings, loans, subscriptions, trust, expenses, ledger and AGM summaries."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total savings" value={formatUGX(totals.totalSavings)} icon={PiggyBank} accent="primary" loading={savings.isLoading} />
        <KpiCard label="Loans outstanding" value={formatUGX(totals.outstanding)} icon={FileBarChart} accent="warning" loading={loans.isLoading} hint={`${formatUGX(totals.portfolio)} portfolio`} />
        <KpiCard label="Interest earned" value={formatUGX(totals.interestTotal)} icon={TrendingUp} accent="success" loading={interest.isLoading} />
        <KpiCard label="Unit trust balance" value={formatUGX(totals.trustBal)} icon={Landmark} accent="info" loading={trust.isLoading} hint={`${formatUGX(totals.totalExp)} expenses`} />
      </div>

      <Tabs defaultValue="members" className="mt-6">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="savings">Savings</TabsTrigger>
          <TabsTrigger value="loans">Loans</TabsTrigger>
          <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="unitTrust">Unit trust</TabsTrigger>
          <TabsTrigger value="interest">Interest</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="retained">Retained</TabsTrigger>
          <TabsTrigger value="agm">AGM</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          <ReportCard
            title="Member reports"
            description="Member directory, savings totals, active loans and outstanding balances."
            csvName="members-report.csv"
            pdfName="members-report.pdf"
            pdfTitle="Member Report"
            rows={datasets.members}
          >
            <SimpleTable
              loading={members.isLoading || savings.isLoading || loans.isLoading}
              headers={["Member", "Status", "Savings", "Active Loans", "Outstanding"]}
              rowCount={5}
              emptyTitle="No members available"
              rows={(members.data ?? []).map((member) => {
                const reportRow = datasets.members.find((row) => row[0] === member.id);
                return [
                  member.name,
                  member.status,
                  formatUGX(Number(reportRow?.[5] ?? 0)),
                  String(reportRow?.[6] ?? 0),
                  formatUGX(Number(reportRow?.[7] ?? 0)),
                ];
              })}
            />
          </ReportCard>
        </TabsContent>

        <TabsContent value="savings" className="mt-4">
          <ReportCard
            title="Savings reports"
            description="Contribution history sourced from live member savings records."
            csvName="savings-report.csv"
            pdfName="savings-report.pdf"
            pdfTitle="Savings Report"
            rows={datasets.savings}
          >
            <SimpleTable
              loading={savings.isLoading}
              headers={["Member", "Period", "Amount", "Recorded"]}
              rowCount={5}
              emptyTitle="No savings records"
              rows={(datasets.savings.slice(1, 51) as string[][]).map((row) => [
                row[0],
                formatMonth(String(row[1])),
                formatUGX(Number(row[2])),
                formatDate(String(row[3])),
              ])}
            />
          </ReportCard>
        </TabsContent>

        <TabsContent value="loans" className="mt-4">
          <ReportCard
            title="Loan reports"
            description="All submitted loans with status, balances and approval dates."
            csvName="loans-report.csv"
            pdfName="loans-report.pdf"
            pdfTitle="Loan Report"
            rows={datasets.loans}
          >
            <SimpleTable
              loading={loans.isLoading}
              headers={["Member", "Type", "Amount", "Balance", "Status"]}
              rowCount={5}
              emptyTitle="No loan records"
              rows={(datasets.loans.slice(1, 51) as string[][]).map((row) => [
                row[0],
                String(row[1]).replace("_", " "),
                formatUGX(Number(row[2])),
                formatUGX(Number(row[3])),
                row[4],
              ])}
            />
          </ReportCard>
        </TabsContent>

        <TabsContent value="subscriptions" className="mt-4">
          <ReportCard
            title="Subscription reports"
            description="Annual subscription collections sourced from live subscription entries."
            csvName="subscriptions-report.csv"
            pdfName="subscriptions-report.pdf"
            pdfTitle="Subscription Report"
            rows={datasets.subscriptions}
          >
            <SimpleTable
              loading={subscriptions.isLoading}
              headers={["Member", "Year", "Amount", "Status", "Paid"]}
              rowCount={5}
              emptyTitle="No subscription records"
              rows={(datasets.subscriptions.slice(1, 51) as string[][]).map((row) => [
                row[0],
                row[1],
                formatUGX(Number(row[2])),
                row[3],
                formatDate(String(row[4])),
              ])}
            />
          </ReportCard>
        </TabsContent>

        <TabsContent value="expenses" className="mt-4">
          <ReportCard
            title="Expense reports"
            description="Operating expenses for finance review and month-end reporting."
            csvName="expenses-report.csv"
            pdfName="expenses-report.pdf"
            pdfTitle="Expense Report"
            rows={datasets.expenses}
          >
            <SimpleTable
              loading={expenses.isLoading}
              headers={["Description", "Category", "Amount", "Date"]}
              rowCount={5}
              emptyTitle="No expense records"
              rows={(datasets.expenses.slice(1, 51) as string[][]).map((row) => [
                row[0],
                row[1],
                formatUGX(Number(row[2])),
                formatDate(String(row[3])),
              ])}
            />
          </ReportCard>
        </TabsContent>

        <TabsContent value="unitTrust" className="mt-4">
          <ReportCard
            title="Unit trust reports"
            description="Deposits, withdrawals and trust interest from live trust records."
            csvName="unit-trust-report.csv"
            pdfName="unit-trust-report.pdf"
            pdfTitle="Unit Trust Report"
            rows={datasets.unitTrust}
          >
            <SimpleTable
              loading={trust.isLoading}
              headers={["Type", "Amount", "Description", "Date"]}
              rowCount={5}
              emptyTitle="No unit trust records"
              rows={(datasets.unitTrust.slice(1, 51) as string[][]).map((row) => [
                row[0],
                formatUGX(Number(row[1])),
                row[2],
                formatDate(String(row[3])),
              ])}
            />
          </ReportCard>
        </TabsContent>

        <TabsContent value="interest" className="mt-4">
          <div className="mb-4 rounded-xl border bg-card p-4 shadow-[var(--shadow-sm)]">
            <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">Monthly close</h3>
                  <p className="text-xs text-muted-foreground">Post trust and loan interest for a month using the configured retention percentages.</p>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Month</label>
                  <Input type="month" value={closeMonth} onChange={(e) => setCloseMonth(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Notes</label>
                  <Input value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder="Optional month-close note" />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handlePreviewClose} disabled={previewing || posting}>
                    {previewing ? "Previewing..." : "Preview close"}
                  </Button>
                  <Button onClick={handlePostClose} disabled={posting || previewing}>
                    {posting ? "Posting..." : "Post close"}
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-4">
                <h4 className="text-sm font-semibold">Preview</h4>
                {preview ? (
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Loan interest total</span><span className="font-medium">{formatUGX(preview.loanInterestTotal)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Trust interest total</span><span className="font-medium">{formatUGX(preview.trustInterestTotal)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Loan retained ({preview.loanInterestRetentionPct}%)</span><span className="font-medium">{formatUGX(preview.loanInterestRetained)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Trust retained ({preview.trustInterestRetentionPct}%)</span><span className="font-medium">{formatUGX(preview.trustInterestRetained)}</span></div>
                    <div className="flex justify-between border-t pt-2"><span className="text-muted-foreground">Distributed</span><span className="font-medium">{formatUGX(preview.loanInterestDistributed + preview.trustInterestDistributed)}</span></div>
                    <div className="pt-2 text-xs text-muted-foreground">{preview.allocations?.length ?? 0} member allocation rows will be posted.</div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">Preview a month close to see gross interest, retained amounts, distributable pools, and member allocations before posting.</p>
                )}
              </div>
            </div>
          </div>
          <ReportCard
            title="Monthly interest reports"
            description="Loan and trust interest totals from live monthly interest snapshots."
            csvName="interest-report.csv"
            pdfName="interest-report.pdf"
            pdfTitle="Interest Report"
            rows={datasets.interest}
          >
            <SimpleTable
              loading={interest.isLoading}
              headers={["Month", "Loan Interest", "Trust Interest", "Total"]}
              rowCount={5}
              emptyTitle="No interest records"
              rows={(datasets.interest.slice(1, 51) as string[][]).map((row) => [
                formatMonth(String(row[0])),
                formatUGX(Number(row[1])),
                formatUGX(Number(row[2])),
                formatUGX(Number(row[3])),
              ])}
            />
          </ReportCard>
        </TabsContent>

        <TabsContent value="ledger" className="mt-4">
          <ReportCard
            title="General ledger"
            description="Aggregated ledger movements across savings, loans and operating activity."
            csvName="ledger-report.csv"
            pdfName="ledger-report.pdf"
            pdfTitle="Ledger Report"
            rows={datasets.ledger}
          >
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>Type</th><th>Month</th><th>Year</th><th className="text-right">Amount</th><th>Recorded</th></tr>
                </thead>
                <tbody>
                  {ledger.isLoading && Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 5 }).map((__, j) => <td key={j}><Skeleton className="h-4 w-20" /></td>)}</tr>
                  ))}
                  {!ledger.isLoading && (ledger.data ?? []).slice(0, 50).map((entry) => (
                    <tr key={entry.id}>
                      <td className="capitalize">{String(entry.type).replace(/_/g, " ")}</td>
                      <td>{entry.month ? formatMonth(entry.month) : "-"}</td>
                      <td className="text-muted-foreground">{entry.year ?? "-"}</td>
                      <td className={cn("text-right font-mono", entry.amount < 0 && "text-destructive")}>{formatUGX(entry.amount)}</td>
                      <td className="text-muted-foreground">{formatDate(entry.createdAt)}</td>
                    </tr>
                  ))}
                  {!ledger.isLoading && (ledger.data?.length ?? 0) === 0 && (
                    <tr><td colSpan={5} className="py-12"><EmptyState title="No ledger entries" /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </ReportCard>
        </TabsContent>

        <TabsContent value="retained" className="mt-4">
          <ReportCard
            title="Retained earnings reports"
            description="Posted retained interest entries by month and source."
            csvName="retained-earnings-report.csv"
            pdfName="retained-earnings-report.pdf"
            pdfTitle="Retained Earnings Report"
            rows={datasets.retained}
          >
            <SimpleTable
              loading={retained.isLoading}
              headers={["Month", "Source", "Gross", "Retention %", "Retained", "Distributed", "Recorded", "Notes"]}
              rowCount={4}
              emptyTitle="No retained earnings yet"
              rows={(datasets.retained.slice(1, 51) as string[][]).map((row) => [
                formatMonth(String(row[0])),
                row[1],
                formatUGX(Number(row[2])),
                formatPercent(Number(row[3])),
                formatUGX(Number(row[4])),
                formatUGX(Number(row[5])),
                formatDate(String(row[6])),
                row[7] || "-",
              ])}
            />
          </ReportCard>
        </TabsContent>

        <TabsContent value="agm" className="mt-4">
          <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)]">
            <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-semibold">Crownzcom Investment Club Summary Report</h3>
                <p className="text-xs text-muted-foreground">Generated {agmSnapshot.generatedAt}. Club-level overview, interest summary, monthly performance and annual projections.</p>
              </div>
              <div className="flex flex-col gap-3 md:min-w-[420px]">
                <div className="grid gap-2">
                  <label className="text-xs font-medium text-muted-foreground">Current bank balance (UGX)</label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={agmBankBalanceInput}
                    onChange={(e) => setAgmBankBalanceInput(e.target.value)}
                    placeholder="Enter the bank balance to include in this AGM"
                  />
                </div>
                <div className="flex gap-2 md:justify-end">
                <Button variant="outline" size="sm" disabled={datasets.agm.length <= 1} onClick={() => downloadCsvReport("agm-summary-report.csv", datasets.agm)}>
                  <Download className="mr-1 h-4 w-4" /> CSV
                </Button>
                <Button variant="outline" size="sm" disabled={datasets.agm.length <= 1} onClick={() => downloadAgmPdfReport("agm-summary-report.pdf", "Crownzcom Investment Club Summary Report", agmSnapshot)}>
                  <Download className="mr-1 h-4 w-4" /> PDF
                </Button>
                </div>
              </div>
            </div>

            <div className="space-y-6 p-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <KpiCard label="Total savings" value={formatUGX(agmSnapshot.overview.totalSavings)} icon={PiggyBank} accent="primary" loading={savings.isLoading} />
                <KpiCard label="Unit trust balance" value={formatUGX(agmSnapshot.overview.unitTrustBalance)} icon={Landmark} accent="info" loading={trust.isLoading} />
                <KpiCard label="Bank balance" value={formatUGX(agmSnapshot.overview.bankBalance)} icon={BookOpen} accent="success" />
                <KpiCard label="Outstanding loans" value={formatUGX(agmSnapshot.overview.outstandingLoans)} icon={FileBarChart} accent="warning" loading={loans.isLoading} />
                <KpiCard label="Accrued interest" value={formatUGX(agmSnapshot.interestSummary.accruedInterest)} icon={TrendingUp} accent="success" loading={interest.isLoading} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-xl border p-4">
                  <h4 className="text-sm font-semibold">Executive summary</h4>
                  <div className="mt-3 grid gap-2 text-sm">
                    <SummaryLine label="Total members" value={String(agmSnapshot.overview.totalMembers)} />
                    <SummaryLine label="Active members" value={String(agmSnapshot.overview.activeMembers)} />
                    <SummaryLine label="Loan portfolio issued" value={formatUGX(agmSnapshot.overview.loanPortfolioIssued)} />
                    <SummaryLine label="Subscriptions collected" value={formatUGX(agmSnapshot.overview.subscriptionsCollected)} />
                    <SummaryLine label="Operating expenses" value={formatUGX(agmSnapshot.overview.operatingExpenses)} />
                    <SummaryLine label="Bank balance" value={formatUGX(agmSnapshot.overview.bankBalance)} />
                    <SummaryLine label="Combined club position" value={formatUGX(agmSnapshot.overview.combinedClubPosition)} />
                  </div>
                </section>

                <section className="rounded-xl border p-4">
                  <h4 className="text-sm font-semibold">Interest summary</h4>
                  <div className="mt-3 grid gap-2 text-sm">
                    <SummaryLine label="Trust interest earned" value={formatUGX(agmSnapshot.interestSummary.trustInterestEarned)} />
                    <SummaryLine label="Loan interest earned" value={formatUGX(agmSnapshot.interestSummary.loanInterestEarned)} />
                    <SummaryLine label="Retained interest" value={formatUGX(agmSnapshot.interestSummary.retainedTotal)} />
                    <SummaryLine label="Distributed interest" value={formatUGX(agmSnapshot.interestSummary.distributedTotal)} />
                  </div>
                </section>
              </div>

              <section className="rounded-xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold">Monthly performance</h4>
                    <p className="text-xs text-muted-foreground">Savings, trust interest, loan interest, retained amounts and closing trust position by month.</p>
                  </div>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th className="text-right">Savings Added</th>
                        <th className="text-right">Trust Interest</th>
                        <th className="text-right">Loan Interest</th>
                        <th className="text-right">Accrued Interest</th>
                        <th className="text-right">Retained</th>
                        <th className="text-right">Distributed</th>
                        <th className="text-right">Closing Trust</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agmSnapshot.monthlyPerformance.map((row) => (
                        <tr key={row.month}>
                          <td>{formatMonth(row.month)}</td>
                          <td className="text-right font-mono">{formatUGX(row.savingsAdded)}</td>
                          <td className="text-right font-mono">{formatUGX(row.trustInterest)}</td>
                          <td className="text-right font-mono">{formatUGX(row.loanInterest)}</td>
                          <td className="text-right font-mono">{formatUGX(row.accruedInterest)}</td>
                          <td className="text-right font-mono">{formatUGX(row.retained)}</td>
                          <td className="text-right font-mono">{formatUGX(row.distributed)}</td>
                          <td className="text-right font-mono">{formatUGX(row.closingTrustPosition)}</td>
                        </tr>
                      ))}
                      {agmSnapshot.monthlyPerformance.length === 0 && (
                        <tr><td colSpan={8} className="py-12"><EmptyState title="No AGM summary available" /></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-xl border p-4">
                <h4 className="text-sm font-semibold">12-month projections</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  Based on the most recent {agmSnapshot.projections.basedOnMonths} recorded month{agmSnapshot.projections.basedOnMonths === 1 ? "" : "s"} of savings and trust interest only. Loan interest is not projected because future borrowing is uncertain.
                </p>
                <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                  <SummaryLine label="Projected savings added" value={formatUGX(agmSnapshot.projections.annualSavingsAdded)} />
                  <SummaryLine label="Projected trust interest" value={formatUGX(agmSnapshot.projections.annualTrustInterest)} />
                </div>
              </section>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function ReportCard({
  title,
  description,
  csvName,
  pdfName,
  pdfTitle,
  rows,
  children,
}: {
  title: string;
  description: string;
  csvName: string;
  pdfName: string;
  pdfTitle: string;
  rows: (string | number | boolean | null | undefined)[][];
  children: React.ReactNode;
}) {
  const canExport = rows.length > 1;

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
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {loading && Array.from({ length: rowCount }).map((_, i) => (
            <tr key={i}>{headers.map((header) => <td key={header}><Skeleton className="h-4 w-20" /></td>)}</tr>
          ))}
          {!loading && rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${row[0] ?? "row"}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
              ))}
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
