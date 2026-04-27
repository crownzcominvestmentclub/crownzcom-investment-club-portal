import { useMemo, useState } from "react";
import { Banknote, Clock, CheckCircle2, AlertTriangle, Search, Eye, Check, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  useLoans, useMembers, useLoanRepayments, useLoanCharges, useLoanGuarantors,
} from "@/hooks/data";
import { formatDate, formatMonth, formatUGX } from "@/lib/format";
import type { Loan, LoanStatus } from "@/lib/types";

const ALL = "all";

export default function AdminLoans() {
  const loans = useLoans();
  const members = useMembers();
  const repayments = useLoanRepayments();
  const charges = useLoanCharges();
  const guarantors = useLoanGuarantors();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [selected, setSelected] = useState<Loan | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const list = loans.data ?? [];

  const stats = useMemo(() => {
    const active = list.filter((l) => l.status === "active");
    const pending = list.filter((l) => l.status.startsWith("pending"));
    const failed = list.filter((l) => l.status === "guarantor_coverage_failed" || l.status === "rejected");
    return {
      portfolio: list.reduce((a, l) => a + l.amount, 0),
      outstanding: active.reduce((a, l) => a + l.balance, 0),
      pending: pending.length,
      failed: failed.length,
      active: active.length,
    };
  }, [list]);

  const filtered = useMemo(() => {
    return list.filter((l) => {
      if (statusFilter !== ALL && l.status !== statusFilter) return false;
      if (typeFilter !== ALL && l.loanType !== typeFilter) return false;
      if (search) {
        const m = members.data?.find((mm) => mm.id === l.memberId);
        const q = search.toLowerCase();
        if (!m?.name.toLowerCase().includes(q) && !l.id.toLowerCase().includes(q)) return false;
      }
      return true;
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [list, statusFilter, typeFilter, search, members.data]);

  const memberName = (id: string) => members.data?.find((m) => m.id === id)?.name ?? "—";

  const handleApprove = (loan: Loan) => {
    toast({ title: "Loan approved", description: `${memberName(loan.memberId)} — ${formatUGX(loan.amount)} approved.` });
    setSelected(null);
  };
  const handleReject = (loan: Loan) => {
    if (!rejectReason.trim()) {
      toast({ title: "Reason required", description: "Provide a reason for rejection.", variant: "destructive" });
      return;
    }
    toast({ title: "Loan rejected", description: rejectReason });
    setRejectOpen(false);
    setRejectReason("");
    setSelected(null);
  };

  const loanRepayments = (id: string) => repayments.data?.filter((r) => r.loanId === id) ?? [];
  const loanCharges = (id: string) => charges.data?.filter((c) => c.loanId === id) ?? [];
  const loanGuarantors = (id: string) => guarantors.data?.filter((g) => g.loanId === id) ?? [];

  return (
    <>
      <PageHeader
        title="Loans"
        description="Approve applications, track outstanding balances and manage repayments and charges."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Portfolio value" value={formatUGX(stats.portfolio, { compact: true })} icon={Banknote} accent="primary" loading={loans.isLoading} hint={`${list.length} loans`} />
        <KpiCard label="Outstanding" value={formatUGX(stats.outstanding, { compact: true })} icon={CheckCircle2} accent="success" loading={loans.isLoading} hint={`${stats.active} active`} />
        <KpiCard label="Awaiting decision" value={String(stats.pending)} icon={Clock} accent="warning" loading={loans.isLoading} />
        <KpiCard label="Failed / rejected" value={String(stats.failed)} icon={AlertTriangle} accent="info" loading={loans.isLoading} />
      </div>

      <div className="mt-6 rounded-xl border bg-card shadow-[var(--shadow-sm)]">
        <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search by member or loan ID" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                <SelectItem value="short_term">Short term</SelectItem>
                <SelectItem value="long_term">Long term</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                <SelectItem value="pending_admin_approval">Pending admin</SelectItem>
                <SelectItem value="pending_guarantor_approval">Pending guarantor</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="guarantor_coverage_failed">Coverage failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Type</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Balance</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Submitted</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loans.isLoading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 8 }).map((__, j) => (
                    <td key={j}><Skeleton className="h-4 w-20" /></td>
                  ))}
                </tr>
              ))}
              {!loans.isLoading && filtered.map((l) => (
                <tr key={l.id}>
                  <td className="font-medium">{memberName(l.memberId)}</td>
                  <td className="text-muted-foreground capitalize">{l.loanType.replace("_", " ")}</td>
                  <td className="text-right font-mono">{formatUGX(l.amount)}</td>
                  <td className="text-right font-mono">{formatUGX(l.balance)}</td>
                  <td className="text-muted-foreground">{l.duration} mo</td>
                  <td><StatusBadge status={l.status as LoanStatus} /></td>
                  <td className="text-muted-foreground">{formatDate(l.createdAt)}</td>
                  <td className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setSelected(l)}>
                      <Eye className="mr-1 h-4 w-4" /> View
                    </Button>
                  </td>
                </tr>
              ))}
              {!loans.isLoading && filtered.length === 0 && (
                <tr><td colSpan={8} className="py-12">
                  <EmptyState title="No loans match your filters" />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{memberName(selected.memberId)}</SheetTitle>
                <SheetDescription className="capitalize">
                  {selected.loanType.replace("_", " ")} loan · {formatUGX(selected.amount)} · {selected.duration} months
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <Stat label="Status"><StatusBadge status={selected.status as LoanStatus} /></Stat>
                <Stat label="Balance" value={formatUGX(selected.balance)} />
                <Stat label="Interest rate" value={`${selected.monthlyInterestRateApplied}% / mo`} />
                <Stat label="Mode" value={selected.interestCalculationModeApplied.replace("_", " ")} />
                <Stat label="Submitted" value={formatDate(selected.createdAt)} />
                <Stat label="Approved" value={selected.approvedAt ? formatDate(selected.approvedAt) : "—"} />
              </div>

              {selected.purpose && (
                <div className="mt-4 rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Purpose</p>
                  <p className="mt-1 text-sm">{selected.purpose}</p>
                </div>
              )}

              {selected.guarantorRequired && (
                <div className="mt-4">
                  <h4 className="text-sm font-semibold">Guarantors</h4>
                  <ul className="mt-2 space-y-2">
                    {loanGuarantors(selected.id).map((g) => (
                      <li key={g.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                        <div>
                          <p className="font-medium">{memberName(g.guarantorId)}</p>
                          <p className="text-xs text-muted-foreground">{formatUGX(g.guaranteedAmount)} guaranteed</p>
                        </div>
                        <StatusBadge status={g.status} />
                      </li>
                    ))}
                    {loanGuarantors(selected.id).length === 0 && (
                      <li className="text-sm text-muted-foreground">No guarantor records.</li>
                    )}
                  </ul>
                </div>
              )}

              <div className="mt-4">
                <h4 className="text-sm font-semibold">Repayments</h4>
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border">
                  <table className="data-table">
                    <thead>
                      <tr><th>Month</th><th className="text-right">Amount</th><th>Paid</th></tr>
                    </thead>
                    <tbody>
                      {loanRepayments(selected.id).map((r) => (
                        <tr key={r.id}>
                          <td>{formatMonth(r.month)}</td>
                          <td className="text-right font-mono">{formatUGX(r.amount)}</td>
                          <td className="text-muted-foreground">{formatDate(r.paidAt)}</td>
                        </tr>
                      ))}
                      {loanRepayments(selected.id).length === 0 && (
                        <tr><td colSpan={3} className="py-4 text-center text-sm text-muted-foreground">No repayments yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-4">
                <h4 className="text-sm font-semibold">Charges</h4>
                <ul className="mt-2 space-y-1">
                  {loanCharges(selected.id).map((c) => (
                    <li key={c.id} className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2 text-sm">
                      <span>{c.description}</span>
                      <span className="font-mono">{formatUGX(c.amount)}</span>
                    </li>
                  ))}
                  {loanCharges(selected.id).length === 0 && (
                    <li className="text-sm text-muted-foreground">No charges recorded.</li>
                  )}
                </ul>
              </div>

              {selected.status === "pending_admin_approval" && (
                <div className="mt-6 flex gap-2">
                  <Button className="flex-1" onClick={() => handleApprove(selected)}>
                    <Check className="mr-1 h-4 w-4" /> Approve
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => setRejectOpen(true)}>
                    <X className="mr-1 h-4 w-4" /> Reject
                  </Button>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject loan</DialogTitle>
            <DialogDescription>Provide a reason — this will be visible to the member.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" rows={4} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => selected && handleReject(selected)}>Reject loan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {children ? <div className="mt-1">{children}</div> : <p className="mt-1 font-medium">{value}</p>}
    </div>
  );
}
