import { useMemo, useState } from "react";
import { Plus, CalendarRange, Users, CheckCircle2, AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useMembers, useSubscriptions } from "@/hooks/data";
import { formatDate, formatUGX } from "@/lib/format";

export default function AdminSubscriptions() {
  const subs = useSubscriptions();
  const members = useMembers();
  const { toast } = useToast();

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<string>(String(currentYear));
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ memberId: "", amount: "50000", year: String(currentYear) });

  const years = useMemo(() => {
    const set = new Set<string>();
    subs.data?.forEach((s) => set.add(s.month.slice(0, 4)));
    set.add(String(currentYear));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [subs.data, currentYear]);

  const yearSubs = useMemo(
    () => subs.data?.filter((s) => s.month.startsWith(`${year}-`)) ?? [],
    [subs.data, year],
  );

  const paidMemberIds = useMemo(() => new Set(yearSubs.map((s) => s.memberId)), [yearSubs]);

  const totalCollected = yearSubs.reduce((a, s) => a + s.amount, 0);
  const expected = (members.data?.filter((m) => m.status === "active").length ?? 0) * 50000;
  const outstanding = Math.max(0, expected - totalCollected);

  const rows = useMemo(() => {
    return (members.data ?? []).map((m) => {
      const sub = yearSubs.find((s) => s.memberId === m.id);
      return { member: m, sub };
    });
  }, [members.data, yearSubs]);

  const handleSubmit = async () => {
    if (!form.memberId || !form.amount) {
      toast({ title: "Missing fields", description: "Pick a member and enter an amount.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      toast({ title: "Subscription recorded", description: `${formatUGX(Number(form.amount))} for ${form.year}.` });
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Track annual member subscriptions and identify outstanding balances."
        actions={
          <div className="flex gap-2">
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="mr-1 h-4 w-4" /> Record subscription</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Record subscription</DialogTitle>
                  <DialogDescription>Posts an annual subscription payment for a member.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="grid gap-2">
                    <Label>Member</Label>
                    <Select value={form.memberId} onValueChange={(v) => setForm({ ...form, memberId: v })}>
                      <SelectTrigger><SelectValue placeholder="Choose a member" /></SelectTrigger>
                      <SelectContent>
                        {members.data?.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Year</Label>
                    <Select value={form.year} onValueChange={(v) => setForm({ ...form, year: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Amount (UGX)</Label>
                    <Input inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d]/g, "") })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
                  <Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Saving..." : "Save"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Year" value={year} icon={CalendarRange} accent="primary" />
        <KpiCard label="Paid members" value={`${paidMemberIds.size} / ${members.data?.length ?? 0}`} icon={CheckCircle2} accent="success" loading={subs.isLoading} />
        <KpiCard label="Collected" value={formatUGX(totalCollected, { compact: true })} icon={Users} accent="info" loading={subs.isLoading} />
        <KpiCard label="Outstanding (est.)" value={formatUGX(outstanding, { compact: true })} icon={AlertCircle} accent="warning" loading={subs.isLoading} />
      </div>

      <div className="mt-6 rounded-xl border bg-card shadow-[var(--shadow-sm)]">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Membership #</th>
                <th>Status ({year})</th>
                <th className="text-right">Amount</th>
                <th>Paid on</th>
              </tr>
            </thead>
            <tbody>
              {(members.isLoading || subs.isLoading) && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 5 }).map((__, j) => <td key={j}><Skeleton className="h-4 w-24" /></td>)}</tr>
              ))}
              {!members.isLoading && rows.map(({ member, sub }) => (
                <tr key={member.id}>
                  <td className="font-medium">{member.name}</td>
                  <td className="font-mono text-xs text-muted-foreground">{member.membershipNumber}</td>
                  <td>{sub ? <StatusBadge status="paid" /> : <StatusBadge status="pending" />}</td>
                  <td className="text-right font-mono">{sub ? formatUGX(sub.amount) : "—"}</td>
                  <td className="text-muted-foreground">{sub ? formatDate(sub.createdAt) : "—"}</td>
                </tr>
              ))}
              {!members.isLoading && rows.length === 0 && (
                <tr><td colSpan={5} className="py-12"><EmptyState title="No members yet" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
