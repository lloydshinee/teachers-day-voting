import { checkVoteGate, resolveClientIp } from "@/lib/vote/actions";
import { getRemainingVoteAttempts } from "@/lib/vote/rate-limit";

export const dynamic = "force-dynamic";

function extractIpFromHeaders(req: Request): string | undefined {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) {
      return last;
    }
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }
  return undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("tokenHash") || null;
  const ip = await resolveClientIp(extractIpFromHeaders(request));
  const decision = await checkVoteGate(tokenHash, ip);

  if (!decision.allowed) {
    const retryAfterSeconds = decision.retryAfterSeconds;
    return new Response(
      JSON.stringify({
        ok: false,
        code: "RATE_LIMITED",
        message: "Rate limit exceeded. Please wait before retrying.",
        retryAfterSeconds,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfterSeconds),
        },
      },
    );
  }

  const remaining = getRemainingVoteAttempts(ip);
  return Response.json({ ok: true, remaining });
}

export async function POST(request: Request) {
  let tokenHash: string | null = null;
  try {
    const body = await request.json();
    if (body && typeof body.tokenHash === "string") {
      tokenHash = body.tokenHash;
    }
  } catch {
    // Non-JSON or empty body is treated as having no tokenHash
  }

  const ip = await resolveClientIp(extractIpFromHeaders(request));
  const decision = await checkVoteGate(tokenHash, ip);

  if (!decision.allowed) {
    const retryAfterSeconds = decision.retryAfterSeconds;
    return new Response(
      JSON.stringify({
        ok: false,
        code: "RATE_LIMITED",
        message: "Rate limit exceeded. Please wait before retrying.",
        retryAfterSeconds,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfterSeconds),
        },
      },
    );
  }

  const remaining = getRemainingVoteAttempts(ip);
  return Response.json({ ok: true, remaining });
}
