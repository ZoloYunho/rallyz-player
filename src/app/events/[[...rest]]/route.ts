import type { NextRequest } from "next/server";
import { forwardToSport } from "@/lib/legacy-redirect";
import { eventSport } from "@/lib/sport-of";

export async function GET(req: NextRequest, ctx: RouteContext<"/events/[[...rest]]">) {
  const { rest } = await ctx.params;
  return forwardToSport(req, "events", rest, eventSport);
}
