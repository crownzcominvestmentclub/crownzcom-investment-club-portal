import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Wallet, Banknote, ShieldCheck, TrendingUp, FileText, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import {
  useFinancialConfig,
  useLoansByMember,
  usePendingGuarantorRequests,
  useSavingsByMember,
  useSubscriptions,
} from "@/hooks/data";
import { formatDate, formatMonth, formatUGX } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";

export default function MemberOverview() {
  const { user } = useAuth();
  const memberId = user?.memberId;

  const savings = useSavingsByMember(memberId);
  const loans = useLoansByMember(memberId);
  const guarantorRequests = usePendingGuarantorRequests(memberId);
  const subs = useSubscriptions();
  const cfg = useFinancialConfig();

  const totalSavings = useMemo(
    () => savings.data?.reduce((a, s) => a + s.amount, 0) ?? 0,
    [savings.data]
  );

  const eligibility = useMemo(() => {
    if (!cfg.data) return 0;
    return Math.round((totalSavings * cfg.data.loanEligibilityPercentage) / 100);
  }, [totalSavings, cfg.data]);

  const activeLoans = useMemo(
    () => loans.data?.filter((l) => l.status === "active") ?? [],
    [loans.data]
  );
  const outstanding = activeLoans.reduce((a, l) => a + l.balance, 0);
  const availableCredit = Math.max(0, eligibility - outstanding);

  const recentSavings = useMemo(
    () => [...(savings.data ?? [])].sort((a, b) => b.month.localeCompare(a.month)).slice(0, 6),
    [savings.data]
  );

  const subscriptionStatus = useMemo(() => {
    const year = new Date().getFullYear();
    return subs.data?.find((s) => s.memberId === memberId && s.month.startsWith(`${year}-`)) ?? null;
  }, [subs.data, memberId]);

  const loading = savings.isLoading || loans.isLoading || cfg.isLoading;

  if (!memberId) {
    return (
      <>
        <PageHeader title="Member portal" />
        <EmptyState
          title="No member profile linked"
          description="Your account isn't linked to a member record yet. An administrator can link your profile from the Members module."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Welcome, ${user?.name?.split(" ")[0] ?? "Member"}`}
        description="Here's a summary of your savings, loans and pending actions."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total savings"
          value={formatUGX(totalSavings, { compact: true })}
          icon={Wallet}
          accent="primary"
          loading={loading}
          hint={`${savings.data?.length ?? 0} contributions`}
        />
        <KpiCard
          label="Loan eligibility"
          value={formatUGX(eligibility, { compact: true })}
          icon={TrendingUp}
          accent="info"
          loading={loading}
          hint={cfg.data ? `${cfg.data.loanEligibilityPercentage}% of savings` : ""}
        />
        <KpiCard
          label="Available credit"
          value={formatUGX(availableCredit, { compact: true })}
          icon={Banknote}
          accent="success"
          loading={loading}
          hint={outstanding > 0 ? `${formatUGX(outstanding, { compact: true })} outstanding` : "No active loans"}
        />
        <KpiCard
          label="Pending guarantor requests"
          value={String(guarantorRequests.data?.length ?? 0)}
          icon={ShieldCheck}
          accent="warning"
          loading={guarantorRequests.isLoading}
          hint="Action required"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border bg-card shadow-soft lg:col-span-2">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="text-base font-semibold">Recent savings</h2>
              <p className="text-xs text-muted-foreground">Your last contributions</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/app/member/savings">
                View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="text-right">Amount</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {recentSavings.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{formatMonth(s.month)}</td>
                    <td className="text-right font-mono">{formatUGX(s.amount)}</td>
                    <td className="text-muted-foreground">{formatDate(s.createdAt)}</td>
                  </tr>
                ))}
                {recentSavings.length === 0 && !loading && (
                  <tr><td colSpan={3} className="py-8 text-center text-sm text-muted-foreground">No savings yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border bg-card p-5 shadow-soft">
            <h2 className="text-base font-semibold">Active loans</h2>
            <p className="mt-1 text-xs text-muted-foreground">Currently being repaid</p>
            <ul className="mt-4 space-y-3">
              {activeLoans.length === 0 && (
                <li className="text-sm text-muted-foreground">You have no active loans.</li>
              )}
              {activeLoans.map((l) => (
                <li key={l.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium capitalize">{l.loanType.replace("_", " ")}</p>
                    <p className="text-xs text-muted-foreground">
                      Balance {formatUGX(l.balance, { compact: true })}
                    </p>
                  </div>
                  <StatusBadge status={l.status} />
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Annual subscription</h2>
              {subscriptionStatus ? (
                <StatusBadge status="paid" />
              ) : (
                <StatusBadge status="pending" />
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {subscriptionStatus
                ? `Paid on ${formatDate(subscriptionStatus.createdAt)}`
                : "Your annual subscription has not yet been recorded for this year."}
            </p>
            <Button variant="outline" size="sm" className="mt-4 w-full" asChild>
              <Link to="/app/member/subscriptions">
                <FileText className="mr-1 h-3.5 w-3.5" /> View history
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
