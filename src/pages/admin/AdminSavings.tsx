import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Wallet, Users, Calendar, Search, Layers } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { queryKeys, useMembers, useSavings } from "@/hooks/data";
import { formatDate, formatMonth, formatNumber, formatUGX } from "@/lib/format";
import { savingsService } from "@/services";
import type { Savings } from "@/lib/types";

const ALL = "all";

export default function AdminSavings() {
  const members = useMembers();
  const savings = useSavings();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [yearFilter, setYearFilter] = useState<string>(ALL);
  const [monthFilter, setMonthFilter] = useState<string>(ALL);
  const [memberFilter, setMemberFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");

  // Single-entry dialog
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    memberId: "",
    amount: "",
    month: monthDefault(),
    paidAt: isoDateInput(new Date().toISOString()),
  });

  // Batch entry
  const [batchMonth, setBatchMonth] = useState(monthDefault());
  const [batchPaidAt, setBatchPaidAt] = useState(isoDateInput(new Date().toISOString()));
  const [batchDefaultAmount, setBatchDefaultAmount] = useState("100000");
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchAmounts, setBatchAmounts] = useState<Record<string, string>>({});

  const records = savings.data ?? [];

  const years = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => set.add(String(r.month).slice(0, 4)));
    return Array.from(set).sort((a, b) => String(b).localeCompare(String(a)));
  }, [records]);

  const months = monthOptions();

  const filtered = useMemo(() => {
    return records
      .filter((r) => {
        const [y, m] = String(r.month).split("-");
        if (yearFilter !== ALL && y !== yearFilter) return false;
        if (monthFilter !== ALL && m !== monthFilter) return false;
        if (memberFilter !== ALL && r.memberId !== memberFilter) return false;
        if (search) {
          const member = members.data?.find((mm) => mm.id === r.memberId);
          const q = search.toLowerCase();
          if (!member?.name.toLowerCase().includes(q) && !String(r.amount).includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => String(b.month).localeCompare(String(a.month)));
  }, [records, yearFilter, monthFilter, memberFilter, search, members.data]);

  const totalAll = useMemo(() => records.reduce((a, s) => a + s.amount, 0), [records]);
  const totalFiltered = useMemo(() => filtered.reduce((a, s) => a + s.amount, 0), [filtered]);
  const ytdTotal = useMemo(() => {
    const y = String(new Date().getFullYear());
    return records.filter((r) => String(r.month).startsWith(y)).reduce((a, s) => a + s.amount, 0);
  }, [records]);
  const contributorCount = useMemo(() => new Set(records.map((r) => r.memberId)).size, [records]);
  const batchTotal = useMemo(
    () =>
      Array.from(batchSelected).reduce((sum, memberId) => {
        const amount = Number(batchAmounts[memberId] ?? 0);
        return sum + (Number.isFinite(amount) ? amount : 0);
      }, 0),
    [batchAmounts, batchSelected],
  );

  const handleSubmit = async () => {
    if (!form.memberId || !form.amount || !form.month) {
      toast({ title: "Missing fields", description: "Pick a member, enter an amount and month.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await savingsService.add({
        memberId: form.memberId,
        amount: Number(form.amount),
        month: form.month,
        paidAt: new Date(`${form.paidAt}T00:00:00`).toISOString(),
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.savings }),
        qc.invalidateQueries({ queryKey: queryKeys.savingsByMember(form.memberId) }),
      ]);
      toast({ title: "Contribution recorded", description: `${formatNumber(Number(form.amount))} for ${formatMonth(form.month)}.` });
      setOpen(false);
      setForm({
        memberId: "",
        amount: "",
        month: monthDefault(),
        paidAt: isoDateInput(new Date().toISOString()),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "We couldn't save that contribution.";
      toast({
        title: "Save failed",
        description: message.includes("duplicate_period")
          ? "That member already has a savings entry for the selected month."
          : message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const ensureBatchAmount = (memberId: string) => {
    setBatchAmounts((current) => (
      current[memberId] !== undefined
        ? current
        : { ...current, [memberId]: batchDefaultAmount }
    ));
  };

  const toggleBatchMember = (memberId: string, checked: boolean) => {
    setBatchSelected((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(memberId);
      } else {
        next.delete(memberId);
      }
      return next;
    });

    if (checked) ensureBatchAmount(memberId);
  };

  const selectAllBatchMembers = () => {
    const allIds = members.data?.map((m) => m.id) ?? [];
    setBatchSelected(new Set(allIds));
    setBatchAmounts((current) => {
      const next = { ...current };
      allIds.forEach((memberId) => {
        if (next[memberId] === undefined) next[memberId] = batchDefaultAmount;
      });
      return next;
    });
  };

  const clearBatchMembers = () => {
    setBatchSelected(new Set());
    setBatchAmounts({});
  };

  const handleBatch = async () => {
    if (batchSelected.size === 0) {
      toast({ title: "Nothing to record", description: "Pick at least one member.", variant: "destructive" });
      return;
    }

    const entries = Array.from(batchSelected)
      .map((memberId) => ({
        memberId,
        amount: Number(batchAmounts[memberId] ?? 0),
      }))
      .filter((entry) => entry.amount > 0);

    if (entries.length !== batchSelected.size) {
      toast({
        title: "Missing amounts",
        description: "Enter a valid amount for every selected member.",
        variant: "destructive",
      });
      return;
    }

    try {
      const created = await savingsService.batchAdd(
        entries.map((entry) => ({
          memberId: entry.memberId,
          amount: entry.amount,
          month: batchMonth,
          paidAt: new Date(`${batchPaidAt}T00:00:00`).toISOString(),
        })),
      );
      await qc.invalidateQueries({ queryKey: queryKeys.savings });
      await Promise.all(entries.map((entry) => qc.invalidateQueries({ queryKey: queryKeys.savingsByMember(entry.memberId) })));

      toast({
        title: "Batch contributions recorded",
        description:
          created.length === entries.length
            ? `${entries.length} members, total ${formatNumber(batchTotal)} for ${formatMonth(batchMonth)}.`
            : `${created.length} new entries saved for ${formatMonth(batchMonth)}. ${entries.length - created.length} already existed and were skipped.`,
      });
      clearBatchMembers();
    } catch (error) {
      const message = error instanceof Error ? error.message : "We couldn't post the batch entries.";
      toast({
        title: "Batch save failed",
        description: message.includes("duplicate_period")
          ? "One or more selected members already have a savings entry for that month."
          : message,
        variant: "destructive",
      });
    }
  };

  const memberName = (id: string) => members.data?.find((m) => m.id === id)?.name ?? "-";

  return (
    <>
      <PageHeader
        title="Savings"
        description="Record contributions, run batch postings and audit the savings ledger."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-4 w-4" /> Record contribution</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record a contribution</DialogTitle>
                <DialogDescription>Posts a single member's monthly savings entry.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-2">
                  <Label>Member</Label>
                  <Select value={form.memberId} onValueChange={(v) => setForm({ ...form, memberId: v })}>
                    <SelectTrigger><SelectValue placeholder="Choose a member" /></SelectTrigger>
                    <SelectContent>
                      {members.data?.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Month</Label>
                  <Input type="month" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Amount (UGX)</Label>
                  <Input inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d]/g, "") })} />
                </div>
                <div className="grid gap-2">
                  <Label>Payment date</Label>
                  <Input type="date" value={form.paidAt} onChange={(e) => setForm({ ...form, paidAt: e.target.value })} />
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
        <KpiCard label="Total savings" value={formatNumber(totalAll)} icon={Wallet} accent="primary" loading={savings.isLoading} hint={`${records.length} entries`} />
        <KpiCard label="This year" value={formatNumber(ytdTotal)} icon={Calendar} accent="success" loading={savings.isLoading} hint={String(new Date().getFullYear())} />
        <KpiCard label="Contributors" value={String(contributorCount)} icon={Users} accent="info" loading={savings.isLoading} />
        <KpiCard label="Filtered total" value={formatNumber(totalFiltered)} icon={Wallet} accent="warning" loading={savings.isLoading} hint={`${filtered.length} records`} />
      </div>

      <Tabs defaultValue="ledger" className="mt-6">
        <TabsList>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="batch"><Layers className="mr-1 h-4 w-4" /> Batch entry</TabsTrigger>
        </TabsList>

        <TabsContent value="ledger" className="mt-4">
          <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)]">
            <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
              <div className="relative w-full md:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search by member or amount" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={memberFilter} onValueChange={setMemberFilter}>
                  <SelectTrigger className="w-[180px]"><SelectValue placeholder="Member" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All members</SelectItem>
                    {members.data?.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={yearFilter} onValueChange={setYearFilter}>
                  <SelectTrigger className="w-[120px]"><SelectValue placeholder="Year" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All years</SelectItem>
                    {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={monthFilter} onValueChange={setMonthFilter}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Month" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All months</SelectItem>
                    {months.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Month</th>
                    <th className="text-right">Amount</th>
                    <th>Status</th>
                    <th>Paid</th>
                    <th>Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {savings.isLoading && Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td><Skeleton className="h-4 w-40" /></td>
                      <td><Skeleton className="h-4 w-24" /></td>
                      <td className="text-right"><Skeleton className="ml-auto h-4 w-20" /></td>
                      <td><Skeleton className="h-5 w-16" /></td>
                      <td><Skeleton className="h-4 w-24" /></td>
                      <td><Skeleton className="h-4 w-24" /></td>
                    </tr>
                  ))}
                  {!savings.isLoading && filtered.slice(0, 100).map((s) => (
                    <tr key={s.id}>
                      <td className="font-medium">{memberName(s.memberId)}</td>
                      <td>{formatMonth(s.month)}</td>
                      <td className="text-right font-mono">{formatNumber(s.amount)}</td>
                      <td><StatusBadge status={s.status ?? "paid"} /></td>
                      <td className="text-muted-foreground">{formatDate(s.paidAt ?? s.createdAt)}</td>
                      <td className="text-muted-foreground">{formatDate(s.createdAt)}</td>
                    </tr>
                  ))}
                  {!savings.isLoading && filtered.length === 0 && (
                    <tr><td colSpan={6} className="py-12">
                      <EmptyState title="No contributions match" description="Adjust the filters to see more entries." />
                    </td></tr>
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot>
                    <tr className="border-t bg-muted/30 font-medium">
                      <td colSpan={2}>Total{filtered.length > 100 ? " (showing first 100)" : ""}</td>
                      <td className="text-right font-mono">{formatNumber(totalFiltered)}</td>
                      <td colSpan={3} className="text-muted-foreground">{filtered.length} records</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="batch" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-sm)] lg:col-span-1">
              <h3 className="text-sm font-semibold">Batch settings</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Enter a specific amount for each selected member. Batch posting still runs through the Worker endpoint.
              </p>
              <div className="mt-4 grid gap-3">
                <div className="grid gap-2">
                  <Label>Month</Label>
                  <Input type="month" value={batchMonth} onChange={(e) => setBatchMonth(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>Payment date</Label>
                  <Input type="date" value={batchPaidAt} onChange={(e) => setBatchPaidAt(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>Default amount for new selections (UGX)</Label>
                  <Input inputMode="numeric" value={batchDefaultAmount} onChange={(e) => setBatchDefaultAmount(e.target.value.replace(/[^\d]/g, ""))} />
                  <p className="text-xs text-muted-foreground">
                    Used to prefill the amount when you check a member. You can edit every member after selection.
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Selected</span><span className="font-medium">{batchSelected.size}</span></div>
                  <div className="mt-1 flex justify-between"><span className="text-muted-foreground">Total to post</span><span className="font-mono font-medium">{formatNumber(batchTotal)}</span></div>
                </div>
                <Button onClick={handleBatch} disabled={batchSelected.size === 0}>Post batch</Button>
              </div>
            </div>
            <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)] lg:col-span-2">
              <div className="flex items-center justify-between border-b p-4">
                <h3 className="text-sm font-semibold">Members</h3>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={selectAllBatchMembers}>Select all</Button>
                  <Button variant="ghost" size="sm" onClick={clearBatchMembers}>Clear</Button>
                </div>
              </div>
              <ScrollArea className="h-[420px]">
                <ul className="divide-y">
                  {members.data?.map((m) => {
                    const checked = batchSelected.has(m.id);
                    return (
                      <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                        <Checkbox
                          id={`b_${m.id}`}
                          checked={checked}
                          onCheckedChange={(v) => toggleBatchMember(m.id, Boolean(v))}
                        />
                        <div className="flex flex-1 items-center gap-3">
                          <Label htmlFor={`b_${m.id}`} className="min-w-0 flex-1 cursor-pointer">
                            <span className="font-medium">{m.name}</span>
                            <span className="ml-2 font-mono text-xs text-muted-foreground">{m.membershipNumber}</span>
                          </Label>
                          <div className="w-40">
                            <Input
                              inputMode="numeric"
                              placeholder="Amount"
                              disabled={!checked}
                              value={batchAmounts[m.id] ?? ""}
                              onFocus={() => {
                                if (!checked) toggleBatchMember(m.id, true);
                              }}
                              onChange={(e) => {
                                const value = e.target.value.replace(/[^\d]/g, "");
                                if (!checked) toggleBatchMember(m.id, true);
                                setBatchAmounts((current) => ({ ...current, [m.id]: value }));
                              }}
                            />
                          </div>
                          <div className="w-24 text-right text-xs text-muted-foreground">
                            {checked && batchAmounts[m.id]
                              ? formatNumber(Number(batchAmounts[m.id] ?? 0))
                              : ""}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}

function monthDefault() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function isoDateInput(input: string) {
  return input.slice(0, 10);
}
function monthOptions() {
  return [
    { v: "01", l: "January" }, { v: "02", l: "February" }, { v: "03", l: "March" },
    { v: "04", l: "April" }, { v: "05", l: "May" }, { v: "06", l: "June" },
    { v: "07", l: "July" }, { v: "08", l: "August" }, { v: "09", l: "September" },
    { v: "10", l: "October" }, { v: "11", l: "November" }, { v: "12", l: "December" },
  ];
}
