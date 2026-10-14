import { ButtonLink, EmptyState } from "@/components/ui";
import { DEFAULT_SPORT } from "@/lib/sports";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg space-y-4 text-center">
      <EmptyState title="We couldn't find that page">It may have been removed, or you may not have access to it.</EmptyState>
      <ButtonLink href={`/${DEFAULT_SPORT}/events`}>Browse events</ButtonLink>
    </div>
  );
}
