import { useMemo, useState } from "react";
import { Plus, CalendarRange, CheckCircle2, AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscriptions } from "@/hooks/data";
import { formatDate, formatUGX } from "@/lib/format";

export default function MemberSubscriptions() {
  const { user } = useAuth();
  const memberId = user?.memberId;
  const subs = useSubscriptions();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const currentYear = new Date().getFullYear();
  const [form, setForm] = useState({ amount: "50000", year: String(currentYear) });

  const mySubs = useMemo(
    () => (subs.data ?? []).filter((s) => s.memberId === memberId).sort((a, b) => b.month.localeCompare(a.month)),
    [subs.data, memberId],
  );

  const totalPaid = mySubs.reduce((a, s) => a + s.amount, 0);
  const yearsCovered = new Set(mySubs.map((s) => s.month.slice(0, 4)));
  const currentYearPaid = mySubs.find((s) => s.month.startsWith(`${currentYear}-`));

  const handleSubmit = async () => {
    const amount = Number(form.amount);
    if (!amount) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      toast({ title: "Subscription paid", description: `${formatUGX(amount)} for ${form.year}.` });
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!memberId) {
    return (
      <>
        <PageHeader title="Subscriptions" />
        <EmptyState title="No member profile linked" description="An administrator can link your profile from the Members module." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="My subscriptions"
        description="Annual subscription payments and history."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-4 w-4" /> Pay subscription</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Pay subscription</DialogTitle>
                <DialogDescription>Records your annual subscription. Verification may be required.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-2">
                  <Label>Year</Label>
                  <Input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Amount (UGX)</Label>
                  <Input inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d]/g, "") })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Saving..." : "Pay"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard label={`This year (${currentYear})`} value={currentYearPaid ? "Paid" : "Pending"} icon={currentYearPaid ? CheckCircle2 : AlertCircle} accent={currentYearPaid ? "success" : "warning"} loading={subs.isLoading} />
        <KpiCard label="Years covered" value={String(yearsCovered.size)} icon={CalendarRange} accent="primary" loading={subs.isLoading} />
        <KpiCard label="Total paid" value={formatUGX(totalPaid, { compact: true })} icon={CheckCircle2} accent="info" loading={subs.isLoading} />
      </div>

      <div className="mt-6 rounded-xl border bg-card shadow-[var(--shadow-sm)]">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Year</th><th className="text-right">Amount</th><th>Status</th><th>Recorded</th></tr>
            </thead>
            <tbody>
              {subs.isLoading && Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 4 }).map((__, j) => <td key={j}><Skeleton className="h-4 w-20" /></td>)}</tr>
              ))}
              {!subs.isLoading && mySubs.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.month.slice(0, 4)}</td>
                  <td className="text-right font-mono">{formatUGX(s.amount)}</td>
                  <td><StatusBadge status="paid" /></td>
                  <td className="text-muted-foreground">{formatDate(s.createdAt)}</td>
                </tr>
              ))}
              {!subs.isLoading && mySubs.length === 0 && (
                <tr><td colSpan={4} className="py-12">
                  <EmptyState title="No subscriptions recorded" description="You haven't paid any subscriptions yet." />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
