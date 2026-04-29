import { useMemo, useState } from "react";
import { Upload, FileText, FolderOpen, Search, Download, Tag } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useDocumentCategories, useDocuments } from "@/hooks/data";
import { formatDate } from "@/lib/format";

const ALL = "all";

export default function AdminDocuments() {
  const docs = useDocuments();
  const cats = useDocumentCategories();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string>(ALL);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ title: "", category: "", period: "", notes: "", tags: "" });

  const filtered = useMemo(() => {
    return (docs.data ?? []).filter((d) => {
      if (cat !== ALL && d.category !== cat) return false;
      if (search && !d.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    }).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }, [docs.data, search, cat]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    docs.data?.forEach((d) => map.set(d.category, (map.get(d.category) ?? 0) + 1));
    return map;
  }, [docs.data]);

  const handleUpload = async () => {
    if (!form.title || !form.category) {
      toast({ title: "Missing fields", description: "Title and category are required.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      toast({ title: "Document uploaded", description: form.title });
      setOpen(false);
      setForm({ title: "", category: "", period: "", notes: "", tags: "" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Documents"
        description="Upload and share AGM minutes, policies, statements and other club records."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Upload className="mr-1 h-4 w-4" /> Upload</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload document</DialogTitle>
                <DialogDescription>Add a new document to the library. File upload is wired separately via R2 (uploadToR2 + documents.register).</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-2">
                  <Label>Title</Label>
                  <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Category</Label>
                    <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                      <SelectTrigger><SelectValue placeholder="Choose..." /></SelectTrigger>
                      <SelectContent>
                        {cats.data?.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Period</Label>
                    <Input placeholder="2024" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Tags (comma-separated)</Label>
                  <Input placeholder="agm, policy" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Notes</Label>
                  <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>File</Label>
                  <Input type="file" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
                <Button onClick={handleUpload} disabled={submitting}>{submitting ? "Uploading..." : "Upload"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard label="Documents" value={String(docs.data?.length ?? 0)} icon={FileText} accent="primary" loading={docs.isLoading} />
        <KpiCard label="Categories" value={String(cats.data?.length ?? 0)} icon={FolderOpen} accent="info" loading={cats.isLoading} />
        <KpiCard label="Filtered" value={String(filtered.length)} icon={Tag} accent="success" loading={docs.isLoading} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-sm)] lg:col-span-1">
          <h3 className="text-sm font-semibold">Categories</h3>
          <ul className="mt-3 space-y-1">
            <li>
              <button
                onClick={() => setCat(ALL)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition ${cat === ALL ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
              >
                <span>All documents</span>
                <span className="text-xs text-muted-foreground">{docs.data?.length ?? 0}</span>
              </button>
            </li>
            {cats.data?.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setCat(c.name)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition ${cat === c.name ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{byCategory.get(c.name) ?? 0}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)] lg:col-span-3">
          <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full md:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search documents" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
          </div>
          <div className="divide-y">
            {filtered.length === 0 && (
              <div className="p-6">
                <EmptyState
                  title="No documents found"
                  description={cat !== ALL ? `No documents in "${cat}".` : "Try a different search."}
                  icon={FileText}
                />
              </div>
            )}
            {filtered.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{d.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {d.category} · {d.period ?? "—"} · uploaded {formatDate(d.uploadedAt)}
                    </p>
                    {d.tags && d.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {d.tags.map((t) => (
                          <span key={t} className="rounded-full border bg-muted/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="sm">
                  <Download className="mr-1 h-4 w-4" /> Download
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
