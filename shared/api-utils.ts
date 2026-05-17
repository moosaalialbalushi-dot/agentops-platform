// ─── shared/api-utils.ts ─────────────────────────────────────────────────────
// Standardized API response types and helpers for consistent error reporting.
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: Record<string, any>;
}

export function sendSuccess<T>(res: any, data: T, meta?: Record<string, any>, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    meta,
  });
}

export function sendError(res: any, message: string, status = 500) {
  return res.status(status).json({
    success: false,
    error: message,
  });
}

export function handleApiError(res: any, error: any) {
  console.error("[API Error]:", error);
  const message = error instanceof Error ? error.message : "An unexpected error occurred";
  return sendError(res, message);
}
