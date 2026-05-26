import { cn } from "@/lib/utils";
import type { LoanStatus, GuarantorStatus, MemberStatus, EarlyRepaymentStatus } from "@/lib/types";

type AnyStatus = LoanStatus | GuarantorStatus | MemberStatus | EarlyRepaymentStatus | string;

const styles: Record<string, string> = {
  // Loan
  pending_guarantor_approval: "bg-warning/15 text-warning border-warning/20",
  pending_admin_approval: "bg-info/10 text-info border-info/20",
  active: "bg-success/10 text-success border-success/20",
  completed: "bg-muted text-muted-foreground border-border",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
  guarantor_coverage_failed: "bg-destructive/10 text-destructive border-destructive/20",
  // Guarantor
  pending: "bg-warning/15 text-warning border-warning/20",
  approved: "bg-success/10 text-success border-success/20",
  declined: "bg-destructive/10 text-destructive border-destructive/20",
  released: "bg-muted text-muted-foreground border-border",
  // Member
  inactive: "bg-muted text-muted-foreground border-border",
  suspended: "bg-destructive/10 text-destructive border-destructive/20",
  // Early repayment
  paid: "bg-success/10 text-success border-success/20",
  late: "bg-destructive/10 text-destructive border-destructive/20",
  early: "bg-success/10 text-success border-success/20",
  cancelled: "bg-muted text-muted-foreground border-border",
};

const labels: Record<string, string> = {
  pending_guarantor_approval: "Pending guarantor",
  pending_admin_approval: "Pending admin",
  active: "Active",
  completed: "Completed",
  rejected: "Rejected",
  guarantor_coverage_failed: "Coverage failed",
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
  released: "Released",
  inactive: "Inactive",
  suspended: "Suspended",
  paid: "Paid",
  late: "Late",
  early: "Early",
  cancelled: "Cancelled",
};

export function StatusBadge({ status, className }: { status: AnyStatus; className?: string }) {
  const cls = styles[status] ?? "bg-muted text-muted-foreground border-border";
  const label = labels[status] ?? status;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
        cls,
        className
      )}
    >
      {label}
    </span>
  );
}
