import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string;
  icon?: LucideIcon;
  trend?: { value: string; direction: "up" | "down" | "neutral" };
  hint?: string;
  loading?: boolean;
  className?: string;
  accent?: "primary" | "info" | "warning" | "success";
}

const accentMap = {
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  warning: "bg-warning/15 text-warning",
  success: "bg-success/10 text-success",
};

export function KpiCard({ label, value, icon: Icon, trend, hint, loading, className, accent = "primary" }: KpiCardProps) {
  if (loading) {
    return (
      <div className={cn("kpi-card", className)}>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-7 w-32" />
        <Skeleton className="mt-2 h-3 w-20" />
      </div>
    );
  }
  return (
    <div className={cn("kpi-card", className)}>
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", accentMap[accent])}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {trend && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium",
              trend.direction === "up" && "bg-success/10 text-success",
              trend.direction === "down" && "bg-destructive/10 text-destructive",
              trend.direction === "neutral" && "bg-muted text-muted-foreground"
            )}
          >
            {trend.direction === "up" && <ArrowUpRight className="h-3 w-3" />}
            {trend.direction === "down" && <ArrowDownRight className="h-3 w-3" />}
            {trend.value}
          </span>
        )}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}
