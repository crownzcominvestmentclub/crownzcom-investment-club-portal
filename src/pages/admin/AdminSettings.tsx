import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Save, Settings as SettingsIcon } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryKeys, useFinancialConfig } from "@/hooks/data";
import { financialConfigService } from "@/services";
import type { FinancialConfig, InterestMode } from "@/lib/types";

type ConfigField = keyof Pick<
  FinancialConfig,
  | "loanInterestRate"
  | "longTermInterestRate"
  | "longTermLoansEnabled"
  | "loanInterestRetentionPercentage"
  | "trustInterestRetentionPercentage"
  | "loanEligibilityPercentage"
  | "defaultBankCharge"
  | "earlyRepaymentPenalty"
  | "maxLoanDuration"
  | "longTermMaxRepaymentMonths"
  | "minLoanAmount"
  | "maxLoanAmount"
>;

type ConfigErrors = Partial<Record<ConfigField, string>>;

export default function AdminSettings() {
  const cfg = useFinancialConfig();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<FinancialConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (cfg.data && !form) setForm(cfg.data);
  }, [cfg.data, form]);

  const errors = useMemo(() => validateFinancialConfig(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;

  const update = <K extends keyof FinancialConfig>(key: K, value: FinancialConfig[K]) => {
    if (!form) return;
    setForm({ ...form, [key]: value });
  };

  const save = async () => {
    if (!form) return;
    if (hasErrors) {
      toast({
        title: "Fix validation errors",
        description: "Review the highlighted settings before saving.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const updated = await financialConfigService.update(form);
      setForm(updated);
      qc.setQueryData(queryKeys.financialConfig, updated);
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.financialConfig }),
        qc.invalidateQueries({ queryKey: queryKeys.loans }),
        qc.invalidateQueries({ queryKey: queryKeys.members }),
        qc.invalidateQueries({ queryKey: queryKeys.savings }),
      ]);
      toast({ title: "Settings saved", description: "Financial configuration updated." });
    } catch (error) {
      const description = error instanceof Error ? error.message : "We couldn't save the financial settings.";
      toast({ title: "Save failed", description, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (cfg.isLoading || !form) {
    return (
      <>
        <PageHeader title="Settings" description="Loan terms, eligibility, charges and branding." />
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card p-5"><Skeleton className="h-32 w-full" /></div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Configure loan terms, interest rates, eligibility and operational charges."
        actions={
          <Button onClick={save} disabled={saving || hasErrors}>
            <Save className="mr-1 h-4 w-4" /> {saving ? "Saving..." : "Save changes"}
          </Button>
        }
      />

      {hasErrors && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Resolve the highlighted settings before saving. Loan limits, rates, and durations need valid values.
        </div>
      )}

      <Tabs defaultValue="lending">
        <TabsList>
          <TabsTrigger value="lending">Lending</TabsTrigger>
          <TabsTrigger value="charges">Charges & limits</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
        </TabsList>

        <TabsContent value="lending" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Interest rates" description="Monthly interest applied to new loans.">
              <Field label="Short-term rate (% / month)" error={errors.loanInterestRate}>
                <Input type="number" step="0.1" value={form.loanInterestRate} onChange={(e) => update("loanInterestRate", Number(e.target.value))} />
              </Field>
              <Field label="Long-term loans">
                <div className="flex items-center justify-between rounded-lg border px-3 py-3">
                  <div className="pr-4">
                    <p className="text-sm font-medium">Enable long-term lending</p>
                    <p className="text-xs text-muted-foreground">
                      Turn this off to block new long-term loan applications while keeping existing records visible.
                    </p>
                  </div>
                  <Switch checked={form.longTermLoansEnabled} onCheckedChange={(checked) => update("longTermLoansEnabled", checked)} />
                </div>
              </Field>
              <Field label="Long-term rate (% / month)" error={errors.longTermInterestRate}>
                <Input
                  type="number"
                  step="0.1"
                  value={form.longTermInterestRate}
                  disabled={!form.longTermLoansEnabled}
                  onChange={(e) => update("longTermInterestRate", Number(e.target.value))}
                />
              </Field>
              <Field label="Loan interest retained (%)" error={errors.loanInterestRetentionPercentage}>
                <Input
                  type="number"
                  step="0.1"
                  value={form.loanInterestRetentionPercentage}
                  onChange={(e) => update("loanInterestRetentionPercentage", Number(e.target.value))}
                />
              </Field>
              <Field label="Trust interest retained (%)" error={errors.trustInterestRetentionPercentage}>
                <Input
                  type="number"
                  step="0.1"
                  value={form.trustInterestRetentionPercentage}
                  onChange={(e) => update("trustInterestRetentionPercentage", Number(e.target.value))}
                />
              </Field>
              <Field label="Calculation mode">
                <Select value={form.interestCalculationMode} onValueChange={(v) => update("interestCalculationMode", v as InterestMode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flat">Flat</SelectItem>
                    <SelectItem value="reducing_balance">Reducing balance</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </Card>

            <Card title="Eligibility" description="Borrowing limits relative to a member's savings.">
              <Field label="Loan eligibility (% of savings)" error={errors.loanEligibilityPercentage}>
                <Input type="number" value={form.loanEligibilityPercentage} onChange={(e) => update("loanEligibilityPercentage", Number(e.target.value))} />
              </Field>
              <Field label="Max short-term duration (months)" error={errors.maxLoanDuration}>
                <Input type="number" value={form.maxLoanDuration} onChange={(e) => update("maxLoanDuration", Number(e.target.value))} />
              </Field>
              <Field label="Max long-term duration (months)" error={errors.longTermMaxRepaymentMonths}>
                <Input
                  type="number"
                  value={form.longTermMaxRepaymentMonths}
                  disabled={!form.longTermLoansEnabled}
                  onChange={(e) => update("longTermMaxRepaymentMonths", Number(e.target.value))}
                />
              </Field>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="charges" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Charges" description="Default fees applied to lending operations.">
              <Field label="Default bank charge (UGX)" error={errors.defaultBankCharge}>
                <Input type="number" value={form.defaultBankCharge} onChange={(e) => update("defaultBankCharge", Number(e.target.value))} />
              </Field>
              <Field label="Early repayment penalty (%)" error={errors.earlyRepaymentPenalty}>
                <Input type="number" step="0.1" value={form.earlyRepaymentPenalty} onChange={(e) => update("earlyRepaymentPenalty", Number(e.target.value))} />
              </Field>
            </Card>
            <Card title="Loan limits" description="Minimum and maximum loan amounts.">
              <Field label="Minimum loan amount (UGX)" error={errors.minLoanAmount}>
                <Input type="number" value={form.minLoanAmount} onChange={(e) => update("minLoanAmount", Number(e.target.value))} />
              </Field>
              <Field label="Maximum loan amount (UGX)" error={errors.maxLoanAmount}>
                <Input type="number" value={form.maxLoanAmount} onChange={(e) => update("maxLoanAmount", Number(e.target.value))} />
              </Field>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="branding" className="mt-4">
          <Card title="Branding" description="Club logo and identifiers used on documents.">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <SettingsIcon className="h-7 w-7" />
              </div>
              <div className="flex-1">
                <Label>Logo file</Label>
                <Input type="file" className="mt-2" />
                <p className="mt-1 text-xs text-muted-foreground">PNG or SVG, square format recommended.</p>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-sm)]">
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function validateFinancialConfig(form: FinancialConfig | null): ConfigErrors {
  if (!form) return {};

  const errors: ConfigErrors = {};
  const isWholeNumber = (value: number) => Number.isInteger(value);

  if (!Number.isFinite(form.loanInterestRate) || form.loanInterestRate < 0 || form.loanInterestRate > 100) {
    errors.loanInterestRate = "Use a monthly rate between 0% and 100%.";
  }
  if (!Number.isFinite(form.longTermInterestRate) || form.longTermInterestRate < 0 || form.longTermInterestRate > 100) {
    errors.longTermInterestRate = "Use a monthly rate between 0% and 100%.";
  }
  if (!Number.isFinite(form.loanInterestRetentionPercentage) || form.loanInterestRetentionPercentage < 0 || form.loanInterestRetentionPercentage > 100) {
    errors.loanInterestRetentionPercentage = "Use a retention percentage between 0% and 100%.";
  }
  if (!Number.isFinite(form.trustInterestRetentionPercentage) || form.trustInterestRetentionPercentage < 0 || form.trustInterestRetentionPercentage > 100) {
    errors.trustInterestRetentionPercentage = "Use a retention percentage between 0% and 100%.";
  }
  if (!Number.isFinite(form.maxLoanDuration) || form.maxLoanDuration < 1 || !isWholeNumber(form.maxLoanDuration)) {
    errors.maxLoanDuration = "Use a whole number of months greater than or equal to 1.";
  }
  if (!Number.isFinite(form.loanEligibilityPercentage) || form.loanEligibilityPercentage <= 0 || form.loanEligibilityPercentage > 100) {
    errors.loanEligibilityPercentage = "Eligibility must be greater than 0% and not exceed 100%.";
  }
  if (!Number.isFinite(form.longTermMaxRepaymentMonths) || form.longTermMaxRepaymentMonths < 1 || !isWholeNumber(form.longTermMaxRepaymentMonths)) {
    errors.longTermMaxRepaymentMonths = "Use a whole number of months greater than or equal to 1.";
  }
  if (!Number.isFinite(form.defaultBankCharge) || form.defaultBankCharge < 0) {
    errors.defaultBankCharge = "Bank charge cannot be negative.";
  }
  if (!Number.isFinite(form.earlyRepaymentPenalty) || form.earlyRepaymentPenalty < 0 || form.earlyRepaymentPenalty > 100) {
    errors.earlyRepaymentPenalty = "Penalty must be between 0% and 100%.";
  }
  if (!Number.isFinite(form.minLoanAmount) || form.minLoanAmount < 0) {
    errors.minLoanAmount = "Minimum loan amount cannot be negative.";
  }
  if (!Number.isFinite(form.maxLoanAmount) || form.maxLoanAmount <= 0) {
    errors.maxLoanAmount = "Maximum loan amount must be greater than zero.";
  } else if (form.maxLoanAmount < form.minLoanAmount) {
    errors.maxLoanAmount = "Maximum loan amount must be greater than or equal to the minimum.";
  }

  return errors;
}
