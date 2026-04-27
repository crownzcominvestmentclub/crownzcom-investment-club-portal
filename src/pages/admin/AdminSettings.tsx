import { useEffect, useState } from "react";
import { Save, Settings as SettingsIcon } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useFinancialConfig } from "@/hooks/data";
import type { FinancialConfig, InterestMode } from "@/lib/types";

export default function AdminSettings() {
  const cfg = useFinancialConfig();
  const { toast } = useToast();
  const [form, setForm] = useState<FinancialConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (cfg.data && !form) setForm(cfg.data);
  }, [cfg.data, form]);

  const update = <K extends keyof FinancialConfig>(key: K, value: FinancialConfig[K]) => {
    if (!form) return;
    setForm({ ...form, [key]: value });
  };

  const save = async () => {
    setSaving(true);
    try {
      toast({ title: "Settings saved", description: "Financial configuration updated." });
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
          <Button onClick={save} disabled={saving}>
            <Save className="mr-1 h-4 w-4" /> {saving ? "Saving..." : "Save changes"}
          </Button>
        }
      />

      <Tabs defaultValue="lending">
        <TabsList>
          <TabsTrigger value="lending">Lending</TabsTrigger>
          <TabsTrigger value="charges">Charges & limits</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
        </TabsList>

        <TabsContent value="lending" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Interest rates" description="Monthly interest applied to new loans.">
              <Field label="Short-term rate (% / month)">
                <Input type="number" step="0.1" value={form.loanInterestRate} onChange={(e) => update("loanInterestRate", Number(e.target.value))} />
              </Field>
              <Field label="Long-term rate (% / month)">
                <Input type="number" step="0.1" value={form.longTermInterestRate} onChange={(e) => update("longTermInterestRate", Number(e.target.value))} />
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
              <Field label="Loan eligibility (% of savings)">
                <Input type="number" value={form.loanEligibilityPercentage} onChange={(e) => update("loanEligibilityPercentage", Number(e.target.value))} />
              </Field>
              <Field label="Max short-term duration (months)">
                <Input type="number" value={form.maxLoanDuration} onChange={(e) => update("maxLoanDuration", Number(e.target.value))} />
              </Field>
              <Field label="Max long-term duration (months)">
                <Input type="number" value={form.longTermMaxRepaymentMonths} onChange={(e) => update("longTermMaxRepaymentMonths", Number(e.target.value))} />
              </Field>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="charges" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Charges" description="Default fees applied to lending operations.">
              <Field label="Default bank charge (UGX)">
                <Input type="number" value={form.defaultBankCharge} onChange={(e) => update("defaultBankCharge", Number(e.target.value))} />
              </Field>
              <Field label="Early repayment penalty (%)">
                <Input type="number" step="0.1" value={form.earlyRepaymentPenalty} onChange={(e) => update("earlyRepaymentPenalty", Number(e.target.value))} />
              </Field>
            </Card>
            <Card title="Loan limits" description="Minimum and maximum loan amounts.">
              <Field label="Minimum loan amount (UGX)">
                <Input type="number" value={form.minLoanAmount} onChange={(e) => update("minLoanAmount", Number(e.target.value))} />
              </Field>
              <Field label="Maximum loan amount (UGX)">
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
