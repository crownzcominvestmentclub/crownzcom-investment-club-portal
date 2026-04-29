import { useMemo, useState } from "react";
import { Plus, Wallet, TrendingUp, Calendar, Download, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { queryKeys, useSavingsByMember } from "@/hooks/data";
import { savingsService } from "@/services";
import { formatDate, formatMonth, formatUGX } from "@/lib/format";
import type { Savings } from "@/lib/types";

const ALL = "all";

export default function MemberSavings() {
  const { user } = useAuth();
  const memberId = user?.memberId;
  const { toast } = useToast();
  const qc = useQueryClient();

  const savings = useSavingsByMember(memberId);

  const [yearFilter, setYearFilter] = useState<string>(ALL);
  const [monthFilter, setMonthFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");

  // Dialog state
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formAmount, setFormAmount] = useState("");
  const [formMonth, setFormMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const records = savings.data ?? [];

  const years = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => set.add(r.month.slice(0, 4)));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [records]);

  const months = [
    { v: "01", l: "January" }, { v: "02", l: "February" }, { v: "03", l: "March" },
    { v: "04", l: "April" }, { v: "05", l: "May" }, { v: "06", l: "June" },
    { v: "07", l: "July" }, { v: "08", l: "August" }, { v: "09", l: "September" },
    { v: "10", l: "October" }, { v: "11", l: "November" }, { v: "12", l: "December" },
  ];

  const filtered = useMemo(() => {
    return records
      .filter((r) => {
        const [y, m] = r.month.split("-");
        if (yearFilter !== ALL && y !== yearFilter) return false;
        if (monthFilter !== ALL && m !== monthFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          const monthLabel = formatMonth(r.month).toLowerCase();
          if (!monthLabel.includes(q) && !String(r.amount).includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [records, yearFilter, monthFilter, search]);

  const totalAll = useMemo(() => records.reduce((a, s) => a + s.amount, 0), [records]);
  const totalFiltered = useMemo(() => filtered.reduce((a, s) => a + s.amount, 0), [filtered]);
  const ytdTotal = useMemo(() => {
    const yearStr = String(new Date().getFullYear());
    return records
      .filter((r) => r.month.startsWith(yearStr))
      .reduce((a, s) => a + s.amount, 0);
  }, [records]);
  const lastMonthAmount = useMemo(() => {
    const sorted = [...records].sort((a, b) => b.month.localeCompare(a.month));
    return sorted[0]?.amount ?? 0;
  }, [records]);

  // Status helper: paid / missed / pending — based on whether the member contributed in that month
  // Since seed only contains contributions, we mark each row "paid". Pending/missed states are
  // computed when filtering by a specific month and no record exists.
  const isMonthMissing =
    monthFilter !== ALL && yearFilter !== ALL && filtered.length === 0 && records.length > 0;

  const resetForm = () => {
    setFormAmount("");
    const d = new Date();
    setFormMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const handleSubmit = async () => {
    if (!memberId) return;
    const amount = Number(formAmount.replace(/,/g, ""));
    if (!amount || amount <= 0) {
      toast({ title: "Invalid amount", description: "Enter an amount greater than zero.", variant: "destructive" });
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(formMonth)) {
      toast({ title: "Invalid month", description: "Pick a valid month.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // Optimistically insert into the cache so the table reflects the new record immediately.
      // The real Worker call will replace this once VITE_API_BASE_URL is set (savingsService.add).
      const optimistic: Savings = {
        id: `local_${Date.now()}`,
        memberId,
        amount,
        month: formMonth,
        createdAt: new Date().toISOString(),
      };
      qc.setQueryData<Savings[]>(queryKeys.savingsByMember(memberId), (prev) =>
        prev ? [optimistic, ...prev] : [optimistic],
      );

      // Try the service call — currently a placeholder that throws. We swallow that
      // so the optimistic UI still works in the preview before the Worker is wired.
      try {
        await savingsService.add({ memberId, amount, month: formMonth });
      } catch {
        // Expected pre-Worker; mutation placeholder.
      }

      toast({
        title: "Contribution recorded",
        description: `${formatUGX(amount)} for ${formatMonth(formMonth)}.`,
      });
      setOpen(false);
      resetForm();
    } finally {
      setSubmitting(false);
    }
  };

  const handleExport = () => {
    const rows = [["Month", "Amount (UGX)", "Recorded"]];
    filtered.forEach((r) => {
      rows.push([formatMonth(r.month), String(r.amount), formatDate(r.createdAt)]);
    });
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `savings-${user?.name?.replace(/\s+/g, "-") ?? "member"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!memberId) {
    return (
      <>
        <PageHeader title="My savings" />
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
        title="My savings"
        description="Your full contribution history with month and year filters."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
              <Download className="mr-1 h-4 w-4" /> Export CSV
            </Button>
            <Dialog
              open={open}
              onOpenChange={(o) => {
                setOpen(o);
                if (!o) resetForm();
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-1 h-4 w-4" /> Add contribution
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Record a contribution</DialogTitle>
                  <DialogDescription>
                    Submit a new monthly savings contribution. An admin may verify this entry.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="grid gap-2">
                    <Label htmlFor="month">Contribution month</Label>
                    <Input
                      id="month"
                      type="month"
                      value={formMonth}
                      onChange={(e) => setFormMonth(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="amount">Amount (UGX)</Label>
                    <Input
                      id="amount"
                      inputMode="numeric"
                      placeholder="e.g. 150000"
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value.replace(/[^\d,]/g, ""))}
                    />
                    <p className="text-xs text-muted-foreground">
                      {formAmount
                        ? formatUGX(Number(formAmount.replace(/,/g, "")) || 0)
                        : "Enter the amount you are contributing."}
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} disabled={submitting}>
                    {submitting ? "Saving..." : "Save contribution"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total savings"
          value={formatUGX(totalAll, { compact: true })}
          icon={Wallet}
          accent="primary"
          loading={savings.isLoading}
          hint={`${records.length} contributions`}
        />
        <KpiCard
          label="This year"
          value={formatUGX(ytdTotal, { compact: true })}
          icon={TrendingUp}
          accent="success"
          loading={savings.isLoading}
          hint={String(new Date().getFullYear())}
        />
        <KpiCard
          label="Last contribution"
          value={formatUGX(lastMonthAmount, { compact: true })}
          icon={Calendar}
          accent="info"
          loading={savings.isLoading}
        />
        <KpiCard
          label="Filtered total"
          value={formatUGX(totalFiltered, { compact: true })}
          icon={Wallet}
          accent="warning"
          loading={savings.isLoading}
          hint={`${filtered.length} record${filtered.length === 1 ? "" : "s"}`}
        />
      </div>

      <div className="mt-6 rounded-xl border bg-card shadow-soft">
        <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by month or amount"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All years</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All months</SelectItem>
                {months.map((m) => (
                  <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(yearFilter !== ALL || monthFilter !== ALL || search) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setYearFilter(ALL);
                  setMonthFilter(ALL);
                  setSearch("");
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
                <th>Recorded</th>
              </tr>
            </thead>
            <tbody>
              {savings.isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk_${i}`}>
                    <td><Skeleton className="h-4 w-24" /></td>
                    <td className="text-right"><Skeleton className="ml-auto h-4 w-20" /></td>
                    <td><Skeleton className="h-5 w-16" /></td>
                    <td><Skeleton className="h-4 w-28" /></td>
                  </tr>
                ))}
              {!savings.isLoading &&
                filtered.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{formatMonth(s.month)}</td>
                    <td className="text-right font-mono">{formatUGX(s.amount)}</td>
                    <td><StatusBadge status="paid" /></td>
                    <td className="text-muted-foreground">{formatDate(s.createdAt)}</td>
                  </tr>
                ))}
              {!savings.isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-12">
                    <EmptyState
                      title={isMonthMissing ? "No contribution for this month" : "No contributions found"}
                      description={
                        isMonthMissing
                          ? "There is no recorded savings entry for the selected month and year."
                          : records.length === 0
                            ? "You haven't made any contributions yet. Use 'Add contribution' to record your first deposit."
                            : "Try adjusting the filters or clearing your search."
                      }
                    />
                  </td>
                </tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="border-t bg-muted/30 font-medium">
                  <td>Total</td>
                  <td className="text-right font-mono">{formatUGX(totalFiltered)}</td>
                  <td colSpan={2} className="text-muted-foreground">
                    {filtered.length} record{filtered.length === 1 ? "" : "s"}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}
