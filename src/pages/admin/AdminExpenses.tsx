import { useMemo, useState } from "react";
import { Plus, Receipt, TrendingDown, Tags, Search } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { useExpenses } from "@/hooks/data";
import { formatDate, formatUGX } from "@/lib/format";

const ALL = "all";
const CATEGORIES = ["Banking", "Operations", "Events", "Technology", "Professional", "Travel", "Utilities", "Other"];

export default function AdminExpenses() {
  const expenses = useExpenses();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string>(ALL);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    description: "",
    amount: "",
    category: "Operations",
    date: new Date().toISOString().slice(0, 10),
  });

  const list = expenses.data ?? [];
  const filtered = useMemo(() => {
    return list.filter((e) => {
      if (cat !== ALL && e.category !== cat) return false;
      if (search && !e.description.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [list, cat, search]);

  const totalAll = list.reduce((a, e) => a + e.amount, 0);
  const totalFiltered = filtered.reduce((a, e) => a + e.amount, 0);
  const monthTotal = useMemo(() => {
    const ym = new Date().toISOString().slice(0, 7);
    return list.filter((e) => e.date.startsWith(ym)).reduce((a, e) => a + e.amount, 0);
  }, [list]);
  const categoryCount = useMemo(() => new Set(list.map((e) => e.category)).size, [list]);

  const handleSubmit = async () => {
    const amount = Number(form.amount);
    if (!form.description || !amount) {
      toast({ title: "Missing fields", description: "Description and amount required.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      toast({ title: "Expense recorded", description: `${form.description} · ${formatUGX(amount)}` });
      setOpen(false);
      setForm({ description: "", amount: "", category: "Operations", date: new Date().toISOString().slice(0, 10) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Track operating expenses by category for monthly and annual reporting."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-4 w-4" /> New expense</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record an expense</DialogTitle>
                <DialogDescription>Categorise expenses to keep clean monthly reports.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-2">
                  <Label>Description</Label>
                  <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Amount (UGX)</Label>
                    <Input inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d]/g, "") })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Date</Label>
                    <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Category</Label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
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
        <KpiCard label="Total expenses" value={formatUGX(totalAll, { compact: true })} icon={Receipt} accent="primary" loading={expenses.isLoading} />
        <KpiCard label="This month" value={formatUGX(monthTotal, { compact: true })} icon={TrendingDown} accent="warning" loading={expenses.isLoading} />
        <KpiCard label="Categories" value={String(categoryCount)} icon={Tags} accent="info" loading={expenses.isLoading} />
        <KpiCard label="Filtered total" value={formatUGX(totalFiltered, { compact: true })} icon={Receipt} accent="success" loading={expenses.isLoading} hint={`${filtered.length} entries`} />
      </div>

      <div className="mt-6 rounded-xl border bg-card shadow-[var(--shadow-sm)]">
        <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search description" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Category</th>
                <th>Date</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {expenses.isLoading && Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 4 }).map((__, j) => <td key={j}><Skeleton className="h-4 w-24" /></td>)}</tr>
              ))}
              {!expenses.isLoading && filtered.map((e) => (
                <tr key={e.id}>
                  <td className="font-medium">{e.description}</td>
                  <td><span className="rounded-full border bg-muted/50 px-2 py-0.5 text-xs">{e.category}</span></td>
                  <td className="text-muted-foreground">{formatDate(e.date)}</td>
                  <td className="text-right font-mono">{formatUGX(e.amount)}</td>
                </tr>
              ))}
              {!expenses.isLoading && filtered.length === 0 && (
                <tr><td colSpan={4} className="py-12"><EmptyState title="No expenses match" /></td></tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="border-t bg-muted/30 font-medium">
                  <td colSpan={3}>Total</td>
                  <td className="text-right font-mono">{formatUGX(totalFiltered)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}
