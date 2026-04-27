import { useMemo } from "react";
import { Download, FileBarChart, TrendingUp, PiggyBank, BookOpen } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useExpenses, useInterestMonthly, useLedger, useLoans, useRetainedEarnings, useSavings, useUnitTrust,
} from "@/hooks/data";
import { formatDate, formatMonth, formatUGX, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function AdminReports() {
  const ledger = useLedger();
  const interest = useInterestMonthly();
  const retained = useRetainedEarnings();
  const savings = useSavings();
  const loans = useLoans();
  const trust = useUnitTrust();
  const expenses = useExpenses();

  const totals = useMemo(() => {
    const totalSavings = savings.data?.reduce((a, s) => a + s.amount, 0) ?? 0;
    const portfolio = loans.data?.reduce((a, l) => a + l.amount, 0) ?? 0;
    const outstanding = loans.data?.filter((l) => l.status === "active").reduce((a, l) => a + l.balance, 0) ?? 0;
    const trustBal = trust.data?.reduce((a, t) => a + (t.type === "withdrawal" ? -t.amount : t.amount), 0) ?? 0;
    const totalExp = expenses.data?.reduce((a, e) => a + e.amount, 0) ?? 0;
    const interestTotal = (interest.data ?? []).reduce((a, i) => a + i.loanInterestTotal + i.trustInterestTotal, 0);
    return { totalSavings, portfolio, outstanding, trustBal, totalExp, interestTotal };
  }, [savings.data, loans.data, trust.data, expenses.data, interest.data]);

  const exportCSV = (rows: (string | number)[][], filename: string) => {
    const csv = rows.map((r) => r.map((c) => `"${String(c)}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description="Financial overview, ledger, interest accruals and retained earnings."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total savings" value={formatUGX(totals.totalSavings, { compact: true })} icon={PiggyBank} accent="primary" loading={savings.isLoading} />
        <KpiCard label="Loans outstanding" value={formatUGX(totals.outstanding, { compact: true })} icon={FileBarChart} accent="warning" loading={loans.isLoading} hint={`${formatUGX(totals.portfolio, { compact: true })} portfolio`} />
        <KpiCard label="Interest earned" value={formatUGX(totals.interestTotal, { compact: true })} icon={TrendingUp} accent="success" loading={interest.isLoading} />
        <KpiCard label="Operating expenses" value={formatUGX(totals.totalExp, { compact: true })} icon={BookOpen} accent="info" loading={expenses.isLoading} />
      </div>

      <Tabs defaultValue="ledger" className="mt-6">
        <TabsList>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="interest">Interest (monthly)</TabsTrigger>
          <TabsTrigger value="retained">Retained earnings</TabsTrigger>
        </TabsList>

        <TabsContent value="ledger" className="mt-4">
          <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)]">
            <div className="flex items-center justify-between border-b p-4">
              <div>
                <h3 className="text-sm font-semibold">General ledger</h3>
                <p className="text-xs text-muted-foreground">Aggregated movements across savings and expenses</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => exportCSV(
                [["Type", "Amount", "Month", "Year", "Notes"], ...(ledger.data ?? []).map((l) => [l.type, l.amount, l.month ?? "", l.year ?? "", l.notes ?? ""])],
                "ledger.csv",
              )}>
                <Download className="mr-1 h-4 w-4" /> Export
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>Type</th><th>Month</th><th>Year</th><th className="text-right">Amount</th><th>Recorded</th></tr>
                </thead>
                <tbody>
                  {ledger.isLoading && Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 5 }).map((__, j) => <td key={j}><Skeleton className="h-4 w-20" /></td>)}</tr>
                  ))}
                  {!ledger.isLoading && (ledger.data ?? []).slice(0, 50).map((l) => (
                    <tr key={l.id}>
                      <td className="capitalize">{l.type.replace(/_/g, " ")}</td>
                      <td>{l.month ? formatMonth(l.month) : "—"}</td>
                      <td className="text-muted-foreground">{l.year ?? "—"}</td>
                      <td className={cn("text-right font-mono", l.amount < 0 && "text-destructive")}>{formatUGX(l.amount)}</td>
                      <td className="text-muted-foreground">{formatDate(l.createdAt)}</td>
                    </tr>
                  ))}
                  {!ledger.isLoading && (ledger.data?.length ?? 0) === 0 && (
                    <tr><td colSpan={5} className="py-12"><EmptyState title="No ledger entries" /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="interest" className="mt-4">
          <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)]">
            <div className="flex items-center justify-between border-b p-4">
              <div>
                <h3 className="text-sm font-semibold">Monthly interest income</h3>
                <p className="text-xs text-muted-foreground">From loan repayments and unit trust accruals</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => exportCSV(
                [["Month", "Year", "Loan interest", "Trust interest", "Total"], ...(interest.data ?? []).map((i) => [i.month, i.year, i.loanInterestTotal, i.trustInterestTotal, i.loanInterestTotal + i.trustInterestTotal])],
                "interest.csv",
              )}>
                <Download className="mr-1 h-4 w-4" /> Export
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>Month</th><th className="text-right">Loan interest</th><th className="text-right">Trust interest</th><th className="text-right">Total</th></tr>
                </thead>
                <tbody>
                  {interest.isLoading && Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 4 }).map((__, j) => <td key={j}><Skeleton className="h-4 w-20" /></td>)}</tr>
                  ))}
                  {!interest.isLoading && (interest.data ?? []).map((i) => (
                    <tr key={i.id}>
                      <td>{formatMonth(i.month)}</td>
                      <td className="text-right font-mono">{formatUGX(i.loanInterestTotal)}</td>
                      <td className="text-right font-mono">{formatUGX(i.trustInterestTotal)}</td>
                      <td className="text-right font-mono font-semibold">{formatUGX(i.loanInterestTotal + i.trustInterestTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="retained" className="mt-4">
          <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)]">
            <div className="flex items-center justify-between border-b p-4">
              <div>
                <h3 className="text-sm font-semibold">Retained earnings</h3>
                <p className="text-xs text-muted-foreground">Annual percentage retained at year-end</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>Year</th><th className="text-right">Retention %</th><th>Recorded</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {(retained.data ?? []).map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium">{r.year}</td>
                      <td className="text-right font-mono">{formatPercent(r.percentage)}</td>
                      <td className="text-muted-foreground">{formatDate(r.createdAt)}</td>
                      <td className="text-muted-foreground">{r.notes ?? "—"}</td>
                    </tr>
                  ))}
                  {(retained.data?.length ?? 0) === 0 && (
                    <tr><td colSpan={4} className="py-12"><EmptyState title="No retained earnings yet" /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
