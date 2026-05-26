import { useMemo, useState } from "react";
import { Wallet, TrendingUp, Calendar, Download, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useSavingsByMember } from "@/hooks/data";
import { formatDate, formatMonth, formatUGX } from "@/lib/format";

const ALL = "all";

export default function MemberSavings() {
  const { user } = useAuth();
  const memberId = user?.memberId;

  const savings = useSavingsByMember(memberId);

  const [yearFilter, setYearFilter] = useState<string>(ALL);
  const [monthFilter, setMonthFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");

  const records = savings.data ?? [];

  const years = useMemo(() => {
    const set = new Set<string>();
    records.forEach((record) => set.add(String(record.month).slice(0, 4)));
    return Array.from(set).sort((a, b) => String(b).localeCompare(String(a)));
  }, [records]);

  const months = [
    { v: "01", l: "January" }, { v: "02", l: "February" }, { v: "03", l: "March" },
    { v: "04", l: "April" }, { v: "05", l: "May" }, { v: "06", l: "June" },
    { v: "07", l: "July" }, { v: "08", l: "August" }, { v: "09", l: "September" },
    { v: "10", l: "October" }, { v: "11", l: "November" }, { v: "12", l: "December" },
  ];

  const filtered = useMemo(() => {
    return records
      .filter((record) => {
        const [year, month] = String(record.month).split("-");
        if (yearFilter !== ALL && year !== yearFilter) return false;
        if (monthFilter !== ALL && month !== monthFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          const monthLabel = formatMonth(record.month).toLowerCase();
          if (!monthLabel.includes(q) && !String(record.amount).includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => String(b.month).localeCompare(String(a.month)));
  }, [records, yearFilter, monthFilter, search]);

  const totalAll = useMemo(() => records.reduce((sum, record) => sum + record.amount, 0), [records]);
  const totalFiltered = useMemo(() => filtered.reduce((sum, record) => sum + record.amount, 0), [filtered]);
  const ytdTotal = useMemo(() => {
    const yearStr = String(new Date().getFullYear());
    return records
      .filter((record) => String(record.month).startsWith(yearStr))
      .reduce((sum, record) => sum + record.amount, 0);
  }, [records]);
  const lastMonthAmount = useMemo(() => {
    const sorted = [...records].sort((a, b) => String(b.month).localeCompare(String(a.month)));
    return sorted[0]?.amount ?? 0;
  }, [records]);

  const isMonthMissing =
    monthFilter !== ALL && yearFilter !== ALL && filtered.length === 0 && records.length > 0;

  const handleExport = () => {
    const rows = [["Month", "Amount (UGX)", "Status", "Paid / Recorded"]];
    filtered.forEach((record) => {
      rows.push([
        formatMonth(record.month),
        String(record.amount),
        String(record.status ?? "paid"),
        formatDate(record.paidAt ?? record.createdAt),
      ]);
    });
    const csv = rows.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
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
        description="Your recorded contribution history with month and year filters."
        actions={
          <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
            <Download className="mr-1 h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total savings"
          value={formatUGX(totalAll)}
          icon={Wallet}
          accent="primary"
          loading={savings.isLoading}
          hint={`${records.length} contributions`}
        />
        <KpiCard
          label="This year"
          value={formatUGX(ytdTotal)}
          icon={TrendingUp}
          accent="success"
          loading={savings.isLoading}
          hint={String(new Date().getFullYear())}
        />
        <KpiCard
          label="Last contribution"
          value={formatUGX(lastMonthAmount)}
          icon={Calendar}
          accent="info"
          loading={savings.isLoading}
        />
        <KpiCard
          label="Filtered total"
          value={formatUGX(totalFiltered)}
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
                {years.map((year) => (
                  <SelectItem key={year} value={year}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All months</SelectItem>
                {months.map((month) => (
                  <SelectItem key={month.v} value={month.v}>{month.l}</SelectItem>
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
                filtered.map((record) => (
                  <tr key={record.id}>
                    <td className="font-medium">{formatMonth(record.month)}</td>
                    <td className="text-right font-mono">{formatUGX(record.amount)}</td>
                    <td><StatusBadge status={record.status ?? "paid"} /></td>
                    <td className="text-muted-foreground">{formatDate(record.paidAt ?? record.createdAt)}</td>
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
                            ? "You don't have any recorded savings contributions yet. Contributions are posted by an administrator."
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
