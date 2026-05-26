import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Users, UserCheck, UserX, Search, Plus, Mail, Phone, Wallet, Banknote, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryKeys, useMembers, useSavings, useLoans, useLoanRepayments, useLoanCharges } from "@/hooks/data";
import { formatDate, formatUGX, initials } from "@/lib/format";
import { getMemberTotalSavings, getMemberOutstandingLoans } from "@/lib/calculations";
import { membersService } from "@/services";
import type { Member, MemberStatus } from "@/lib/types";

const ALL = "all";

export default function AdminMembers() {
  const members = useMembers();
  const savings = useSavings();
  const loans = useLoans();
  const repayments = useLoanRepayments();
  const charges = useLoanCharges();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [selected, setSelected] = useState<Member | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", membershipNumber: "" });

  const list = members.data ?? [];

  const stats = useMemo(() => {
    const active = list.filter((m) => m.status === "active").length;
    const inactive = list.filter((m) => m.status !== "active").length;
    return { total: list.length, active, inactive };
  }, [list]);

  const filtered = useMemo(() => {
    return list.filter((m) => {
      if (statusFilter !== ALL && m.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          String(m.name).toLowerCase().includes(q) ||
          String(m.email).toLowerCase().includes(q) ||
          String(m.membershipNumber).toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [list, search, statusFilter]);

  const memberSavings = (id: string) => getMemberTotalSavings(id, savings.data ?? []);
  const memberOutstanding = (id: string) => getMemberOutstandingLoans(id, loans.data ?? []);

  const memberLoans = (id: string) => (loans.data ?? []).filter(l => l.memberId === id);
  const memberRepayments = (id: string) => {
    const memberLoanIds = memberLoans(id).map(l => l.id);
    return (repayments.data ?? []).filter(r => memberLoanIds.includes(r.loanId));
  };
  const memberCharges = (id: string) => {
    const memberLoanIds = memberLoans(id).map(l => l.id);
    return (charges.data ?? []).filter(c => memberLoanIds.includes(c.loanId));
  };

  const handleCreate = async () => {
    if (!form.name || !form.email) {
      toast({ title: "Missing fields", description: "Name and email are required.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // Worker placeholder
      toast({ title: "Member created", description: `${form.name} has been added.` });
      setOpenCreate(false);
      setForm({ name: "", email: "", phone: "", membershipNumber: "" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveMember = async () => {
    if (!selected) return;
    setRemovingMemberId(selected.id);
    try {
      await membersService.remove(selected.id);
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.members }),
        qc.invalidateQueries({ queryKey: queryKeys.loans }),
        qc.invalidateQueries({ queryKey: queryKeys.savings }),
      ]);
      toast({ title: "Member deleted", description: `${selected.name} was removed.` });
      setDeleteDialogOpen(false);
      setSelected(null);
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "We couldn't delete that member.",
        variant: "destructive",
      });
    } finally {
      setRemovingMemberId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Members"
        description="Manage member records, savings positions and loan exposure."
        actions={
          <Dialog open={openCreate} onOpenChange={setOpenCreate}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" /> New member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a new member</DialogTitle>
                <DialogDescription>Create a new member record. They will be invited to set up their account.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-2">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="mn">Membership number</Label>
                  <Input id="mn" placeholder="CIC-1025" value={form.membershipNumber} onChange={(e) => setForm({ ...form, membershipNumber: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenCreate(false)} disabled={submitting}>Cancel</Button>
                <Button onClick={handleCreate} disabled={submitting}>{submitting ? "Saving..." : "Create member"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard label="Total members" value={String(stats.total)} icon={Users} accent="primary" loading={members.isLoading} />
        <KpiCard label="Active" value={String(stats.active)} icon={UserCheck} accent="success" loading={members.isLoading} />
        <KpiCard label="Inactive / suspended" value={String(stats.inactive)} icon={UserX} accent="warning" loading={members.isLoading} />
      </div>

      <div className="mt-6 rounded-xl border bg-card shadow-[var(--shadow-sm)]">
        <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search by name, email or number" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Membership #</th>
                <th>Joined</th>
                <th className="text-right">Savings</th>
                <th className="text-right">Outstanding</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {members.isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td><Skeleton className="h-5 w-40" /></td>
                    <td><Skeleton className="h-4 w-20" /></td>
                    <td><Skeleton className="h-4 w-24" /></td>
                    <td className="text-right"><Skeleton className="ml-auto h-4 w-20" /></td>
                    <td className="text-right"><Skeleton className="ml-auto h-4 w-20" /></td>
                    <td><Skeleton className="h-5 w-16" /></td>
                  </tr>
                ))}
              {!members.isLoading && filtered.map((m) => (
                <tr key={m.id} className="cursor-pointer" onClick={() => setSelected(m)}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{initials(m.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{m.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="font-mono text-xs">{m.membershipNumber}</td>
                  <td className="text-muted-foreground">{formatDate(m.joinDate)}</td>
                  <td className="text-right font-mono">{formatUGX(memberSavings(m.id))}</td>
                  <td className="text-right font-mono">{formatUGX(memberOutstanding(m.id))}</td>
                  <td><StatusBadge status={m.status as MemberStatus} /></td>
                </tr>
              ))}
              {!members.isLoading && filtered.length === 0 && (
                <tr><td colSpan={6} className="py-12">
                  <EmptyState title="No members match your filters" description="Try clearing the search or status filter." />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Member detail sheet */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="sm:max-w-2xl">
          {selected && (
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              {(() => {
                const selectedLoans = memberLoans(selected.id);
                const selectedRepayments = memberRepayments(selected.id).sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)));
                const selectedCharges = memberCharges(selected.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
                const totalPrincipal = selectedLoans.reduce((sum, loan) => sum + loan.amount, 0);
                const totalRepaid = selectedRepayments.reduce((sum, repayment) => sum + repayment.amount, 0);
                const totalCharges = selectedCharges.reduce((sum, charge) => sum + charge.amount, 0);

                return (
                  <>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete member?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This dev-only action will remove {selected.name} from the members table and unlink any matching auth account from the member record.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={removingMemberId === selected.id}>Cancel</AlertDialogCancel>
                  <AlertDialogAction disabled={removingMemberId === selected.id} onClick={handleRemoveMember}>
                    {removingMemberId === selected.id ? "Deleting..." : "Delete member"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
              <SheetHeader>
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="bg-primary/10 text-primary font-semibold">{initials(selected.name)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <SheetTitle>{selected.name}</SheetTitle>
                    <SheetDescription className="font-mono text-xs">{selected.membershipNumber}</SheetDescription>
                  </div>
                </div>
                <div className="pt-3">
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-destructive">
                      <Trash2 className="mr-1 h-4 w-4" /> Delete member
                    </Button>
                  </AlertDialogTrigger>
                </div>
              </SheetHeader>

              <Tabs defaultValue="overview" className="mt-6">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="loans">Loans ({selectedLoans.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4" /> {selected.email}
                  </div>
                  {selected.phone && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="h-4 w-4" /> {selected.phone}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Status:</span> <StatusBadge status={selected.status as MemberStatus} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Wallet className="h-3.5 w-3.5" /> Savings</div>
                      <p className="mt-1 text-lg font-semibold">{formatUGX(memberSavings(selected.id))}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Banknote className="h-3.5 w-3.5" /> Outstanding</div>
                      <p className="mt-1 text-lg font-semibold">{formatUGX(memberOutstanding(selected.id))}</p>
                    </div>
                  </div>
                  <p className="pt-2 text-xs text-muted-foreground">Joined {formatDate(selected.joinDate)}</p>
                </TabsContent>

                <TabsContent value="loans" className="space-y-4">
                  {selectedLoans.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Banknote className="mx-auto h-8 w-8 mb-2" />
                      <p>No loans found for this member.</p>
                    </div>
                  ) : (
                    <>
                      <div className="rounded-lg border bg-muted/20 p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <p className="text-sm font-medium">Embedded loan activity</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Member-level totals below are calculated from the same loan, repayment, and charge records shown in this sheet.
                            </p>
                          </div>
                          <Button asChild variant="outline" size="sm">
                            <Link to="/app/admin/loans">Open Admin Loans</Link>
                          </Button>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <LoanSummary label="Principal across loans" value={formatUGX(totalPrincipal)} />
                          <LoanSummary label="Outstanding balance" value={formatUGX(memberOutstanding(selected.id))} />
                          <LoanSummary label="Recorded repayments" value={formatUGX(totalRepaid)} />
                          <LoanSummary label="Recorded charges" value={formatUGX(totalCharges)} />
                        </div>
                      </div>
                      <div className="rounded-lg border border-dashed bg-background px-4 py-5 text-sm text-muted-foreground">
                        Individual loan breakdown has been moved out of this member sheet. Use <span className="font-medium text-foreground">Open Admin Loans</span> for the full loan-by-loan view, repayments, charges, and approval workflow.
                      </div>
                    </>
                  )}
                </TabsContent>
              </Tabs>
                  </>
                );
              })()}
            </AlertDialog>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function LoanSummary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold">{value}</p>
    </div>
  );
}
