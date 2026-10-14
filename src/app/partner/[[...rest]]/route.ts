import type { NextRequest } from "next/server";
import { forwardToSport } from "@/lib/legacy-redirect";
import { postSport } from "@/lib/sport-of";

export async function GET(req: NextRequest, ctx: RouteContext<"/partner/[[...rest]]">) {
  const { rest } = await ctx.params;
  return forwardToSport(req, "partner", rest, postSport);
}
