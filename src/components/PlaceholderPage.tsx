import { Construction } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";

interface PlaceholderPageProps {
  title: string;
  description?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function PlaceholderPage({ title, description, emptyTitle, emptyDescription }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={Construction}
        title={emptyTitle ?? "Module coming online"}
        description={
          emptyDescription ??
          "This screen is part of the foundation scaffold. UI, tables, filters and forms will be added in the next iterations using the existing design system and Convex-ready service layer."
        }
      />
    </>
  );
}
