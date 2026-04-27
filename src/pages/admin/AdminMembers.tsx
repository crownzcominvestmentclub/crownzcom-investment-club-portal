import { useMemo, useState } from "react";
import { Users, UserCheck, UserX, Search, Plus, Mail, Phone, Wallet, Banknote } from "lucide-react";
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
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useMembers, useSavings, useLoans } from "@/hooks/data";
import { formatDate, formatUGX, initials } from "@/lib/format";
import type { Member, MemberStatus } from "@/lib/types";

const ALL = "all";

export default function AdminMembers() {
  const members = useMembers();
  const savings = useSavings();
  const loans = useLoans();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [selected, setSelected] = useState<Member | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          m.membershipNumber.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [list, search, statusFilter]);

  const memberSavings = (id: string) =>
    savings.data?.filter((s) => s.memberId === id).reduce((a, s) => a + s.amount, 0) ?? 0;
  const memberOutstanding = (id: string) =>
    loans.data
      ?.filter((l) => l.memberId === id && l.status === "active")
      .reduce((a, l) => a + l.balance, 0) ?? 0;

  const handleCreate = async () => {
    if (!form.name || !form.email) {
      toast({ title: "Missing fields", description: "Name and email are required.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // Convex placeholder
      toast({ title: "Member created", description: `${form.name} has been added.` });
      setOpenCreate(false);
      setForm({ name: "", email: "", phone: "", membershipNumber: "" });
    } finally {
      setSubmitting(false);
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
                  <td className="text-right font-mono">{formatUGX(memberSavings(m.id), { compact: true })}</td>
                  <td className="text-right font-mono">{formatUGX(memberOutstanding(m.id), { compact: true })}</td>
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
        <SheetContent className="sm:max-w-md">
          {selected && (
            <>
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
              </SheetHeader>
              <div className="mt-6 space-y-4 text-sm">
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
                    <p className="mt-1 text-lg font-semibold">{formatUGX(memberSavings(selected.id), { compact: true })}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Banknote className="h-3.5 w-3.5" /> Outstanding</div>
                    <p className="mt-1 text-lg font-semibold">{formatUGX(memberOutstanding(selected.id), { compact: true })}</p>
                  </div>
                </div>
                <p className="pt-2 text-xs text-muted-foreground">Joined {formatDate(selected.joinDate)}</p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
