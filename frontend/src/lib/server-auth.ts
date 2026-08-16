import "server-only";

import { cookies } from "next/headers";

export interface ServerAuthState {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    platformRole: string;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
}

export async function getCurrentAuth(): Promise<ServerAuthState | null> {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader.includes("thagencia_session=")) return null;

  const backendUrl = (process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
  try {
    const response = await fetch(`${backendUrl}/api/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!response.ok) return null;

    return await response.json() as ServerAuthState;
  } catch {
    return null;
  }
}
