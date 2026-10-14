import { notFound } from "next/navigation";
import { isSport } from "@/lib/sports";

/** Only sports Rallyz runs have pages; /golf/events is a 404. */
export default async function SportLayout({ children, params }: LayoutProps<"/[sport]">) {
  const { sport } = await params;
  if (!isSport(sport)) notFound();
  return children;
}
