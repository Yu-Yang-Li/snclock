export type SourceStatus = 'new' | 'viewed' | 'flagged'
export type ZTFRequestStatus =
  | 'unconfirmed'
  | 'submitted'
  | 'processing'
  | 'completed'
  | 'timeout'
  | 'failed'

export interface ArchiveObservation {
  obs_id?: string | null
  collection?: string | null
  instrument?: string | null
  filters?: string | null
  data_type?: string | null
  start_mjd?: number | null
  end_mjd?: number | null
  access_url?: string | null
  cutout_url?: string | null
  provider?: string | null
}

export interface ArchiveMissionCoverage {
  mission: 'HST' | 'JWST' | 'Euclid'
  state: 'available' | 'none' | 'error'
  observation_count: number
  imaging_count: number
  instruments: string[]
  filters: string[]
  latest_observation_mjd?: number | null
  archive_url: string
  observations: ArchiveObservation[]
  error?: string | null
}

export interface ArchiveCoverage {
  tns_name: string
  ra: number
  dec: number
  discovery_mjd?: number | null
  status: 'coverage' | 'none' | 'partial' | 'unavailable' | 'disabled'
  has_pre_discovery_data: boolean
  has_pre_discovery_imaging: boolean
  missions: ArchiveMissionCoverage[]
  checked_at?: string | null
  cache_hit: boolean
  science_note?: string
}

export interface SNClockInputEvidence {
  kind: 'observations'
  count: number
  detections: number
  limits: number
}

export interface SNClockPrediction {
  texp: number
  ci_lower: number
  ci_upper: number
  report_phase?: number
  convergence_gif_url?: string
  convergence_png_url?: string
  /** 模型输入特征完备率 0~1（CatBoost feature_cols 非缺失比例） */
  feature_completeness?: number
  model_features_present?: number
  model_features_total?: number
  n_features_used?: number
  input_evidence?: SNClockInputEvidence
}

export interface SNClockModelResult {
  model_id: string
  slot: number
  display_name: string
  model_type: string
  available: boolean
  reason?: string | null
  prediction?: {
    texp: number
    ci_lower: number
    ci_upper: number
    ci_width?: number
    n_features?: number
    feature_completeness?: number
    model_features_present?: number
    model_features_total?: number
    input_evidence?: SNClockInputEvidence
  }
  texp_delta_from_median?: number
  disagreement_flag?: string
  prediction_error?: string
  viz_error?: string
  convergence_png?: string | null
  convergence_gif?: string | null
  snclock_lightcurve?: string | null
  viz_html?: string
}

export interface SNClockModelDisagreement {
  status: 'insufficient' | 'low' | 'moderate' | 'high'
  max_delta_days: number
  threshold_days: number
  median_texp?: number
}

/** /api/plots/observability-metrics/{tns} — 兴隆为主站 primary */
export interface ObservabilityPrimary {
  site?: string
  /** 纯文字：条件 + 未来3夜可观测时长（无打分） */
  summary_zh?: string
  score_0_100?: number
  tier?: string
  verdict_zh?: string
  hours_3nights_strict?: number
  hours_3nights_relaxed?: number
  max_continuous_hours_strict?: number
  weather_3day?: ObservabilityWeather
  strict_rules?: { min_alt_deg?: number; max_airmass?: number; sun_altitude_lt_deg?: number }
}

export interface ObservabilityWeather {
  provider?: string
  timezone?: string
  summary_zh?: string
  usable_nights_count?: number
  error?: string
  nights?: {
    night?: string
    avg_cloud_cover_pct?: number | null
    max_precip_probability_pct?: number | null
  }[]
}

export interface ObservabilityHorizonWindow {
  label?: string
  months_ahead?: number
  date?: string
  hours_30deg_dark?: number
  avg_hours_per_night?: number
  graph_30deg_hours?: number
  max_altitude_deg?: number
  is_ok?: boolean
  verdict_zh?: string
  error?: string
}

export interface ObservabilitySite {
  site_name: string
  site?: string
  is_primary?: boolean
  hours_3nights_relaxed?: number
  hours_3nights_strict?: number
  max_continuous_hours_30deg?: number
  max_continuous_hours_strict?: number
  total_observable_hours_3day?: number
  total_dark_hours_3day?: number
  max_altitude_3day?: number
  verdict_zh?: string
  good_months_count?: number
  best_months?: string[]
  best_month_details?: {
    month?: string
    avg_hours_per_night?: number
    max_altitude?: number
  }[]
  horizon_windows?: ObservabilityHorizonWindow[]
  weather_3day?: ObservabilityWeather
  error?: string
}

export interface ObservabilityMetrics {
  score_0_100?: number | null
  score_0_100_relaxed?: number | null
  tier?: string
  rule_zh?: string
  summary_zh?: string
  suitability_guide_zh?: string
  primary?: ObservabilityPrimary | null
  best_site?: string | null
  sites?: ObservabilitySite[]
  error?: string
}

export interface CandidateSummary {
  tns_name: string
  ra: number
  dec: number
  discovery_date?: string
  tns_received_at?: string
  discovery_mag?: number
  discovery_filter?: string
  object_type?: string
  redshift?: number
  reporter?: string
  hostname?: string
  host_redshift?: number
  host_offset_arcsec?: number
  host_assoc_quality?: string
  host_dlr?: number
  host_dlr_grade?: string
  host_pcc_bloom?: number
  host_competition?: number
  host_confidence_grade?: string
  host_n_candidates_total?: number
  host_n_candidates_galaxy?: number
  z_quality?: string
  z_quality_tier?: number
  host_z_is_spec?: number
  host_catalogs?: string
  host_match_dlr_source?: string
  host_galactic_b?: number
  source_galactic_b?: number
  host_type?: string
  z_source?: string
  z_flag?: string
  data_source?: string
  broker?: string
  broker_survey?: string
  internal_name?: string
  source_group?: string
  status: SourceStatus
  sn_clock?: SNClockPrediction
  n_atlas: number
  n_ztf: number
  n_tns: number
  last_update?: string
}

/** SiTian Claw follow-up trigger preview (GOTTA-compatible payload). */
export interface FollowupPreview {
  product?: string
  label?: string
  configured: boolean
  enabled: boolean
  mock_mode: boolean
  warnings: string[]
  payload: Record<string, unknown>
  [key: string]: unknown
}

/** Result of executing the follow-up trigger. */
export interface FollowupExecuteResult {
  mode?: string
  success?: boolean
  status_code?: number
  message?: string
  product?: string
  label?: string
  tns_name?: string
  feishu_sent?: boolean
  payload?: Record<string, unknown>
  [key: string]: unknown
}

/** Combined SiTian Claw UI bundle for one source. */
export interface SiTianClawUiBundle {
  tns_name?: string
  candidate_detail?: Record<string, unknown>
  candidate_card_html?: string
  lightcurve?: { image_base64?: string; path?: string; error?: string }
  text_summary?: string
  combined_html?: string
  [key: string]: unknown
}

export interface Photometry {
  mjd: number
  mag?: number
  mag_err?: number
  band: string
  source: string
  is_detection: boolean
  limiting_mag?: number
}

export interface CandidateDetail extends CandidateSummary {
  photometry: Photometry[]
  prediction_history: Record<string, unknown>[]
  crossmatch: Record<string, unknown>
  report_times: Record<string, unknown>[]
  host?: {
    name?: string
    redshift?: number
    offset_arcsec?: number
    gaia_is_stellar?: boolean
  }
}

export interface GottaAlertPreview {
  configured: boolean
  enabled: boolean
  url: string
  path: string
  broker_id: string
  payload: Record<string, unknown>
  warnings: string[]
}

export interface GottaAlertSendResult {
  success: boolean
  status_code: number
  url: string
  timestamp: string
  payload: Record<string, unknown>
  response: unknown
}

export interface ZTFRequest {
  request_id: string
  source_name: string
  status: ZTFRequestStatus
  submit_time?: string
  complete_time?: string
  ra?: number
  dec?: number
  has_data: boolean
}

export interface ZTFMonitorSummary {
  total_pending: number
  total_completed: number
  total_failed: number
  last_email_scan?: string
  requests: ZTFRequest[]
}

export interface SystemStatus {
  last_tns_cycle?: string
  next_tns_cycle?: string
  tns_cycle_running: boolean
  ztf_scheduler_active: boolean
  n_candidates: number
  uptime_seconds: number
  ui_revision: number
  cycle_summary?: CycleSummary
  broker_status?: BrokerStatus
}

export interface BrokerStatus {
  lsst?: {
    enabled?: boolean
    last_total_rows?: number
    summary_zh?: string
    error?: string
    brokers?: {
      name: string
      enabled: boolean
      priority?: number
      base_url?: string
      last_rows?: number
      last_ok?: boolean
      last_error?: string
      last_queried_at?: string
      latest_firstmjd?: number
      upstream_age_days?: number
      state?: 'disabled' | 'not_queried' | 'empty' | 'rows' | 'upstream_stale' | 'error'
    }[]
  }
}

export interface CycleFilterStage {
  label: string
  total: number
  by_source: Record<string, number>
}

export interface RedshiftDiagnostics {
  input_total: number
  passed: number
  missing_redshift: number
  below_min: number
  above_max: number
  requires_redshift: boolean
  min_redshift: number
  max_redshift: number
}

export interface LsstFilterStage {
  label: string
  before_total: number
  after_total: number
  lsst_before: number
  lsst_after: number
  dropped: number
  criteria: string
}

export interface LsstRejection {
  stage: string
  failed_checks: string[]
  tns_name?: string
  internal_name?: string
  data_source?: string
  broker?: string
  ra?: number
  dec?: number
  discovery_date?: string
  discovery_mjd?: number
  host_name?: string
  host_type?: string
  host_redshift?: number
  host_offset_arcsec?: number
  host_dlr?: number
  host_dlr_grade?: string
  host_pcc_bloom?: number
  host_competition?: number
  host_confidence_grade?: string
  host_n_candidates_total?: number
  host_n_candidates_galaxy?: number
  z_quality?: string
  z_quality_tier?: number
  z_source?: string
  host_catalogs?: string
  host_match_dlr_source?: string
}
export interface CycleSummary {
  last_run_at?: string
  cache_hit?: boolean
  fetch?: {
    tns: number
    ztf: number
    lsst: number
    total: number
    merged_total: number
    merged_by_source: Record<string, number>
  }
  filters?: CycleFilterStage[]
  redshift_diagnostics?: RedshiftDiagnostics
  lsst_filters?: LsstFilterStage[]
  lsst_rejections?: LsstRejection[]
  lsst_rejections_count?: number
  final?: number
}
