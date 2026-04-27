import { useMemo, useState } from "react";
import { Plus, TrendingUp, ArrowDownToLine, ArrowUpFromLine, Coins } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
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
import { useToast } from "@/hooks/use-toast";
import { useUnitTrust } from "@/hooks/data";
import { formatDate, formatUGX } from "@/lib/format";
import type { UnitTrust } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function AdminUnitTrust() {
  const trust = useUnitTrust();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<{ type: UnitTrust["type"]; amount: string; description: string; date: string }>({
    type: "deposit",
    amount: "",
    description: "",
    date: new Date().toISOString().slice(0, 10),
  });

  const list = useMemo(
    () => [...(trust.data ?? [])].sort((a, b) => b.date.localeCompare(a.date)),
    [trust.data],
  );

  const totals = useMemo(() => {
    const deposits = list.filter((t) => t.type === "deposit").reduce((a, t) => a + t.amount, 0);
    const withdrawals = list.filter((t) => t.type === "withdrawal").reduce((a, t) => a + t.amount, 0);
    const interest = list.filter((t) => t.type === "interest").reduce((a, t) => a + t.amount, 0);
    return { deposits, withdrawals, interest, balance: deposits - withdrawals + interest };
  }, [list]);

  // Compute running balance (oldest -> newest)
  const withRunning = useMemo(() => {
    const ordered = [...list].reverse();
    let bal = 0;
    const map = new Map<string, number>();
    ordered.forEach((t) => {
      bal += t.type === "withdrawal" ? -t.amount : t.amount;
      map.set(t.id, bal);
    });
    return map;
  }, [list]);

  const handleSubmit = async () => {
    const amount = Number(form.amount);
    if (!amount) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      toast({ title: "Entry recorded", description: `${form.type} · ${formatUGX(amount)}` });
      setOpen(false);
      setForm({ type: "deposit", amount: "", description: "", date: new Date().toISOString().slice(0, 10) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Unit Trust"
        description="Manage placements, withdrawals and accrued interest."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-4 w-4" /> New entry</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add unit trust entry</DialogTitle>
                <DialogDescription>Record a deposit, withdrawal, or interest accrual.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as UnitTrust["type"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="deposit">Deposit</SelectItem>
                      <SelectItem value="withdrawal">Withdrawal</SelectItem>
                      <SelectItem value="interest">Interest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Amount (UGX)</Label>
                  <Input inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d]/g, "") })} />
                </div>
                <div className="grid gap-2">
                  <Label>Date</Label>
                  <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Description</Label>
                  <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Saving..." : "Save"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Balance" value={formatUGX(totals.balance, { compact: true })} icon={Coins} accent="primary" loading={trust.isLoading} />
        <KpiCard label="Deposits" value={formatUGX(totals.deposits, { compact: true })} icon={ArrowDownToLine} accent="success" loading={trust.isLoading} />
        <KpiCard label="Withdrawals" value={formatUGX(totals.withdrawals, { compact: true })} icon={ArrowUpFromLine} accent="warning" loading={trust.isLoading} />
        <KpiCard label="Interest earned" value={formatUGX(totals.interest, { compact: true })} icon={TrendingUp} accent="info" loading={trust.isLoading} />
      </div>

      <div className="mt-6 rounded-xl border bg-card shadow-[var(--shadow-sm)]">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Description</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Running balance</th>
              </tr>
            </thead>
            <tbody>
              {trust.isLoading && Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 5 }).map((__, j) => <td key={j}><Skeleton className="h-4 w-24" /></td>)}</tr>
              ))}
              {!trust.isLoading && list.map((t) => (
                <tr key={t.id}>
                  <td className="text-muted-foreground">{formatDate(t.date)}</td>
                  <td>
                    <span className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
                      t.type === "deposit" && "bg-success/10 text-success border-success/20",
                      t.type === "withdrawal" && "bg-warning/15 text-warning border-warning/20",
                      t.type === "interest" && "bg-info/10 text-info border-info/20",
                    )}>{t.type}</span>
                  </td>
                  <td>{t.description ?? "—"}</td>
                  <td className={cn("text-right font-mono", t.type === "withdrawal" && "text-warning")}>
                    {t.type === "withdrawal" ? "−" : "+"}{formatUGX(t.amount)}
                  </td>
                  <td className="text-right font-mono font-medium">{formatUGX(withRunning.get(t.id) ?? 0)}</td>
                </tr>
              ))}
              {!trust.isLoading && list.length === 0 && (
                <tr><td colSpan={5} className="py-12"><EmptyState title="No unit trust activity" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
