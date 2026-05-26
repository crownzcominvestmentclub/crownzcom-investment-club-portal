import { useEffect, useState } from "react";
import { Save, User, Mail, Phone, Calendar, Hash } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useMember } from "@/hooks/data";
import { formatDate, initials } from "@/lib/format";
import type { MemberStatus } from "@/lib/types";

export default function MemberProfile() {
  const { user, signOut } = useAuth();
  const memberId = user?.memberId;
  const member = useMember(memberId);
  const { toast } = useToast();

  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (member.data) {
      setForm({ name: member.data.name, email: member.data.email, phone: member.data.phone ?? "" });
    }
  }, [member.data]);

  const save = async () => {
    setSaving(true);
    try {
      toast({ title: "Profile updated", description: "Your changes have been saved." });
    } finally {
      setSaving(false);
    }
  };

  if (!memberId) {
    return (
      <>
        <PageHeader title="Profile" />
        <EmptyState title="No member profile linked" description="An administrator can link your profile from the Members module." />
      </>
    );
  }

  if (member.isLoading || !member.data) {
    return (
      <>
        <PageHeader title="Profile" />
        <Skeleton className="h-48 w-full" />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Profile" description="Your account and contact details." />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-6 shadow-[var(--shadow-sm)] lg:col-span-1">
          <div className="flex flex-col items-center text-center">
            <Avatar className="h-20 w-20">
              <AvatarFallback className="bg-primary/10 text-primary text-xl font-semibold">{initials(member.data.name)}</AvatarFallback>
            </Avatar>
            <h2 className="mt-4 text-lg font-semibold">{member.data.name}</h2>
            <p className="text-sm text-muted-foreground">{member.data.email}</p>
            <div className="mt-3"><StatusBadge status={member.data.status as MemberStatus} /></div>
          </div>
          <dl className="mt-6 space-y-3 text-sm">
            <Row icon={Hash} label="Membership #" value={member.data.membershipNumber} />
            <Row icon={Mail} label="Email" value={member.data.email} />
            {member.data.phone && <Row icon={Phone} label="Phone" value={member.data.phone} />}
            <Row icon={Calendar} label="Joined" value={formatDate(member.data.joinDate)} />
          </dl>

          <Button variant="outline" className="mt-6 w-full" onClick={signOut}>Sign out</Button>
        </div>

        <div className="lg:col-span-2">
          <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-sm)]">
            <h3 className="text-sm font-semibold">Contact details</h3>
            <p className="mt-1 text-xs text-muted-foreground">Keep this current so administrators can reach you.</p>
            <div className="mt-4 grid gap-4">
              <div className="grid gap-2">
                <Label>Full name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="flex justify-end">
                <Button onClick={save} disabled={saving}>
                  <Save className="mr-1 h-4 w-4" /> {saving ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof User; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}
