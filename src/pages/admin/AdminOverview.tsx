import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Wallet, Users, Banknote, TrendingUp, ArrowRight, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { useExpenses, useLoans, useMembers, useSavings, useUnitTrust } from "@/hooks/data";
import { formatDate, formatUGX } from "@/lib/format";

export default function AdminOverview() {
  const members = useMembers();
  const savings = useSavings();
  const loans = useLoans();
  const expenses = useExpenses();
  const trust = useUnitTrust();

  const totalSavings = useMemo(
    () => savings.data?.reduce((a, s) => a + s.amount, 0) ?? 0,
    [savings.data]
  );
  const activeLoans = useMemo(
    () => loans.data?.filter((l) => l.status === "active") ?? [],
    [loans.data]
  );
  const outstanding = useMemo(
    () =>
      activeLoans.reduce(
        (a, l) => a + Number(l.balance ?? l.outstanding ?? 0),
        0
      ),
    [activeLoans]
  );
  const trustBalance = useMemo(() => {
    return (
      trust.data?.reduce(
        (a, t) => a + (t.type === "withdrawal" ? -t.amount : t.amount),
        0
      ) ?? 0
    );
  }, [trust.data]);
  const pendingApproval = useMemo(
    () =>
      loans.data?.filter((l) =>
        ["pending_admin_approval", "pending_guarantor_approval"].includes(l.status)
      ) ?? [],
    [loans.data]
  );
  const totalExpenses = useMemo(
    () => expenses.data?.reduce((a, e) => a + e.amount, 0) ?? 0,
    [expenses.data]
  );

  const recentLoans = useMemo(() => {
    if (!loans.data || !members.data) return [];
    return [...loans.data]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 6)
      .map((l) => ({
        ...l,
        memberName: members.data!.find((m) => m.id === l.memberId)?.name ?? "Unknown",
      }));
  }, [loans.data, members.data]);

  const loading = members.isLoading || savings.isLoading || loans.isLoading || expenses.isLoading || trust.isLoading;

  return (
    <>
      <PageHeader
        title="Overview"
        description="A snapshot of your club's financial position, lending activity and member growth."
        actions={
          <Button asChild>
            <Link to="/app/admin/reports">
              View reports <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total savings"
          value={formatUGX(totalSavings)}
          icon={Wallet}
          accent="primary"
          trend={{ value: "+8.2%", direction: "up" }}
          hint="vs last quarter"
          loading={loading}
        />
        <KpiCard
          label="Active members"
          value={String(members.data?.filter((m) => m.status === "active").length ?? 0)}
          icon={Users}
          accent="info"
          hint={`${members.data?.length ?? 0} total`}
          loading={loading}
        />
        <KpiCard
          label="Loans outstanding"
          value={formatUGX(outstanding)}
          icon={Banknote}
          accent="warning"
          hint={`${activeLoans.length} active`}
          loading={loading}
        />
        <KpiCard
          label="Unit trust balance"
          value={formatUGX(trustBalance)}
          icon={TrendingUp}
          accent="success"
          trend={{ value: "+2.4%", direction: "up" }}
          hint="incl. interest"
          loading={loading}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border bg-card shadow-soft">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="text-base font-semibold">Recent loan activity</h2>
              <p className="text-xs text-muted-foreground">Latest applications and approvals</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/app/admin/loans">
                View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Type</th>
                  <th className="text-right">Amount</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentLoans.map((l) => (
                  <tr key={l.id}>
                    <td className="font-medium">{l.memberName}</td>
                    <td className="capitalize text-muted-foreground">{String(l.loanType ?? l.type).replace("_", " ")}</td>
                    <td className="text-right font-mono">{formatUGX(l.amount ?? l.principal ?? 0)}</td>
                    <td><StatusBadge status={l.status} /></td>
                    <td className="text-muted-foreground">{formatDate(l.createdAt ?? l.appliedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border bg-card p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Awaiting decision</h2>
              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                {pendingApproval.length}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Loans waiting for guarantor or admin approval.
            </p>
            <ul className="mt-4 space-y-3">
              {pendingApproval.slice(0, 4).map((l) => {
                const member = members.data?.find((m) => m.id === l.memberId);
                return (
                  <li key={l.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{member?.name ?? "Unknown"}</p>
                      <p className="truncate text-xs text-muted-foreground">{formatUGX(l.amount)} · {l.duration} mo</p>
                    </div>
                    <StatusBadge status={l.status} />
                  </li>
                );
              })}
              {pendingApproval.length === 0 && (
                <li className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AlertTriangle className="h-4 w-4" /> Nothing awaiting decision.
                </li>
              )}
            </ul>
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-soft">
            <h2 className="text-base font-semibold">Operating expenses</h2>
            <p className="mt-1 text-xs text-muted-foreground">Running total this period</p>
            <p className="mt-3 text-2xl font-semibold">{formatUGX(totalExpenses)}</p>
            <Button variant="outline" size="sm" className="mt-4 w-full" asChild>
              <Link to="/app/admin/expenses">Manage expenses</Link>
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
