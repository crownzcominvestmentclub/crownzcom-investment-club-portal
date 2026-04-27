import { useMemo } from "react";
import { Download, FileText, Wallet, Banknote, Receipt } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import {
  useLoanRepayments, useLoansByMember, useSavingsByMember, useSubscriptions,
} from "@/hooks/data";
import { formatDate, formatMonth, formatUGX } from "@/lib/format";
import type { LoanStatus } from "@/lib/types";

export default function MemberReports() {
  const { user } = useAuth();
  const memberId = user?.memberId;

  const savings = useSavingsByMember(memberId);
  const loans = useLoansByMember(memberId);
  const repayments = useLoanRepayments();
  const subs = useSubscriptions();

  const myLoanIds = useMemo(() => new Set((loans.data ?? []).map((l) => l.id)), [loans.data]);
  const myRepayments = useMemo(
    () => (repayments.data ?? []).filter((r) => myLoanIds.has(r.loanId)).sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
    [repayments.data, myLoanIds],
  );
  const mySubs = useMemo(
    () => (subs.data ?? []).filter((s) => s.memberId === memberId).sort((a, b) => b.month.localeCompare(a.month)),
    [subs.data, memberId],
  );

  const totalSavings = savings.data?.reduce((a, s) => a + s.amount, 0) ?? 0;
  const totalRepaid = myRepayments.reduce((a, r) => a + r.amount, 0);
  const totalSubs = mySubs.reduce((a, s) => a + s.amount, 0);
  const outstanding = (loans.data ?? []).filter((l) => l.status === "active").reduce((a, l) => a + l.balance, 0);

  const exportStatement = () => {
    const lines: string[] = [];
    lines.push(`Member statement for ${user?.name ?? "Member"}`);
    lines.push(`Generated ${new Date().toLocaleString()}`);
    lines.push("");
    lines.push("=== Savings ===");
    lines.push("Month,Amount (UGX)");
    (savings.data ?? []).forEach((s) => lines.push(`${s.month},${s.amount}`));
    lines.push("");
    lines.push("=== Loans ===");
    lines.push("Type,Amount,Balance,Status,Submitted");
    (loans.data ?? []).forEach((l) => lines.push(`${l.loanType},${l.amount},${l.balance},${l.status},${l.createdAt}`));
    lines.push("");
    lines.push("=== Repayments ===");
    lines.push("LoanId,Month,Amount,Paid");
    myRepayments.forEach((r) => lines.push(`${r.loanId},${r.month},${r.amount},${r.paidAt}`));
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `statement-${(user?.name ?? "member").replace(/\s+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!memberId) {
    return (
      <>
        <PageHeader title="My reports" />
        <EmptyState title="No member profile linked" description="An administrator can link your profile from the Members module." />
      </>
    );
  }

  const loading = savings.isLoading || loans.isLoading || repayments.isLoading;

  return (
    <>
      <PageHeader
        title="My reports"
        description="Personal statement: savings, loans and repayments."
        actions={
          <Button onClick={exportStatement} variant="outline" size="sm">
            <Download className="mr-1 h-4 w-4" /> Export statement
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total savings" value={formatUGX(totalSavings, { compact: true })} icon={Wallet} accent="primary" loading={loading} />
        <KpiCard label="Loans outstanding" value={formatUGX(outstanding, { compact: true })} icon={Banknote} accent="warning" loading={loading} />
        <KpiCard label="Total repaid" value={formatUGX(totalRepaid, { compact: true })} icon={Receipt} accent="success" loading={loading} hint={`${myRepayments.length} payments`} />
        <KpiCard label="Subscriptions paid" value={formatUGX(totalSubs, { compact: true })} icon={FileText} accent="info" loading={loading} />
      </div>

      <Tabs defaultValue="savings" className="mt-6">
        <TabsList>
          <TabsTrigger value="savings">Savings</TabsTrigger>
          <TabsTrigger value="loans">Loans</TabsTrigger>
          <TabsTrigger value="repayments">Repayments</TabsTrigger>
        </TabsList>

        <TabsContent value="savings" className="mt-4">
          <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)]">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Month</th><th className="text-right">Amount</th><th>Recorded</th></tr></thead>
                <tbody>
                  {savings.isLoading && Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 3 }).map((__, j) => <td key={j}><Skeleton className="h-4 w-20" /></td>)}</tr>
                  ))}
                  {!savings.isLoading && [...(savings.data ?? [])].sort((a, b) => b.month.localeCompare(a.month)).map((s) => (
                    <tr key={s.id}>
                      <td>{formatMonth(s.month)}</td>
                      <td className="text-right font-mono">{formatUGX(s.amount)}</td>
                      <td className="text-muted-foreground">{formatDate(s.createdAt)}</td>
                    </tr>
                  ))}
                  {!savings.isLoading && (savings.data?.length ?? 0) === 0 && (
                    <tr><td colSpan={3} className="py-12"><EmptyState title="No savings yet" /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="loans" className="mt-4">
          <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)]">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Type</th><th className="text-right">Amount</th><th className="text-right">Balance</th><th>Status</th><th>Submitted</th></tr></thead>
                <tbody>
                  {(loans.data ?? []).map((l) => (
                    <tr key={l.id}>
                      <td className="capitalize">{l.loanType.replace("_", " ")}</td>
                      <td className="text-right font-mono">{formatUGX(l.amount)}</td>
                      <td className="text-right font-mono">{formatUGX(l.balance)}</td>
                      <td><StatusBadge status={l.status as LoanStatus} /></td>
                      <td className="text-muted-foreground">{formatDate(l.createdAt)}</td>
                    </tr>
                  ))}
                  {(loans.data?.length ?? 0) === 0 && (
                    <tr><td colSpan={5} className="py-12"><EmptyState title="No loans yet" /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="repayments" className="mt-4">
          <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)]">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Loan</th><th>Month</th><th className="text-right">Amount</th><th>Paid</th></tr></thead>
                <tbody>
                  {myRepayments.map((r) => (
                    <tr key={r.id}>
                      <td className="font-mono text-xs">{r.loanId}</td>
                      <td>{formatMonth(r.month)}</td>
                      <td className="text-right font-mono">{formatUGX(r.amount)}</td>
                      <td className="text-muted-foreground">{formatDate(r.paidAt)}</td>
                    </tr>
                  ))}
                  {myRepayments.length === 0 && (
                    <tr><td colSpan={4} className="py-12"><EmptyState title="No repayments yet" /></td></tr>
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
