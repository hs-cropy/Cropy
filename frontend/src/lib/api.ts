import type { DiagnoseResponse, PaginatedHistory, Severity } from "@/types/diagnosis";
import { clearHistoryCache } from "./historyCache";
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const keys = new WeakMap<File, Map<string, string>>();
export interface RequestOptions { signal?: AbortSignal; idempotencyKey?: string }
export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number,
              public retryable: boolean, public requestId?: string) { super(message); }
}
async function response<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(typeof body.detail === "string" ? body.detail : "요청 처리에 실패했습니다.",
      body.code || "HTTP_ERROR", res.status, body.retryable ?? false, body.request_id);
  }
  return res.json();
}
function requestKey(file: File, operation: string) {
  let map = keys.get(file);
  if (!map) { map = new Map(); keys.set(file, map); }
  if (!map.has(operation)) {
    // getRandomValues is also available on Orange Pi's LAN HTTP origin.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    map.set(operation, Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""));
  }
  return map.get(operation)!;
}
export async function diagnoseImage(file: File, cropType?: string, options: RequestOptions = {}): Promise<DiagnoseResponse> {
  const formData = new FormData(); formData.append("file", file);
  const params = cropType ? "?crop_type=" + encodeURIComponent(cropType) : "";
  return changesHistory(response(await fetch(API_BASE + "/api/v1/diagnose" + params, {
    method: "POST", body: formData, signal: options.signal,
    headers: { "Idempotency-Key": options.idempotencyKey || requestKey(file, "diagnose:" + (cropType || "")) },
  })));
}
// 이력에 기록을 더하거나 바꾸는 요청이 성공하면 이력 화면의 캐시를 비운다
async function changesHistory<T>(request: Promise<T>): Promise<T> {
  const result = await request;
  clearHistoryCache();
  return result;
}
export async function refineDiagnosis(id: string, file: File, options: RequestOptions = {}): Promise<DiagnoseResponse> {
  const formData = new FormData(); formData.append("file", file);
  return changesHistory(response(await fetch(API_BASE + "/api/v1/diagnose/" + encodeURIComponent(id) + "/refine", {
    method: "POST", body: formData, signal: options.signal,
    headers: { "Idempotency-Key": options.idempotencyKey || requestKey(file, "refine:" + id) },
  })));
}
export async function saveResult(token: string): Promise<DiagnoseResponse> {
  return changesHistory(response(await fetch(API_BASE + "/api/v1/results/" + encodeURIComponent(token) + "/save", { method: "POST" })));
}
export async function fetchHistory(page = 1, size = 20, cropType?: string, severity?: Severity,
                                   signal?: AbortSignal): Promise<PaginatedHistory> {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  if (cropType) params.set("crop_type", cropType);
  if (severity) params.set("severity", severity);
  return response(await fetch(API_BASE + "/api/v1/history?" + params, { signal }));
}
export async function fetchDiagnosisDetail(id: string, signal?: AbortSignal): Promise<DiagnoseResponse> {
  return response(await fetch(API_BASE + "/api/v1/history/" + encodeURIComponent(id), { signal }));
}
