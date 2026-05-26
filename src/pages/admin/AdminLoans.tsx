import { Fragment, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Eye,
  Plus,
  Search,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  queryKeys, useEarlyRepayments, useLoanCharges, useLoanGuarantors, useLoanRepayments, useLoans, useMembers,
} from "@/hooks/data";
import { formatDate, formatMonth, formatUGX } from "@/lib/format";
import { calculateRepaymentStatus, groupLoanCharges, toTimestamp, validateRepaymentAmount } from "@/lib/repayment";
import { earlyRepaymentService, loanChargesService, loanRepaymentsService, loansService } from "@/services";
import type { Loan, LoanCharge, LoanEarlyRepaymentRequest, LoanRepayment, LoanStatus, RepaymentStatus } from "@/lib/types";

const ALL = "all";

type LoanGroup = {
  memberId: string;
  memberName: string;
  memberNumber: string;
  loans: Loan[];
  totalAmount: number;
  totalOutstanding: number;
  activeCount: number;
  pendingCount: number;
  latestCreatedAt: string;
};

type DueRepaymentRow = {
  key: string;
  loanId: string;
  loanLabel: string;
  memberId: string;
  loanAmount: number;
  outstanding: number;
  memberName: string;
  memberNumber: string;
  month: string;
  dueDate?: string;
  total: number;
  status: RepaymentStatus;
};

export default function AdminLoans() {
  const loans = useLoans();
  const members = useMembers();
  const repayments = useLoanRepayments();
  const charges = useLoanCharges();
  const guarantors = useLoanGuarantors();
  const earlyRepayments = useEarlyRepayments();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [selected, setSelected] = useState<Loan | null>(null);
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [loanToReject, setLoanToReject] = useState<Loan | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approvingLoanId, setApprovingLoanId] = useState<string | null>(null);
  const [rejectingLoanId, setRejectingLoanId] = useState<string | null>(null);
  const [recordingSingle, setRecordingSingle] = useState(false);
  const [recordingBatch, setRecordingBatch] = useState(false);
  const [savingCharge, setSavingCharge] = useState(false);
  const [removingChargeId, setRemovingChargeId] = useState<string | null>(null);
  const [processingEarlyRepaymentId, setProcessingEarlyRepaymentId] = useState<string | null>(null);

  const [singleForm, setSingleForm] = useState({
    loanId: "",
    month: "",
    amount: "",
    paidAt: isoDateInput(new Date().toISOString()),
    isEarlyPayment: false,
  });

  const [batchPaidAt, setBatchPaidAt] = useState(isoDateInput(new Date().toISOString()));
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchAmounts, setBatchAmounts] = useState<Record<string, string>>({});
  const [chargeForm, setChargeForm] = useState({
    kind: "processing_fee" as LoanCharge["kind"],
    amount: "",
    note: "",
  });

  const list = loans.data ?? [];
  const membersById = useMemo(
    () => new Map((members.data ?? []).map((member) => [member.id, member])),
    [members.data],
  );
  const loanLabelById = useMemo(() => {
    const byMember = new Map<string, Loan[]>();
    for (const loan of [...list].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
      const current = byMember.get(loan.memberId) ?? [];
      current.push(loan);
      byMember.set(loan.memberId, current);
    }

    const labels = new Map<string, string>();
    for (const loansForMember of byMember.values()) {
      loansForMember.forEach((loan, index) => {
        labels.set(loan.id, `Loan ${index + 1}`);
      });
    }
    return labels;
  }, [list]);

  const memberDisplayName = (memberId?: string | null) => {
    if (!memberId) return "Unknown member";
    const fallbackLoan = list.find((loan) => loan.memberId === memberId);
    if (fallbackLoan?.memberName) return fallbackLoan.memberName;
    const member = membersById.get(memberId);
    if (member?.name) return member.name;
    return `Member ${memberId.slice(-4).toUpperCase()}`;
  };

  const memberDisplayNumber = (memberId?: string | null) => {
    if (!memberId) return "No membership #";
    const fallbackLoan = list.find((loan) => loan.memberId === memberId);
    if (fallbackLoan?.memberNumber) return fallbackLoan.memberNumber;
    const member = membersById.get(memberId);
    if (member?.membershipNumber) return member.membershipNumber;
    return "No membership #";
  };

  const stats = useMemo(() => {
    const active = list.filter((loan) => loan.status === "active");
    const pending = list.filter((loan) => String(loan.status).startsWith("pending"));
    const failed = list.filter((loan) => ["guarantor_coverage_failed", "rejected"].includes(loan.status));

    return {
      portfolio: list.reduce((sum, loan) => sum + loan.amount, 0),
      outstanding: active.reduce((sum, loan) => sum + loan.balance, 0),
      pending: pending.length,
      failed: failed.length,
      active: active.length,
    };
  }, [list]);

  const overdueAmount = useMemo(() => {
    const allRepayments = repayments.data ?? [];
    return allRepayments
      .filter((repayment) => repayment.paymentStatus === "late")
      .reduce((sum, repayment) => sum + repayment.amount, 0);
  }, [repayments.data]);

  const groupedLoans = useMemo(() => {
    const loansByMember = new Map<string, LoanGroup>();
    const q = search.trim().toLowerCase();

    const filteredLoans = list.filter((loan) => {
      if (statusFilter !== ALL && loan.status !== statusFilter) return false;
      if (typeFilter !== ALL && loan.loanType !== typeFilter) return false;
      if (!q) return true;

      const loanMemberName = loan.memberName ?? memberDisplayName(loan.memberId);
      const loanMemberNumber = loan.memberNumber ?? memberDisplayNumber(loan.memberId);
      return (
        loanMemberName.toLowerCase().includes(q) ||
        loanMemberNumber.toLowerCase().includes(q) ||
        loanLabelById.get(loan.id)?.toLowerCase().includes(q) ||
        loan.id.toLowerCase().includes(q)
      );
    });

    filteredLoans.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    for (const loan of filteredLoans) {
      const existing = loansByMember.get(loan.memberId);
      const group = existing ?? {
        memberId: loan.memberId,
        memberName: loan.memberName ?? memberDisplayName(loan.memberId),
        memberNumber: loan.memberNumber ?? memberDisplayNumber(loan.memberId),
        loans: [],
        totalAmount: 0,
        totalOutstanding: 0,
        activeCount: 0,
        pendingCount: 0,
        latestCreatedAt: String(loan.createdAt),
      };

      group.loans.push(loan);
      group.totalAmount += loan.amount;
      group.totalOutstanding += loan.balance;
      if (loan.status === "active") group.activeCount += 1;
      if (String(loan.status).startsWith("pending")) group.pendingCount += 1;
      if (String(loan.createdAt) > group.latestCreatedAt) group.latestCreatedAt = String(loan.createdAt);
      loansByMember.set(loan.memberId, group);
    }

    return Array.from(loansByMember.values()).sort((a, b) => String(b.latestCreatedAt).localeCompare(String(a.latestCreatedAt)));
  }, [list, membersById, loanLabelById, search, statusFilter, typeFilter]);

  const dueRows = useMemo<DueRepaymentRow[]>(() => {
    return list
      .filter((loan) => loan.status === "active")
      .flatMap((loan) => {
        const nextDue = (loan.repaymentPlan ?? []).find((item) => item.status === "pending" || item.status === "late");
        if (!nextDue) return [];
        return [{
          key: `${loan.id}:${nextDue.month}`,
          loanId: loan.id,
          loanLabel: loanLabelById.get(loan.id) ?? "Loan",
          memberId: loan.memberId,
          loanAmount: loan.amount,
          outstanding: loan.balance,
          memberName: loan.memberName ?? memberDisplayName(loan.memberId),
          memberNumber: loan.memberNumber ?? memberDisplayNumber(loan.memberId),
          month: nextDue.month,
          dueDate: nextDue.dueDate,
          total: nextDue.total,
          status: nextDue.status,
        }];
      })
      .sort((a, b) => {
        const dueA = a.dueDate ?? `${a.month}-01`;
        const dueB = b.dueDate ?? `${b.month}-01`;
        if (dueA !== dueB) return dueA.localeCompare(dueB);
        return a.memberName.localeCompare(b.memberName);
      });
  }, [list, membersById, loanLabelById]);

  const singleLoanOptions = useMemo(
    () => list.filter((loan) => loan.status === "active"),
    [list],
  );

  const singleLoan = useMemo(
    () => list.find((loan) => loan.id === singleForm.loanId) ?? null,
    [list, singleForm.loanId],
  );

  const singleMonthOptions = useMemo(() => {
    if (!singleLoan) return [];
    return (singleLoan.repaymentPlan ?? []).filter((item) => item.status === "pending" || item.status === "late");
  }, [singleLoan]);

  useEffect(() => {
    if (!singleLoan) return;
    if (!singleMonthOptions.some((item) => item.month === singleForm.month)) {
      const nextMonth = singleMonthOptions[0]?.month ?? "";
      const nextAmount = singleMonthOptions[0]?.total ? String(singleMonthOptions[0].total) : "";
      setSingleForm((current) => ({
        ...current,
        month: nextMonth,
        amount: current.amount || nextAmount,
      }));
    }
  }, [singleForm.month, singleLoan, singleMonthOptions]);

  const singleSelectedMonth = useMemo(
    () => singleMonthOptions.find((item) => item.month === singleForm.month) ?? null,
    [singleForm.month, singleMonthOptions],
  );

  const dueGroups = useMemo(() => {
    const map = new Map<string, DueRepaymentRow[]>();
    dueRows.forEach((row) => {
      const key = row.dueDate ? isoDateInput(row.dueDate) : `${row.month}-01`;
      const current = map.get(key) ?? [];
      current.push(row);
      map.set(key, current);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [dueRows]);

  const dueRowsByKey = useMemo(
    () => new Map(dueRows.map((row) => [row.key, row])),
    [dueRows],
  );

  const selectedBatchCount = batchSelected.size;
  const batchTotal = Array.from(batchSelected).reduce((sum, key) => {
    const amount = Number(batchAmounts[key] ?? 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  const loanRepayments = (id: string) => repayments.data?.filter((repayment) => repayment.loanId === id) ?? [];
  const loanCharges = (id: string) => charges.data?.filter((charge) => charge.loanId === id) ?? [];
  const loanGuarantors = (id: string) => guarantors.data?.filter((guarantor) => guarantor.loanId === id) ?? [];

  const memberName = (id: string) => list.find((loan) => loan.memberId === id)?.memberName ?? memberDisplayName(id);
  const memberNumber = (id: string) => list.find((loan) => loan.memberId === id)?.memberNumber ?? memberDisplayNumber(id);
  const loanLabel = (id: string) => loanLabelById.get(id) ?? "Loan";

  const toggleMember = (memberId: string) => {
    setExpandedMembers((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  };

  const ensureBatchAmount = (key: string, fallback: number) => {
    setBatchAmounts((current) => (
      current[key] !== undefined
        ? current
        : { ...current, [key]: String(fallback) }
    ));
  };

  const toggleBatchSelection = (key: string, checked: boolean) => {
    const row = dueRowsByKey.get(key);
    setBatchSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
    if (checked && row) ensureBatchAmount(key, row.total);
  };

  const toggleBatchGroup = (groupRows: DueRepaymentRow[], checked: boolean) => {
    setBatchSelected((current) => {
      const next = new Set(current);
      groupRows.forEach((row) => {
        if (checked) next.add(row.key);
        else next.delete(row.key);
      });
      return next;
    });

    if (checked) {
      setBatchAmounts((current) => {
        const next = { ...current };
        groupRows.forEach((row) => {
          if (next[row.key] === undefined) next[row.key] = String(row.total);
        });
        return next;
      });
    }
  };

  const prefillSingleFromDue = (row: DueRepaymentRow) => {
    setSingleForm({
      loanId: row.loanId,
      month: row.month,
      amount: String(row.total),
      paidAt: batchPaidAt,
      isEarlyPayment: false,
    });
  };

  const clearBatchState = () => {
    setBatchSelected(new Set());
    setBatchAmounts({});
  };

  const refreshLoanData = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.loans }),
      qc.invalidateQueries({ queryKey: queryKeys.repayments }),
      qc.invalidateQueries({ queryKey: queryKeys.guarantors }),
      qc.invalidateQueries({ queryKey: queryKeys.charges }),
      qc.invalidateQueries({ queryKey: queryKeys.earlyRepayments }),
    ]);
  };

  const handleApproveEarlyRepayment = async (request: LoanEarlyRepaymentRequest) => {
    setProcessingEarlyRepaymentId(request.id);
    try {
      await earlyRepaymentService.approve(request.id);
      await refreshLoanData();
      toast({ title: "Early repayment approved", description: `${memberName(request.memberId)} can now be marked paid.` });
    } catch (error) {
      toast({
        title: "Approval failed",
        description: error instanceof Error ? error.message : "We could not approve this early repayment request.",
        variant: "destructive",
      });
    } finally {
      setProcessingEarlyRepaymentId(null);
    }
  };

  const handleRejectEarlyRepayment = async (request: LoanEarlyRepaymentRequest) => {
    setProcessingEarlyRepaymentId(request.id);
    try {
      await earlyRepaymentService.reject(request.id);
      await refreshLoanData();
      toast({ title: "Early repayment rejected", description: `${memberName(request.memberId)} was notified.` });
    } catch (error) {
      toast({
        title: "Rejection failed",
        description: error instanceof Error ? error.message : "We could not reject this early repayment request.",
        variant: "destructive",
      });
    } finally {
      setProcessingEarlyRepaymentId(null);
    }
  };

  const handleMarkEarlyRepaymentPaid = async (request: LoanEarlyRepaymentRequest) => {
    setProcessingEarlyRepaymentId(request.id);
    try {
      await earlyRepaymentService.markPaid(request.id);
      await refreshLoanData();
      toast({ title: "Early repayment posted", description: `${memberName(request.memberId)}'s request is now recorded as paid.` });
    } catch (error) {
      toast({
        title: "Mark paid failed",
        description: error instanceof Error ? error.message : "We could not post this early repayment request.",
        variant: "destructive",
      });
    } finally {
      setProcessingEarlyRepaymentId(null);
    }
  };

  const handleApprove = async (loan: Loan) => {
    setApprovingLoanId(loan.id);
    try {
      const updatedLoan = await loansService.finalApprove(loan.id);
      await refreshLoanData();
      toast({
        title: "Loan approved",
        description: `${memberName(loan.memberId)} - ${formatUGX(loan.amount)} approved.`,
      });
      setSelected((current) => (current?.id === loan.id ? updatedLoan : current));
    } catch (error) {
      toast({
        title: "Approval failed",
        description: error instanceof Error ? error.message : "We could not approve this loan.",
        variant: "destructive",
      });
    } finally {
      setApprovingLoanId(null);
    }
  };

  const openRejectDialog = (loan: Loan) => {
    setLoanToReject(loan);
    setRejectReason("");
    setRejectOpen(true);
  };

  const handleReject = async () => {
    if (!loanToReject) return;
    if (!rejectReason.trim()) {
      toast({
        title: "Reason required",
        description: "Provide a reason for rejection.",
        variant: "destructive",
      });
      return;
    }

    setRejectingLoanId(loanToReject.id);
    try {
      const updatedLoan = await loansService.reject(loanToReject.id, rejectReason.trim());
      await refreshLoanData();
      toast({ title: "Loan rejected", description: rejectReason.trim() });
      setSelected((current) => (current?.id === loanToReject.id ? updatedLoan : current));
      setRejectOpen(false);
      setLoanToReject(null);
      setRejectReason("");
    } catch (error) {
      toast({
        title: "Rejection failed",
        description: error instanceof Error ? error.message : "We could not reject this loan.",
        variant: "destructive",
      });
    } finally {
      setRejectingLoanId(null);
    }
  };

  const handleSingleRepayment = async () => {
    const amount = Number(singleForm.amount);
    const paidAt = toTimestamp(singleForm.paidAt);
    if (!singleForm.loanId || !singleForm.month || !amount || !paidAt) {
      toast({
        title: "Missing fields",
        description: "Pick a loan, repayment month, amount, and payment date.",
        variant: "destructive",
      });
      return;
    }
    if (singleSelectedMonth) {
      const amountError = validateRepaymentAmount(amount, singleSelectedMonth.total);
      if (amountError) {
        toast({ title: "Invalid amount", description: amountError, variant: "destructive" });
        return;
      }
    }

    setRecordingSingle(true);
    try {
      await loanRepaymentsService.record({
        loanId: singleForm.loanId,
        month: singleForm.month,
        amount,
        paidAt: new Date(paidAt).toISOString(),
        isEarlyPayment: singleForm.isEarlyPayment,
        paymentStatus: calculateRepaymentStatus(singleForm.month, paidAt),
      });
      await refreshLoanData();
      toast({
        title: "Repayment recorded",
        description: `${formatUGX(amount)} posted for ${formatMonth(singleForm.month)}.`,
      });
      setSingleForm({
        loanId: "",
        month: "",
        amount: "",
        paidAt: isoDateInput(new Date().toISOString()),
        isEarlyPayment: false,
      });
      setSelected(null);
    } catch (error) {
      toast({
        title: "Recording failed",
        description: error instanceof Error ? error.message : "We could not post this repayment.",
        variant: "destructive",
      });
    } finally {
      setRecordingSingle(false);
    }
  };

  const handleBatchRepayment = async () => {
    const paidAt = toTimestamp(batchPaidAt);
    if (!paidAt) {
      toast({
        title: "Payment date required",
        description: "Choose the payroll posting date for this batch.",
        variant: "destructive",
      });
      return;
    }
    if (batchSelected.size === 0) {
      toast({
        title: "Nothing selected",
        description: "Tick at least one due repayment row.",
        variant: "destructive",
      });
      return;
    }

    const entries = Array.from(batchSelected).map((key) => {
      const row = dueRowsByKey.get(key);
      const amount = Number(batchAmounts[key] ?? 0);
      if (!row || !amount) return null;
      return {
        loanId: row.loanId,
        month: row.month,
        amount,
        paidAt: new Date(paidAt).toISOString(),
        isEarlyPayment: false,
        paymentStatus: calculateRepaymentStatus(row.month, paidAt),
      };
    }).filter((entry): entry is Omit<LoanRepayment, "id"> => Boolean(entry));

    if (entries.length !== batchSelected.size) {
      toast({
        title: "Missing amounts",
        description: "Enter a valid amount for every selected repayment row.",
        variant: "destructive",
      });
      return;
    }

    setRecordingBatch(true);
    try {
      await loanRepaymentsService.batchRecord(entries);
      await refreshLoanData();
      toast({
        title: "Batch posted",
        description: `${entries.length} repayments recorded, total ${formatUGX(batchTotal)}.`,
      });
      clearBatchState();
    } catch (error) {
      toast({
        title: "Batch failed",
        description: error instanceof Error ? error.message : "We could not post this repayment batch.",
        variant: "destructive",
      });
    } finally {
      setRecordingBatch(false);
    }
  };

  const resetChargeForm = () => {
    setChargeForm({
      kind: "processing_fee",
      amount: "",
      note: "",
    });
  };

  const handleAddCharge = async () => {
    if (!selected) return;
    const amount = Number(chargeForm.amount);
    if (!amount) {
      toast({
        title: "Amount required",
        description: "Enter a valid charge amount.",
        variant: "destructive",
      });
      return;
    }

    const appliesToMonth = selected.repaymentPlan?.[0]?.month;
    if (!appliesToMonth) {
      toast({
        title: "No first month available",
        description: "This loan does not have a scheduled first repayment month yet.",
        variant: "destructive",
      });
      return;
    }

    setSavingCharge(true);
    try {
      await loanChargesService.add({
        loanId: selected.id,
        kind: chargeForm.kind,
        amount,
        note: chargeForm.note || undefined,
        description: chargeForm.note || humanizeChargeKind(chargeForm.kind),
        appliesToMonth,
      });
      await refreshLoanData();
      toast({
        title: "Charge added",
        description: `${formatUGX(amount)} added${appliesToMonth ? ` for ${formatMonth(appliesToMonth)}` : ""}.`,
      });
      resetChargeForm();
    } catch (error) {
      toast({
        title: "Charge save failed",
        description: error instanceof Error ? error.message : "We could not save this charge.",
        variant: "destructive",
      });
    } finally {
      setSavingCharge(false);
    }
  };

  const handleRemoveCharge = async (charge: LoanCharge) => {
    setRemovingChargeId(charge.id);
    try {
      await loanChargesService.remove(charge.id);
      await refreshLoanData();
      toast({ title: "Charge removed", description: charge.description });
    } catch (error) {
      toast({
        title: "Remove failed",
        description: error instanceof Error ? error.message : "We could not remove this charge.",
        variant: "destructive",
      });
    } finally {
      setRemovingChargeId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Loans"
        description="Approve applications, track outstanding balances and manage repayments and charges."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Portfolio value"
          value={formatUGX(stats.portfolio)}
          icon={Banknote}
          accent="primary"
          loading={loans.isLoading}
          hint={`${list.length} loans`}
        />
        <KpiCard
          label="Outstanding"
          value={formatUGX(stats.outstanding)}
          icon={CheckCircle2}
          accent="success"
          loading={loans.isLoading}
          hint={`${stats.active} active`}
        />
        <KpiCard
          label="Overdue"
          value={formatUGX(overdueAmount)}
          icon={AlertTriangle}
          accent={overdueAmount > 0 ? "destructive" : "muted"}
          loading={loans.isLoading}
        />
        <KpiCard
          label="Failed / rejected"
          value={String(stats.failed)}
          icon={AlertTriangle}
          accent="info"
          loading={loans.isLoading}
        />
      </div>

      <div className="mt-6 rounded-xl border bg-card shadow-[var(--shadow-sm)]">
        <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by member or loan ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                <SelectItem value="short_term">Short term</SelectItem>
                <SelectItem value="long_term">Long term</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                <SelectItem value="pending_admin_approval">Pending admin</SelectItem>
                <SelectItem value="pending_guarantor_approval">Pending guarantor</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="guarantor_coverage_failed">Coverage failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Member</th>
                <th className="text-right">Loans</th>
                <th className="text-right">Active</th>
                <th className="text-right">Pending</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Outstanding</th>
                <th>Latest</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loans.isLoading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 8 }).map((__, j) => (
                    <td key={j}><Skeleton className="h-4 w-20" /></td>
                  ))}
                </tr>
              ))}

              {!loans.isLoading && groupedLoans.map((group) => (
                <Fragment key={`member-${group.memberId}`}>
                  <tr className="bg-muted/20">
                    <td>
                      <div className="flex items-center gap-3">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => toggleMember(group.memberId)}
                        >
                          {expandedMembers.has(group.memberId) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                        <div className="min-w-0">
                          <p className="font-medium">{group.memberName}</p>
                          <p className="text-xs text-muted-foreground">{group.memberNumber}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-right">{group.loans.length}</td>
                    <td className="text-right">{group.activeCount}</td>
                    <td className="text-right">{group.pendingCount}</td>
                    <td className="text-right font-mono">{formatUGX(group.totalAmount)}</td>
                    <td className="text-right font-mono">{formatUGX(group.totalOutstanding)}</td>
                    <td className="text-muted-foreground">{formatDate(group.latestCreatedAt)}</td>
                    <td className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => toggleMember(group.memberId)}>
                        {expandedMembers.has(group.memberId) ? "Hide details" : "Show loans"}
                      </Button>
                    </td>
                  </tr>

                  {expandedMembers.has(group.memberId) && (
                    <tr>
                      <td colSpan={8} className="bg-background px-4 py-4">
                        <div className="rounded-lg border bg-card">
                          <div className="border-b px-4 py-3">
                            <h3 className="text-sm font-semibold">Individual loans</h3>
                            <p className="text-xs text-muted-foreground">
                              Expanded view for {group.memberName} with detail and decision actions.
                            </p>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>Loan</th>
                                  <th>Type</th>
                                  <th className="text-right">Amount</th>
                                  <th className="text-right">Balance</th>
                                  <th>Duration</th>
                                  <th>Status</th>
                                  <th>Submitted</th>
                                  <th className="text-right">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...group.loans].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map((loan) => {
                                  const canApprove = loan.status === "pending_admin_approval";
                                  const loanOrdinal = loanLabel(loan.id);

                                  return (
                                    <tr key={loan.id}>
                                      <td className="font-medium">{loanOrdinal}</td>
                                      <td className="capitalize">{String(loan.loanType).replace("_", " ")}</td>
                                      <td className="text-right font-mono">{formatUGX(loan.amount)}</td>
                                      <td className="text-right font-mono">{formatUGX(loan.balance)}</td>
                                      <td>{loan.duration} mo</td>
                                      <td><StatusBadge status={loan.status as LoanStatus} /></td>
                                      <td className="text-muted-foreground">{formatDate(loan.createdAt)}</td>
                                      <td className="text-right">
                                        <div className="flex justify-end gap-2">
                                          <Button variant="ghost" size="sm" onClick={() => setSelected(loan)}>
                                            <Eye className="mr-1 h-4 w-4" /> View
                                          </Button>
                                          {canApprove && (
                                            <>
                                              <Button
                                                size="sm"
                                                onClick={() => handleApprove(loan)}
                                                disabled={approvingLoanId === loan.id}
                                              >
                                                <Check className="mr-1 h-4 w-4" />
                                                {approvingLoanId === loan.id ? "Approving..." : "Approve"}
                                              </Button>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => openRejectDialog(loan)}
                                                disabled={rejectingLoanId === loan.id}
                                              >
                                                <X className="mr-1 h-4 w-4" /> Reject
                                              </Button>
                                            </>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}

              {!loans.isLoading && groupedLoans.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12">
                    <EmptyState title="No loans match your filters" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Tabs defaultValue="single" className="mt-6">
        <TabsList>
          <TabsTrigger value="single"><Wallet className="mr-1 h-4 w-4" /> Single repayment</TabsTrigger>
          <TabsTrigger value="batch"><ClipboardCheck className="mr-1 h-4 w-4" /> Batch payroll</TabsTrigger>
          <TabsTrigger value="early">Early repayments</TabsTrigger>
        </TabsList>

        <TabsContent value="single" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-sm)] lg:col-span-1">
              <h3 className="text-sm font-semibold">Record one repayment</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Post an individual repayment against the next unpaid scheduled month for a loan.
              </p>

              <div className="mt-4 grid gap-3">
                <div className="grid gap-2">
                  <Label>Loan</Label>
                  <Select
                    value={singleForm.loanId}
                    onValueChange={(value) => setSingleForm((current) => ({ ...current, loanId: value, month: "", amount: "" }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Choose a loan" /></SelectTrigger>
                    <SelectContent>
                      {singleLoanOptions.map((loan) => (
                    <SelectItem key={loan.id} value={loan.id}>
                          {memberName(loan.memberId)} - {loanLabel(loan.id)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Scheduled month</Label>
                  <Select
                    value={singleForm.month}
                    onValueChange={(value) => {
                      const schedule = singleMonthOptions.find((item) => item.month === value);
                      setSingleForm((current) => ({
                        ...current,
                        month: value,
                        amount: schedule ? String(schedule.total) : current.amount,
                      }));
                    }}
                    disabled={!singleLoan}
                  >
                    <SelectTrigger><SelectValue placeholder="Choose a month" /></SelectTrigger>
                    <SelectContent>
                      {singleMonthOptions.map((item) => (
                        <SelectItem key={item.month} value={item.month}>
                          {formatMonth(item.month)} - {formatUGX(item.total)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Amount (UGX)</Label>
                  <Input
                    inputMode="numeric"
                    value={singleForm.amount}
                    onChange={(e) => setSingleForm((current) => ({ ...current, amount: e.target.value.replace(/[^\d]/g, "") }))}
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Payment date</Label>
                  <Input
                    type="date"
                    value={singleForm.paidAt}
                    onChange={(e) => setSingleForm((current) => ({ ...current, paidAt: e.target.value }))}
                  />
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={singleForm.isEarlyPayment}
                    onCheckedChange={(value) => setSingleForm((current) => ({ ...current, isEarlyPayment: Boolean(value) }))}
                  />
                  <span>Mark as early payment</span>
                </label>

                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Calculated status</span>
                    <StatusBadge
                      status={calculateRepaymentStatus(
                        singleForm.month,
                        toTimestamp(singleForm.paidAt) ?? Date.now(),
                      )}
                    />
                  </div>
                  {singleSelectedMonth && (
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      <p>Due date: {singleSelectedMonth.dueDate ? formatDate(singleSelectedMonth.dueDate) : formatMonth(singleSelectedMonth.month)}</p>
                      <p>Scheduled amount: {formatUGX(singleSelectedMonth.total)}</p>
                      <p>Remaining balance after this row: {formatUGX(singleSelectedMonth.balance)}</p>
                    </div>
                  )}
                </div>

                <Button onClick={handleSingleRepayment} disabled={recordingSingle}>
                  {recordingSingle ? "Posting..." : "Record repayment"}
                </Button>
              </div>
            </div>

            <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)] lg:col-span-2">
              <div className="border-b p-4">
                <h3 className="text-sm font-semibold">Upcoming and overdue schedule rows</h3>
                <p className="text-xs text-muted-foreground">
                  Use any row here to prefill the single repayment form with the next due month.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Loan</th>
                      <th>Month</th>
                      <th>Due</th>
                      <th className="text-right">Scheduled</th>
                      <th>Status</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loans.isLoading && Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 7 }).map((__, j) => (
                          <td key={j}><Skeleton className="h-4 w-24" /></td>
                        ))}
                      </tr>
                    ))}
                    {!loans.isLoading && dueRows.map((row) => (
                      <tr key={row.key}>
                        <td>
                          <div>
                            <p className="font-medium">{row.memberName}</p>
                            <p className="text-xs text-muted-foreground">{row.memberNumber}</p>
                          </div>
                        </td>
                        <td>{row.loanLabel}</td>
                        <td>{formatMonth(row.month)}</td>
                        <td className="text-muted-foreground">{row.dueDate ? formatDate(row.dueDate) : formatMonth(row.month)}</td>
                        <td className="text-right font-mono">{formatUGX(row.total)}</td>
                        <td><StatusBadge status={row.status} /></td>
                        <td className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => prefillSingleFromDue(row)}>
                            Use row
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {!loans.isLoading && dueRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-12">
                          <EmptyState title="No unpaid schedule rows" description="Nothing is currently due or overdue." />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="batch" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-sm)] lg:col-span-1">
              <h3 className="text-sm font-semibold">Payroll posting</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Tick off same-day due rows, set a payment date once, then post the whole payroll batch.
              </p>

              <div className="mt-4 grid gap-3">
                <div className="grid gap-2">
                  <Label>Batch payment date</Label>
                  <Input type="date" value={batchPaidAt} onChange={(e) => setBatchPaidAt(e.target.value)} />
                </div>

                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Selected rows</span>
                    <span className="font-medium">{selectedBatchCount}</span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span className="text-muted-foreground">Total to post</span>
                    <span className="font-mono font-medium">{formatUGX(batchTotal)}</span>
                  </div>
                </div>

                <Button onClick={handleBatchRepayment} disabled={recordingBatch || selectedBatchCount === 0}>
                  {recordingBatch ? "Posting batch..." : "Post batch"}
                </Button>
                <Button variant="ghost" onClick={clearBatchState} disabled={selectedBatchCount === 0 || recordingBatch}>
                  Clear selections
                </Button>
              </div>
            </div>

            <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)] lg:col-span-2">
              <div className="border-b p-4">
                <h3 className="text-sm font-semibold">Due groups by repayment day</h3>
                <p className="text-xs text-muted-foreground">
                  Grouped by scheduled due date to support payroll-style posting for the same day.
                </p>
              </div>

              <ScrollArea className="h-[520px]">
                <div className="divide-y">
                  {dueGroups.map(([groupDate, rows]) => {
                    const selectedInGroup = rows.filter((row) => batchSelected.has(row.key)).length;
                    const allSelected = rows.length > 0 && selectedInGroup === rows.length;

                    return (
                      <section key={groupDate} className="p-4">
                        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <CalendarDays className="h-4 w-4 text-muted-foreground" />
                              <h4 className="text-sm font-semibold">{formatDate(groupDate)}</h4>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {rows.length} due rows, {selectedInGroup} selected
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleBatchGroup(rows, !allSelected)}
                          >
                            {allSelected ? "Clear group" : "Select group"}
                          </Button>
                        </div>

                        <div className="space-y-2">
                          {rows.map((row) => {
                            const checked = batchSelected.has(row.key);
                            return (
                              <div key={row.key} className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(value) => toggleBatchSelection(row.key, Boolean(value))}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-medium">{row.memberName}</p>
                                    <span className="text-xs text-muted-foreground">{row.memberNumber}</span>
                                    <StatusBadge status={row.status} />
                                  </div>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Loan {row.loanId}, {formatMonth(row.month)}, outstanding {formatUGX(row.outstanding)}
                                  </p>
                                </div>
                                <div className="w-full md:w-40">
                                  <Input
                                    inputMode="numeric"
                                    disabled={!checked}
                                    value={batchAmounts[row.key] ?? ""}
                                    placeholder="Amount"
                                    onFocus={() => {
                                      if (!checked) toggleBatchSelection(row.key, true);
                                    }}
                                    onChange={(e) => {
                                      const value = e.target.value.replace(/[^\d]/g, "");
                                      if (!checked) toggleBatchSelection(row.key, true);
                                      setBatchAmounts((current) => ({ ...current, [row.key]: value }));
                                    }}
                                  />
                                </div>
                                <div className="w-full text-right text-sm md:w-28">
                                  <p className="font-mono">{formatUGX(row.total)}</p>
                                  <p className="text-xs text-muted-foreground">scheduled</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}

                  {dueGroups.length === 0 && (
                    <div className="p-6">
                      <EmptyState
                        title="No grouped due rows"
                        description="All active loans are either fully paid for this period or do not have an unpaid schedule row."
                      />
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="early" className="mt-4">
          <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)]">
            <div className="border-b p-4">
              <h3 className="text-sm font-semibold">Early repayment review queue</h3>
              <p className="text-xs text-muted-foreground">
                Approve or reject member requests, then mark approved requests as paid to post the early-settlement repayment rows.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Loan</th>
                    <th>Requested</th>
                    <th>For date</th>
                    <th className="text-right">Amount</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {earlyRepayments.isLoading && Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j}><Skeleton className="h-4 w-20" /></td>
                      ))}
                    </tr>
                  ))}
                  {!earlyRepayments.isLoading && (earlyRepayments.data ?? []).map((request) => (
                    <tr key={request.id}>
                      <td className="font-medium">{memberName(request.memberId)}</td>
                      <td>{loanLabel(request.loanId)}</td>
                      <td>{formatDate(request.requestedAt)}</td>
                      <td>{request.requestedForDate ? formatDate(request.requestedForDate) : "-"}</td>
                      <td className="text-right font-mono">{formatUGX(request.amount)}</td>
                      <td><StatusBadge status={request.status} /></td>
                      <td className="text-right">
                        <div className="flex justify-end gap-2">
                          {request.status === "pending" && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleApproveEarlyRepayment(request)}
                                disabled={processingEarlyRepaymentId === request.id}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleRejectEarlyRepayment(request)}
                                disabled={processingEarlyRepaymentId === request.id}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {request.status === "approved" && (
                            <Button
                              size="sm"
                              onClick={() => handleMarkEarlyRepaymentPaid(request)}
                              disabled={processingEarlyRepaymentId === request.id}
                            >
                              Mark paid
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!earlyRepayments.isLoading && (earlyRepayments.data?.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12">
                        <EmptyState title="No early repayment requests" description="Member requests will appear here once submitted." />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{loanLabel(selected.id)}</SheetTitle>
                <SheetDescription className="capitalize">
                  {memberName(selected.memberId)} - {String(selected.loanType).replace("_", " ")} loan, {formatUGX(selected.amount)}, {selected.duration} months
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <Stat label="Status"><StatusBadge status={selected.status as LoanStatus} /></Stat>
                <Stat label="Balance" value={formatUGX(selected.balance)} />
                <Stat label="Interest rate" value={`${selected.monthlyInterestRateApplied}% / mo`} />
                <Stat label="Mode" value={String(selected.interestCalculationModeApplied).replace("_", " ")} />
                <Stat label="Submitted" value={formatDate(selected.createdAt)} />
                <Stat label="Approved" value={selected.approvedAt ? formatDate(selected.approvedAt) : "-"} />
              </div>

              {selected.purpose && (
                <div className="mt-4 rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Purpose</p>
                  <p className="mt-1 text-sm">{selected.purpose}</p>
                </div>
              )}

              {selected.guarantorRequired && (
                <div className="mt-4">
                  <h4 className="text-sm font-semibold">Guarantors</h4>
                  <ul className="mt-2 space-y-2">
                    {loanGuarantors(selected.id).map((guarantor) => (
                      <li key={guarantor.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                        <div>
                          <p className="font-medium">{memberName(guarantor.guarantorId)}</p>
                          <p className="text-xs text-muted-foreground">{formatUGX(guarantor.guaranteedAmount)} guaranteed</p>
                        </div>
                        <StatusBadge status={guarantor.status} />
                      </li>
                    ))}
                    {loanGuarantors(selected.id).length === 0 && (
                      <li className="text-sm text-muted-foreground">No guarantor records.</li>
                    )}
                  </ul>
                </div>
              )}

              <div className="mt-4">
                <h4 className="text-sm font-semibold">Repayment schedule</h4>
                <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th className="text-right">Total</th>
                        <th className="text-right">Principal</th>
                        <th className="text-right">Interest</th>
                        <th className="text-right">Balance</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.repaymentPlan?.map((item) => (
                        <tr key={item.month}>
                          <td>{formatMonth(item.month)}</td>
                          <td className="text-right font-mono">{formatUGX(item.total)}</td>
                          <td className="text-right font-mono">{formatUGX(item.principal)}</td>
                          <td className="text-right font-mono">{formatUGX(item.interest)}</td>
                          <td className="text-right font-mono">{formatUGX(item.balance)}</td>
                          <td><StatusBadge status={item.status} /></td>
                        </tr>
                      ))}
                      {(!selected.repaymentPlan || selected.repaymentPlan.length === 0) && (
                        <tr>
                          <td colSpan={6} className="py-4 text-center text-sm text-muted-foreground">
                            No repayment schedule available.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-4">
                <h4 className="text-sm font-semibold">Recorded repayments</h4>
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th className="text-right">Amount</th>
                        <th>Paid</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loanRepayments(selected.id).map((repayment) => (
                        <tr key={repayment.id}>
                          <td>{formatMonth(repayment.month)}</td>
                          <td className="text-right font-mono">{formatUGX(repayment.amount)}</td>
                          <td className="text-muted-foreground">{formatDate(repayment.paidAt)}</td>
                          <td><StatusBadge status={repayment.paymentStatus} /></td>
                        </tr>
                      ))}
                      {loanRepayments(selected.id).length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-4 text-center text-sm text-muted-foreground">
                            No repayments recorded yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-4">
                <h4 className="text-sm font-semibold">Charges</h4>
                <div className="mt-2 rounded-lg border bg-muted/20 p-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label>Charge type</Label>
                      <Select
                        value={chargeForm.kind ?? "processing_fee"}
                        onValueChange={(value) => setChargeForm((current) => ({ ...current, kind: value as LoanCharge["kind"] }))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="processing_fee">Processing fee</SelectItem>
                          <SelectItem value="penalty">Penalty</SelectItem>
                          <SelectItem value="insurance">Insurance</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>Amount (UGX)</Label>
                      <Input
                        inputMode="numeric"
                        value={chargeForm.amount}
                        onChange={(e) => setChargeForm((current) => ({ ...current, amount: e.target.value.replace(/[^\d]/g, "") }))}
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2">
                    <Label>Note / label</Label>
                    <Input
                      value={chargeForm.note}
                      placeholder="First-month bank charge"
                      onChange={(e) => setChargeForm((current) => ({ ...current, note: e.target.value }))}
                    />
                  </div>

                  <div className="mt-3 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                    Charges are currently attached to the first scheduled installment only.
                    {selected.repaymentPlan?.[0]?.month ? ` This loan's first month is ${formatMonth(selected.repaymentPlan[0].month)}.` : ""}
                  </div>

                  <Button className="mt-4" size="sm" onClick={handleAddCharge} disabled={savingCharge}>
                    <Plus className="mr-1 h-4 w-4" /> {savingCharge ? "Saving..." : "Add charge"}
                  </Button>
                </div>

                <div className="mt-4 space-y-4">
                  {groupLoanCharges(loanCharges(selected.id), selected).map((group) => (
                    <div key={group.key} className="rounded-lg border">
                      <div className="border-b bg-muted/20 px-3 py-2">
                        <p className="text-sm font-medium">{group.label}</p>
                      </div>
                      <ul className="divide-y">
                        {group.charges.map((charge) => (
                          <li key={charge.id} className="flex items-center justify-between gap-3 px-3 py-3 text-sm">
                            <div className="min-w-0">
                              <p className="font-medium">{charge.description}</p>
                              <p className="text-xs text-muted-foreground">
                                {humanizeChargeKind(charge.kind)} · added {formatDate(charge.createdAt)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono">{formatUGX(charge.amount)}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleRemoveCharge(charge)}
                                disabled={removingChargeId === charge.id}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {loanCharges(selected.id).length === 0 && (
                    <p className="text-sm text-muted-foreground">No charges recorded.</p>
                  )}
                </div>
              </div>

              {selected.status === "pending_admin_approval" && (
                <div className="mt-6 flex gap-2">
                  <Button className="flex-1" onClick={() => handleApprove(selected)} disabled={approvingLoanId === selected.id}>
                    <Check className="mr-1 h-4 w-4" /> {approvingLoanId === selected.id ? "Approving..." : "Approve"}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => openRejectDialog(selected)}
                    disabled={rejectingLoanId === selected.id}
                  >
                    <X className="mr-1 h-4 w-4" /> Reject
                  </Button>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject loan</DialogTitle>
            <DialogDescription>Provide a reason. This will be visible to the member.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" rows={4} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={!!rejectingLoanId}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={!!rejectingLoanId}>
              {rejectingLoanId ? "Rejecting..." : "Reject loan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {children ? <div className="mt-1">{children}</div> : <p className="mt-1 font-medium">{value}</p>}
    </div>
  );
}

function isoDateInput(iso: string) {
  return iso.slice(0, 10);
}

function humanizeChargeKind(kind?: LoanCharge["kind"]) {
  return String(kind ?? "other").replace(/_/g, " ");
}
