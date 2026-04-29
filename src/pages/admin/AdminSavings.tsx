import { useMemo, useState } from "react";
import { Plus, Wallet, Users, Calendar, Search, Layers } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useMembers, useSavings } from "@/hooks/data";
import { formatDate, formatMonth, formatUGX } from "@/lib/format";

const ALL = "all";

export default function AdminSavings() {
  const members = useMembers();
  const savings = useSavings();
  const { toast } = useToast();

  const [yearFilter, setYearFilter] = useState<string>(ALL);
  const [monthFilter, setMonthFilter] = useState<string>(ALL);
  const [memberFilter, setMemberFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");

  // Single-entry dialog
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ memberId: "", amount: "", month: monthDefault() });

  // Batch entry
  const [batchMonth, setBatchMonth] = useState(monthDefault());
  const [batchAmount, setBatchAmount] = useState("100000");
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());

  const records = savings.data ?? [];

  const years = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => set.add(r.month.slice(0, 4)));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [records]);

  const months = monthOptions();

  const filtered = useMemo(() => {
    return records
      .filter((r) => {
        const [y, m] = r.month.split("-");
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
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [records, yearFilter, monthFilter, memberFilter, search, members.data]);

  const totalAll = useMemo(() => records.reduce((a, s) => a + s.amount, 0), [records]);
  const totalFiltered = useMemo(() => filtered.reduce((a, s) => a + s.amount, 0), [filtered]);
  const ytdTotal = useMemo(() => {
    const y = String(new Date().getFullYear());
    return records.filter((r) => r.month.startsWith(y)).reduce((a, s) => a + s.amount, 0);
  }, [records]);
  const contributorCount = useMemo(() => new Set(records.map((r) => r.memberId)).size, [records]);

  const handleSubmit = async () => {
    if (!form.memberId || !form.amount || !form.month) {
      toast({ title: "Missing fields", description: "Pick a member, enter an amount and month.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      toast({ title: "Contribution recorded", description: `${formatUGX(Number(form.amount))} for ${formatMonth(form.month)}.` });
      setOpen(false);
      setForm({ memberId: "", amount: "", month: monthDefault() });
    } finally {
      setSubmitting(false);
    }
  };

  const handleBatch = () => {
    const amount = Number(batchAmount);
    if (!amount || batchSelected.size === 0) {
      toast({ title: "Nothing to record", description: "Pick members and an amount.", variant: "destructive" });
      return;
    }
    toast({
      title: "Batch contributions queued",
      description: `${batchSelected.size} members × ${formatUGX(amount)} for ${formatMonth(batchMonth)}.`,
    });
    setBatchSelected(new Set());
  };

  const memberName = (id: string) => members.data?.find((m) => m.id === id)?.name ?? "—";

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
        <KpiCard label="Total savings" value={formatUGX(totalAll, { compact: true })} icon={Wallet} accent="primary" loading={savings.isLoading} hint={`${records.length} entries`} />
        <KpiCard label="This year" value={formatUGX(ytdTotal, { compact: true })} icon={Calendar} accent="success" loading={savings.isLoading} hint={String(new Date().getFullYear())} />
        <KpiCard label="Contributors" value={String(contributorCount)} icon={Users} accent="info" loading={savings.isLoading} />
        <KpiCard label="Filtered total" value={formatUGX(totalFiltered, { compact: true })} icon={Wallet} accent="warning" loading={savings.isLoading} hint={`${filtered.length} records`} />
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
                    <th>Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {savings.isLoading && Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td><Skeleton className="h-4 w-40" /></td>
                      <td><Skeleton className="h-4 w-24" /></td>
                      <td className="text-right"><Skeleton className="ml-auto h-4 w-20" /></td>
                      <td><Skeleton className="h-4 w-24" /></td>
                    </tr>
                  ))}
                  {!savings.isLoading && filtered.slice(0, 100).map((s) => (
                    <tr key={s.id}>
                      <td className="font-medium">{memberName(s.memberId)}</td>
                      <td>{formatMonth(s.month)}</td>
                      <td className="text-right font-mono">{formatUGX(s.amount)}</td>
                      <td className="text-muted-foreground">{formatDate(s.createdAt)}</td>
                    </tr>
                  ))}
                  {!savings.isLoading && filtered.length === 0 && (
                    <tr><td colSpan={4} className="py-12">
                      <EmptyState title="No contributions match" description="Adjust the filters to see more entries." />
                    </td></tr>
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot>
                    <tr className="border-t bg-muted/30 font-medium">
                      <td colSpan={2}>Total{filtered.length > 100 ? " (showing first 100)" : ""}</td>
                      <td className="text-right font-mono">{formatUGX(totalFiltered)}</td>
                      <td className="text-muted-foreground">{filtered.length} records</td>
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
                Apply the same amount to selected members. Server-authoritative; runs via Cloudflare Worker (POST /api/savings/batch).
              </p>
              <div className="mt-4 grid gap-3">
                <div className="grid gap-2">
                  <Label>Month</Label>
                  <Input type="month" value={batchMonth} onChange={(e) => setBatchMonth(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>Amount per member (UGX)</Label>
                  <Input inputMode="numeric" value={batchAmount} onChange={(e) => setBatchAmount(e.target.value.replace(/[^\d]/g, ""))} />
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Selected</span><span className="font-medium">{batchSelected.size}</span></div>
                  <div className="mt-1 flex justify-between"><span className="text-muted-foreground">Total to post</span><span className="font-mono font-medium">{formatUGX((Number(batchAmount) || 0) * batchSelected.size)}</span></div>
                </div>
                <Button onClick={handleBatch} disabled={batchSelected.size === 0 || !batchAmount}>Post batch</Button>
              </div>
            </div>
            <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)] lg:col-span-2">
              <div className="flex items-center justify-between border-b p-4">
                <h3 className="text-sm font-semibold">Members</h3>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setBatchSelected(new Set(members.data?.map((m) => m.id)))}>Select all</Button>
                  <Button variant="ghost" size="sm" onClick={() => setBatchSelected(new Set())}>Clear</Button>
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
                          onCheckedChange={(v) => {
                            const next = new Set(batchSelected);
                            v ? next.add(m.id) : next.delete(m.id);
                            setBatchSelected(next);
                          }}
                        />
                        <Label htmlFor={`b_${m.id}`} className="flex-1 cursor-pointer">
                          <span className="font-medium">{m.name}</span>
                          <span className="ml-2 font-mono text-xs text-muted-foreground">{m.membershipNumber}</span>
                        </Label>
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
function monthOptions() {
  return [
    { v: "01", l: "January" }, { v: "02", l: "February" }, { v: "03", l: "March" },
    { v: "04", l: "April" }, { v: "05", l: "May" }, { v: "06", l: "June" },
    { v: "07", l: "July" }, { v: "08", l: "August" }, { v: "09", l: "September" },
    { v: "10", l: "October" }, { v: "11", l: "November" }, { v: "12", l: "December" },
  ];
}
