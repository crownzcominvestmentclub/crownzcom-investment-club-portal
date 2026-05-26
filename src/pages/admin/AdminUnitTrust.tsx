import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, TrendingUp, ArrowDownToLine, ArrowUpFromLine, Coins, Trash2, Pencil } from "lucide-react";
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryKeys, useUnitTrust } from "@/hooks/data";
import { formatDate, formatUGX } from "@/lib/format";
import type { UnitTrust } from "@/lib/types";
import { cn } from "@/lib/utils";
import { unitTrustService } from "@/services";

export default function AdminUnitTrust() {
  const trust = useUnitTrust();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<{ type: UnitTrust["type"]; amount: string; description: string; date: string }>({
    type: "deposit",
    amount: "",
    description: "",
    date: new Date().toISOString().slice(0, 10),
  });

  const list = useMemo(
    () => [...(trust.data ?? [])].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [trust.data],
  );

  const totals = useMemo(() => {
    const deposits = list.filter((entry) => entry.type === "deposit").reduce((sum, entry) => sum + entry.amount, 0);
    const withdrawals = list.filter((entry) => entry.type === "withdrawal").reduce((sum, entry) => sum + entry.amount, 0);
    const interest = list.filter((entry) => entry.type === "interest").reduce((sum, entry) => sum + entry.amount, 0);
    return { deposits, withdrawals, interest, balance: deposits - withdrawals + interest };
  }, [list]);

  const withRunning = useMemo(() => {
    const ordered = [...list].reverse();
    let balance = 0;
    const map = new Map<string, number>();
    ordered.forEach((entry) => {
      balance += entry.type === "withdrawal" ? -entry.amount : entry.amount;
      map.set(entry.id, balance);
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
      const payload = {
        type: form.type,
        amount,
        description: form.description.trim() || undefined,
        date: new Date(`${form.date}T00:00:00`).toISOString(),
      };
      if (editingId) {
        await unitTrustService.update(editingId, payload);
      } else {
        await unitTrustService.add(payload);
      }
      await qc.invalidateQueries({ queryKey: queryKeys.unitTrust });
      toast({
        title: editingId ? "Entry updated" : "Entry recorded",
        description: `${form.type} - ${formatUGX(amount)}`,
      });
      setOpen(false);
      setEditingId(null);
      setForm({ type: "deposit", amount: "", description: "", date: new Date().toISOString().slice(0, 10) });
    } catch (error) {
      toast({
        title: editingId ? "Update failed" : "Save failed",
        description: error instanceof Error ? error.message : `We could not ${editingId ? "update" : "save"} this unit trust entry.`,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (entry: UnitTrust) => {
    setEditingId(entry.id);
    setForm({
      type: entry.type,
      amount: String(entry.amount),
      description: entry.description ?? "",
      date: String(entry.date).slice(0, 10),
    });
    setOpen(true);
  };

  const handleRemove = async (id: string, label: string) => {
    setRemovingId(id);
    try {
      await unitTrustService.remove(id);
      await qc.invalidateQueries({ queryKey: queryKeys.unitTrust });
      toast({ title: "Entry deleted", description: label || "The unit trust entry was removed." });
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "We could not delete this unit trust entry.",
        variant: "destructive",
      });
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Unit Trust"
        description="Manage placements, withdrawals and accrued interest."
        actions={
          <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
              setOpen(nextOpen);
              if (!nextOpen) {
                setEditingId(null);
                setForm({ type: "deposit", amount: "", description: "", date: new Date().toISOString().slice(0, 10) });
              }
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-4 w-4" /> New entry</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingId ? "Edit unit trust entry" : "Add unit trust entry"}</DialogTitle>
                <DialogDescription>
                  {editingId ? "Update the selected deposit, withdrawal, or interest accrual." : "Record a deposit, withdrawal, or interest accrual."}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value as UnitTrust["type"] })}>
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
                  <Input
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        amount: e.target.value
                          .replace(/[^0-9.]/g, "")
                          .replace(/(\..*)\./g, "$1"),
                      })
                    }
                  />
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
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? (editingId ? "Updating..." : "Saving...") : (editingId ? "Update" : "Save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(openState) => !openState && !removingId && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete unit trust entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `This will permanently remove "${deleteTarget.label}" from unit trust history.` : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!removingId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!removingId}
              onClick={async (event) => {
                event.preventDefault();
                if (!deleteTarget) return;
                await handleRemove(deleteTarget.id, deleteTarget.label);
                setDeleteTarget(null);
              }}
            >
              {removingId ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Balance" value={formatUGX(totals.balance)} icon={Coins} accent="primary" loading={trust.isLoading} />
        <KpiCard label="Deposits" value={formatUGX(totals.deposits)} icon={ArrowDownToLine} accent="success" loading={trust.isLoading} />
        <KpiCard label="Withdrawals" value={formatUGX(totals.withdrawals)} icon={ArrowUpFromLine} accent="warning" loading={trust.isLoading} />
        <KpiCard label="Interest earned" value={formatUGX(totals.interest)} icon={TrendingUp} accent="info" loading={trust.isLoading} />
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
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {trust.isLoading && Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 6 }).map((__, j) => <td key={j}><Skeleton className="h-4 w-24" /></td>)}</tr>
              ))}
              {!trust.isLoading && list.map((entry) => (
                <tr key={entry.id}>
                  <td className="text-muted-foreground">{formatDate(entry.date)}</td>
                  <td>
                    <span className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
                      entry.type === "deposit" && "bg-success/10 text-success border-success/20",
                      entry.type === "withdrawal" && "bg-warning/15 text-warning border-warning/20",
                      entry.type === "interest" && "bg-info/10 text-info border-info/20",
                    )}>{entry.type}</span>
                  </td>
                  <td>{entry.description ?? "-"}</td>
                  <td className={cn("text-right font-mono", entry.type === "withdrawal" && "text-warning")}>
                    {entry.type === "withdrawal" ? "-" : "+"}{formatUGX(entry.amount)}
                  </td>
                  <td className="text-right font-mono font-medium">{formatUGX(withRunning.get(entry.id) ?? 0)}</td>
                  <td className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(entry)}
                      disabled={removingId === entry.id}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setDeleteTarget({ id: entry.id, label: entry.description ?? entry.type })}
                      disabled={removingId === entry.id}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
              {!trust.isLoading && list.length === 0 && (
                <tr><td colSpan={6} className="py-12"><EmptyState title="No unit trust activity" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
