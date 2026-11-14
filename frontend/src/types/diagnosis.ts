export interface PredictionItem {
  name: string;
  confidence: number;
}

export interface PesticideInfo {
  name: string;
  usage_id?: string | null;
  source?: string | null;
  verification_status?: string;
  synced_at?: string | null;
  dilution?: string;
  usage?: string;
  active_ingredient?: string;
  safety_notes?: string;
  safety: {
    phi_days?: number;
    reentry_hours?: number;
  };
}

export type Severity = "low" | "medium" | "high";

export interface RecaptureCandidate {
  name: string;
  cue: string;
}

export interface RecaptureGuidance {
  region: string;
  instruction: string;
  margin: number;
  candidates: RecaptureCandidate[];
}

export interface ManagementActionDetail {
  title: string;
  description: string;
}

export interface DiagnoseResponse {
  id: string;
  disease_name: string;
  crop_type?: string;
  selected_crop?: string | null;
  predicted_crop?: string | null;
  crop_mismatch?: boolean;
  prediction_mode?: "model" | "mock" | "legacy" | "browser";
  model_version?: string | null;
  preprocessing_version?: string | null;
  pair_model_version?: string | null;
  category?: "disease" | "normal" | "other";
  severity?: Severity | null;
  confidence: number;
  top_predictions: PredictionItem[];
  description?: string;
  causes: string[];
  pesticides: PesticideInfo[];
  prevention: string[];
  image_url?: string;
  refined_image_url?: string | null;
  created_at: string;
  updated_at?: string | null;
  recapture?: RecaptureGuidance | null;
  management_actions?: string[];
  summary_message?: string | null;
  management_action_details?: ManagementActionDetail[];
  content_status?: "snapshot" | "current_reference";
  content_version?: string | null;
  current_pesticides?: PesticideInfo[];
  decision_status?: string;
  decision_reasons?: string[];
  policy_version?: string;
  is_refined?: boolean;
  initial_predictions?: PredictionItem[];
  /** skipped: 판별 불가라 기록으로 남기지 않음(#179). id로 이력·재촬영·음성 안내를 불러올 수 없다 */
  save_status?: "saved" | "failed" | "skipped";
  recovery_token?: string | null;
  /** 저장하지 않은 결과(skipped)의 음성 안내 문장 */
  speech_script?: string[] | null;
}

export interface DiagnosisSummary {
  id: string;
  disease_name: string;
  confidence: number;
  crop_type?: string;
  image_url?: string;
  refined_image_url?: string | null;
  prediction_mode?: "model" | "mock" | "legacy" | "browser";
  created_at: string;
  severity?: Severity | null;
  category?: "normal" | "disease" | "other";
  is_refined?: boolean;
  content_status?: string;
}

export interface PaginatedHistory {
  items: DiagnosisSummary[];
  total: number;
  page: number;
  size: number;
  unfiltered_total: number;
  crop_total: number;
}
