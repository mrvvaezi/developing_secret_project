export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  token = "",
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (token) headers.set("X-Admin-Token", token);
  const response = await fetch(path, {
    ...options,
    headers,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (
      response.status === 401 &&
      path !== "/api/auth/login" &&
      typeof window !== "undefined"
    )
      window.location.replace("/login");
    throw new ApiError(
      typeof data.detail === "string"
        ? data.detail
        : "درخواست انجام نشد؛ دوباره تلاش کنید.",
      response.status,
    );
  }
  return data as T;
}
export const post = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});
export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "ارتباط برقرار نشد؛ دوباره تلاش کنید.";
export const fa = (n: number) => n.toLocaleString("fa-IR");
export const fmt = (n = 0) => {
  const s = Math.max(0, Math.floor(n));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
