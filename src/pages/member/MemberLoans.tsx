import { useMemo, useState } from "react";
import { Plus, Banknote, ShieldCheck, Wallet, Check, X, Eye } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  useEarlyRepaymentsByMember,
  useFinancialConfig, useLoanCharges, useLoanRepayments, useLoansByMember, useMembers,
  usePendingGuarantorRequests, useSavingsByMember, useLoanTermsDocument,
} from "@/hooks/data";
import { formatDate, formatMonth, formatUGX } from "@/lib/format";
import { groupLoanCharges } from "@/lib/repayment";
import type { Loan, LoanStatus, LoanType } from "@/lib/types";

export default function MemberLoans() {
  const { user } = useAuth();
  const memberId = user?.memberId;
  const { toast } = useToast();
  const loans = useLoansByMember(memberId);
  const repayments = useLoanRepayments();
  const charges = useLoanCharges();
  const savings = useSavingsByMember(memberId);
  const cfg = useFinancialConfig();
  const guarantorReqs = usePendingGuarantorRequests(memberId);
  const earlyRepayments = useEarlyRepaymentsByMember(memberId);
  const members = useMembers();
  const loanTermsDocument = useLoanTermsDocument();

  const [selected, setSelected] = useState<Loan | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    amount: "",
    duration: "6",
    loanType: "short_term" as LoanType,
    purpose: "",
    terms: false,
  });

  const list = loans.data ?? [];
  const totalSavings = useMemo(() => savings.data?.reduce((a, s) => a + s.amount, 0) ?? 0, [savings.data]);
  const eligibility = cfg.data ? Math.round((totalSavings * cfg.data.loanEligibilityPercentage) / 100) : 0;
  const active = list.filter((l) => l.status === "active");
  const outstanding = active.reduce((a, l) => a + l.balance, 0);
  const available = Math.max(0, eligibility - outstanding);

  const memberName = (id: string) => members.data?.find((m) => m.id === id)?.name ?? "—";
  const loanRepayments = (id: string) => repayments.data?.filter((r) => r.loanId === id) ?? [];
  const loanCharges = (id: string) => charges.data?.filter((charge) => charge.loanId === id) ?? [];
  const loanEarlyRepayments = (id: string) => earlyRepayments.data?.filter((request) => request.loanId === id) ?? [];

  const handleSubmit = async () => {
    const amount = Number(form.amount);
    if (!amount || !form.terms) {
      toast({ title: "Check your application", description: "Enter an amount and accept the terms.", variant: "destructive" });
      return;
    }
    if (cfg.data && (amount < cfg.data.minLoanAmount || amount > cfg.data.maxLoanAmount)) {
      toast({ title: "Out of range", description: `Allowed: ${formatUGX(cfg.data.minLoanAmount)} – ${formatUGX(cfg.data.maxLoanAmount)}`, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      toast({ title: "Application submitted", description: `${formatUGX(amount)} · ${form.duration} months. Awaiting approval.` });
      setOpen(false);
      setForm({ amount: "", duration: "6", loanType: "short_term", purpose: "", terms: false });
    } finally {
      setSubmitting(false);
    }
  };

  const handleGuarantorResponse = (decision: "approve" | "decline") => {
    toast({
      title: decision === "approve" ? "Guarantee approved" : "Guarantee declined",
      description: "Your response has been recorded.",
    });
  };

  if (!memberId) {
    return (
      <>
        <PageHeader title="My loans" />
        <EmptyState title="No member profile linked" description="An administrator can link your profile from the Members module." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="My loans"
        description="Apply for loans, track repayments and respond to guarantor requests."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-4 w-4" /> Apply for loan</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New loan application</DialogTitle>
                <DialogDescription>
                  Available credit: <strong>{formatUGX(available, { compact: true })}</strong>
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Loan type</Label>
                    <Select value={form.loanType} onValueChange={(v) => setForm({ ...form, loanType: v as LoanType })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="short_term">Short term</SelectItem>
                        <SelectItem value="long_term">Long term</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Duration (months)</Label>
                    <Input type="number" min={1} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Amount (UGX)</Label>
                  <Input inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d]/g, "") })} />
                  {cfg.data && (
                    <p className="text-xs text-muted-foreground">
                      Range: {formatUGX(cfg.data.minLoanAmount)} – {formatUGX(cfg.data.maxLoanAmount)} ·
                      {" "}{form.loanType === "long_term" ? cfg.data.longTermInterestRate : cfg.data.loanInterestRate}% / month
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label>Purpose</Label>
                  <Textarea rows={2} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={form.terms} onCheckedChange={(v) => setForm({ ...form, terms: !!v })} />
                  <span>
                    I accept the{" "}
                    {loanTermsDocument.data?.id ? (
                      <a
                        href={`/app/member/documents/${loanTermsDocument.data.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline underline-offset-4"
                      >
                        lending terms
                      </a>
                    ) : (
                      "lending terms"
                    )}{" "}
                    and authorise the deductions from my savings if needed.
                  </span>
                </label>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Submitting..." : "Submit application"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Eligibility" value={formatUGX(eligibility, { compact: true })} icon={Wallet} accent="primary" loading={savings.isLoading} hint={cfg.data ? `${cfg.data.loanEligibilityPercentage}% of savings` : ""} />
        <KpiCard label="Available credit" value={formatUGX(available, { compact: true })} icon={Banknote} accent="success" loading={loans.isLoading} />
        <KpiCard label="Outstanding" value={formatUGX(outstanding, { compact: true })} icon={Banknote} accent="warning" loading={loans.isLoading} hint={`${active.length} active`} />
        <KpiCard label="Guarantor requests" value={String(guarantorReqs.data?.length ?? 0)} icon={ShieldCheck} accent="info" loading={guarantorReqs.isLoading} hint="Pending action" />
      </div>

      <Tabs defaultValue="my" className="mt-6">
        <TabsList>
          <TabsTrigger value="my">My loans</TabsTrigger>
          <TabsTrigger value="guarantor">
            Guarantor requests {guarantorReqs.data && guarantorReqs.data.length > 0 && (
              <span className="ml-1 rounded-full bg-warning/20 px-1.5 text-xs text-warning">{guarantorReqs.data.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="my" className="mt-4">
          <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)]">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Balance</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {loans.isLoading && Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 7 }).map((__, j) => <td key={j}><Skeleton className="h-4 w-20" /></td>)}</tr>
                  ))}
                  {!loans.isLoading && list.map((l) => (
                    <tr key={l.id}>
                      <td className="capitalize">{l.loanType.replace("_", " ")}</td>
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
                  {!loans.isLoading && list.length === 0 && (
                    <tr><td colSpan={7} className="py-12">
                      <EmptyState title="No loans yet" description="Apply for your first loan using the button above." />
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="guarantor" className="mt-4">
          <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)]">
            {guarantorReqs.isLoading && <div className="p-6"><Skeleton className="h-24 w-full" /></div>}
            {!guarantorReqs.isLoading && (guarantorReqs.data?.length ?? 0) === 0 && (
              <div className="p-6">
                <EmptyState title="No pending requests" description="You'll see guarantor requests from other members here." icon={ShieldCheck} />
              </div>
            )}
            {!guarantorReqs.isLoading && guarantorReqs.data?.map((g) => (
              <div key={g.id} className="flex flex-col gap-3 border-b p-5 last:border-b-0 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold">{memberName(g.borrowerId)} requests your guarantee</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatUGX(g.guaranteedAmount)} · loan {g.loanId} · requested {formatDate(g.requestedAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleGuarantorResponse("approve")}>
                    <Check className="mr-1 h-4 w-4" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleGuarantorResponse("decline")}>
                    <X className="mr-1 h-4 w-4" /> Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="capitalize">{selected.loanType.replace("_", " ")} loan</SheetTitle>
                <SheetDescription>
                  {formatUGX(selected.amount)} · {selected.duration} months · <StatusBadge status={selected.status as LoanStatus} />
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Balance</p><p className="mt-1 font-medium">{formatUGX(selected.balance)}</p></div>
                <div className="rounded-lg border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Rate</p><p className="mt-1 font-medium">{selected.monthlyInterestRateApplied}% / mo</p></div>
                <div className="rounded-lg border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Submitted</p><p className="mt-1 font-medium">{formatDate(selected.createdAt)}</p></div>
                <div className="rounded-lg border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Approved</p><p className="mt-1 font-medium">{selected.approvedAt ? formatDate(selected.approvedAt) : "—"}</p></div>
              </div>
              {selected.purpose && (
                <div className="mt-4 rounded-lg border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Purpose</p><p className="mt-1 text-sm">{selected.purpose}</p></div>
              )}
              <div className="mt-4">
                <h4 className="text-sm font-semibold">Repayment schedule</h4>
                <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border">
                  <table className="data-table">
                    <thead><tr><th>Month</th><th className="text-right">Total</th><th className="text-right">Principal</th><th className="text-right">Interest</th><th className="text-right">Balance</th><th>Status</th></tr></thead>
                    <tbody>
                      {selected.repaymentPlan?.map((item) => (
                        <tr key={`${selected.id}-${item.month}`}>
                          <td>{formatMonth(item.month)}</td>
                          <td className="text-right font-mono">{formatUGX(item.total)}</td>
                          <td className="text-right font-mono">{formatUGX(item.principal)}</td>
                          <td className="text-right font-mono">{formatUGX(item.interest)}</td>
                          <td className="text-right font-mono">{formatUGX(item.balance)}</td>
                          <td><StatusBadge status={item.status} /></td>
                        </tr>
                      ))}
                      {(!selected.repaymentPlan || selected.repaymentPlan.length === 0) && (
                        <tr><td colSpan={6} className="py-4 text-center text-sm text-muted-foreground">No repayment schedule available.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="mt-4">
                <h4 className="text-sm font-semibold">Recorded repayments</h4>
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border">
                  <table className="data-table">
                    <thead><tr><th>Month</th><th className="text-right">Amount</th><th>Paid</th><th>Status</th></tr></thead>
                    <tbody>
                      {loanRepayments(selected.id).map((r) => (
                        <tr key={r.id}>
                          <td>{formatMonth(r.month)}</td>
                          <td className="text-right font-mono">{formatUGX(r.amount)}</td>
                          <td className="text-muted-foreground">{formatDate(r.paidAt)}</td>
                          <td><StatusBadge status={r.paymentStatus} /></td>
                        </tr>
                      ))}
                      {loanRepayments(selected.id).length === 0 && (
                        <tr><td colSpan={4} className="py-4 text-center text-sm text-muted-foreground">No repayments yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="mt-4">
                <h4 className="text-sm font-semibold">Charges</h4>
                <div className="mt-2 space-y-3">
                  {groupLoanCharges(loanCharges(selected.id), selected).map((group) => (
                    <div key={group.key} className="rounded-lg border">
                      <div className="border-b bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">{group.label}</div>
                      <div className="divide-y">
                        {group.charges.map((charge) => (
                          <div key={charge.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                            <div>
                              <p className="font-medium">{charge.description}</p>
                              <p className="text-xs text-muted-foreground">{formatDate(charge.createdAt)}</p>
                            </div>
                            <p className="font-mono">{formatUGX(charge.amount)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {loanCharges(selected.id).length === 0 && (
                    <div className="rounded-lg border px-3 py-4 text-center text-sm text-muted-foreground">No charges recorded.</div>
                  )}
                </div>
              </div>
              <div className="mt-4">
                <h4 className="text-sm font-semibold">Early repayment requests</h4>
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border">
                  <table className="data-table">
                    <thead><tr><th>Requested</th><th className="text-right">Amount</th><th>Status</th><th>For date</th></tr></thead>
                    <tbody>
                      {loanEarlyRepayments(selected.id).map((request) => (
                        <tr key={request.id}>
                          <td>{formatDate(request.requestedAt)}</td>
                          <td className="text-right font-mono">{formatUGX(request.amount)}</td>
                          <td><StatusBadge status={request.status} /></td>
                          <td className="text-muted-foreground">{request.requestedForDate ? formatDate(request.requestedForDate) : "—"}</td>
                        </tr>
                      ))}
                      {loanEarlyRepayments(selected.id).length === 0 && (
                        <tr><td colSpan={4} className="py-4 text-center text-sm text-muted-foreground">No early repayment requests yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
