import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Upload, FileText, FolderOpen, Search, Download, Tag, Edit, Trash2, Eye } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryKeys, useDocumentCategories, useDocuments } from "@/hooks/data";
import { formatDate } from "@/lib/format";
import { uploadToR2 } from "@/lib/api";
import { documentsService } from "@/services";
import type { DocumentRecord } from "@/lib/types";

const ALL = "all";

type DocumentFormState = {
  title: string;
  categoryId: string;
  period: string;
  notes: string;
  tags: string;
  scope: "general" | "loan_terms";
};

const EMPTY_FORM: DocumentFormState = {
  title: "",
  categoryId: "",
  period: "",
  notes: "",
  tags: "",
  scope: "general",
};

export default function AdminDocuments() {
  const docs = useDocuments();
  const cats = useDocumentCategories();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string>(ALL);
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<DocumentRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<DocumentFormState>(EMPTY_FORM);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    return (docs.data ?? [])
      .filter((document) => {
        if (cat !== ALL && document.category !== cat) return false;
        if (search && !document.title.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
  }, [docs.data, search, cat]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    docs.data?.forEach((document) => map.set(document.category, (map.get(document.category) ?? 0) + 1));
    return map;
  }, [docs.data]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setSelectedFile(null);
    setEditingDoc(null);
  };

  const refreshDocuments = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.documents }),
      qc.invalidateQueries({ queryKey: queryKeys.loanTermsDocument }),
    ]);
  };

  const handleEdit = (document: DocumentRecord) => {
    setEditingDoc(document);
    setForm({
      title: document.title,
      categoryId: document.categoryId ?? "",
      period: document.period ?? "",
      notes: document.notes ?? "",
      tags: document.tags?.join(", ") ?? "",
      scope: document.scope ?? "general",
    });
    setEditOpen(true);
  };

  const openDocument = async (documentId: string, download = false) => {
    const url = await documentsService.downloadUrl(documentId);
    if (download) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "";
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.click();
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleUpdate = async () => {
    if (!editingDoc || !form.title || !form.categoryId) {
      toast({ title: "Missing fields", description: "Title and category are required.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const tags = form.tags ? form.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined;
      await documentsService.update(editingDoc.id, {
        title: form.title,
        categoryId: form.categoryId,
        tags,
        period: form.period || undefined,
        notes: form.notes || undefined,
        scope: form.scope,
      });

      await refreshDocuments();
      toast({ title: "Document updated", description: form.title });
      setEditOpen(false);
      resetForm();
    } catch (error) {
      toast({ title: "Update failed", description: String(error), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpload = async () => {
    if (!form.title || !form.categoryId || !selectedFile) {
      toast({ title: "Missing fields", description: "Title, category, and file are required.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const upload = await uploadToR2(selectedFile);
      const tags = form.tags ? form.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined;

      await documentsService.register({
        title: form.title,
        categoryId: form.categoryId,
        objectKey: upload.objectKey,
        contentType: selectedFile.type,
        sizeBytes: selectedFile.size,
        tags,
        period: form.period || undefined,
        notes: form.notes || undefined,
        scope: form.scope,
      });

      await refreshDocuments();
      toast({ title: "Document uploaded", description: form.title });
      setOpen(false);
      resetForm();
    } catch (error) {
      toast({ title: "Upload failed", description: String(error), variant: "destructive" });
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
          <Dialog open={open} onOpenChange={(value) => {
            setOpen(value);
            if (!value) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button size="sm"><Upload className="mr-1 h-4 w-4" /> Upload</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload document</DialogTitle>
                <DialogDescription>Add a new document to the library. Uploads go to R2 and are then registered in the Worker.</DialogDescription>
              </DialogHeader>
              <DocumentForm
                form={form}
                setForm={setForm}
                categories={cats.data ?? []}
                selectedFile={selectedFile}
                setSelectedFile={setSelectedFile}
                submitting={submitting}
                submitLabel={submitting ? "Uploading..." : "Upload"}
                onSubmit={handleUpload}
                onCancel={() => setOpen(false)}
                includeFile
              />
            </DialogContent>
          </Dialog>
        }
      />

      <Dialog open={editOpen} onOpenChange={(value) => {
        setEditOpen(value);
        if (!value) resetForm();
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit document</DialogTitle>
            <DialogDescription>Update document metadata, category, and whether it should power the member loan terms flow.</DialogDescription>
          </DialogHeader>
          <DocumentForm
            form={form}
            setForm={setForm}
            categories={cats.data ?? []}
            selectedFile={null}
            setSelectedFile={() => undefined}
            submitting={submitting}
            submitLabel={submitting ? "Updating..." : "Update"}
            onSubmit={handleUpdate}
            onCancel={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(openState) => !openState && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `This will permanently remove "${deleteTarget.title}" from the document library.` : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={async (event) => {
                event.preventDefault();
                if (!deleteTarget) return;
                setDeleting(true);
                try {
                  await documentsService.remove(deleteTarget.id);
                  await refreshDocuments();
                  toast({ title: "Document deleted" });
                  setDeleteTarget(null);
                } catch (error) {
                  toast({ title: "Delete failed", description: String(error), variant: "destructive" });
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
            {cats.data?.map((category) => (
              <li key={category.id}>
                <button
                  onClick={() => setCat(category.name)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition ${cat === category.name ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
                >
                  <span className="truncate">{category.name}</span>
                  <span className="text-xs text-muted-foreground">{byCategory.get(category.name) ?? 0}</span>
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
            {filtered.map((document) => (
              <div key={document.id} className="flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{document.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {document.category} · {document.period ?? "—"} · uploaded {formatDate(document.uploadedAt)}
                    </p>
                    <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {document.scope === "loan_terms" ? "Loan terms document" : "General document"}
                    </p>
                    {document.tags && document.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {document.tags.map((tag) => (
                          <span key={tag} className="rounded-full border bg-muted/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openDocument(document.id)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openDocument(document.id, true)}>
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleEdit(document)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteTarget(document)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function DocumentForm({
  form,
  setForm,
  categories,
  selectedFile,
  setSelectedFile,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
  includeFile = false,
}: {
  form: DocumentFormState;
  setForm: Dispatch<SetStateAction<DocumentFormState>>;
  categories: Array<{ id: string; name: string }>;
  selectedFile: File | null;
  setSelectedFile: (file: File | null) => void;
  submitting: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  includeFile?: boolean;
}) {
  return (
    <>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label>Title</Label>
          <Input value={form.title} onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label>Category</Label>
            <Select value={form.categoryId} onValueChange={(value) => setForm((current) => ({ ...current, categoryId: value }))}>
              <SelectTrigger><SelectValue placeholder="Choose..." /></SelectTrigger>
              <SelectContent>
                {categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Period</Label>
            <Input placeholder="2024" value={form.period} onChange={(e) => setForm((current) => ({ ...current, period: e.target.value }))} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Document role</Label>
          <Select value={form.scope} onValueChange={(value) => setForm((current) => ({ ...current, scope: value as DocumentFormState["scope"] }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="general">General document</SelectItem>
              <SelectItem value="loan_terms">Loan terms and conditions</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Tags (comma-separated)</Label>
          <Input placeholder="agm, policy" value={form.tags} onChange={(e) => setForm((current) => ({ ...current, tags: e.target.value }))} />
        </div>
        <div className="grid gap-2">
          <Label>Notes</Label>
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))} />
        </div>
        {includeFile && (
          <div className="grid gap-2">
            <Label>File</Label>
            <Input
              type="file"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png"
            />
            {selectedFile && (
              <p className="text-xs text-muted-foreground">
                Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button onClick={onSubmit} disabled={submitting}>{submitLabel}</Button>
      </DialogFooter>
    </>
  );
}
