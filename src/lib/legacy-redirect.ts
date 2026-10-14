import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_SPORT, type Sport } from "@/lib/sports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Old addresses without a sport (/events, /events/<id>, /partner/<id>…) still
 * work: they forward to the record's own sport section, keeping the query.
 * Links in older notifications and shared posts use these.
 */
export async function forwardToSport(
  req: NextRequest,
  section: "events" | "partner" | "instructors" | "levels",
  rest: string[] = [],
  sportOf?: (id: string) => Promise<Sport>,
) {
  const first = rest[0];
  const sport = first && UUID.test(first) && sportOf ? await sportOf(first) : DEFAULT_SPORT;
  const tail = rest.length ? "/" + rest.map(encodeURIComponent).join("/") : "";
  const url = new URL(`/${sport}/${section}${tail}`, req.url);
  url.search = req.nextUrl.search;
  return NextResponse.redirect(url, 307);
}
