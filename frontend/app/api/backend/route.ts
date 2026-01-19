import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const base = process.env.BACKEND_BASE_URL!;
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) return new Response("Missing path", { status: 400 });

  const res = await fetch(`${base}${path}`, { cache: "no-store" });
  const data = await res.text();
  return new Response(data, { status: res.status, headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" } });
}

export async function POST(req: NextRequest) {
  const base = process.env.BACKEND_BASE_URL!;
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) return new Response("Missing path", { status: 400 });

  const body = await req.text();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const data = await res.text();
  return new Response(data, { status: res.status, headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" } });
}
