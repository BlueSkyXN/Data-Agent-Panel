PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT DEFAULT '',
  password_hash TEXT DEFAULT '',
  name TEXT NOT NULL,
  email TEXT,
  department TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS space_members (
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (space_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_spaces_owner_updated ON project_spaces(owner_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_space_members_user ON space_members(user_id, space_id);

CREATE TABLE IF NOT EXISTS workspace_resources (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(space_id, resource_type, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_resources_space_created ON workspace_resources(space_id, created_at);

CREATE TABLE IF NOT EXISTS workspace_canvases (
  space_id TEXT PRIMARY KEY,
  content_markdown TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_canvas_revisions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content_markdown TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(space_id, version)
);
CREATE INDEX IF NOT EXISTS idx_workspace_canvas_revisions_space_version ON workspace_canvas_revisions(space_id, version DESC);

CREATE TABLE IF NOT EXISTS workspace_notes (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workspace_notes_space_updated ON workspace_notes(space_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workspace_tasks (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  title TEXT NOT NULL,
  detail_markdown TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  source_type TEXT,
  source_id TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_space_status_updated ON workspace_tasks(space_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  owner_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  default_version_id TEXT,
  risk_level TEXT NOT NULL DEFAULT 'medium',
  require_human_approval INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_versions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  version TEXT NOT NULL,
  backend_type TEXT NOT NULL,
  adapter_id TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  input_schema TEXT NOT NULL DEFAULT '{}',
  output_schema TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_permissions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  permission TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_adapters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  endpoint TEXT,
  auth_type TEXT NOT NULL DEFAULT 'none',
  config_json TEXT NOT NULL DEFAULT '{}',
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  trace_id TEXT,
  adapter_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  connection_config TEXT NOT NULL DEFAULT '{}',
  owner_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  business_domain TEXT NOT NULL,
  source_id TEXT NOT NULL,
  physical_table TEXT NOT NULL,
  description TEXT,
  refresh_mode TEXT DEFAULT 'manual',
  data_classification TEXT NOT NULL DEFAULT 'internal',
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS dataset_fields (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  field_type TEXT NOT NULL,
  semantic_type TEXT,
  description TEXT,
  default_aggregation TEXT,
  is_sensitive INTEGER NOT NULL DEFAULT 0,
  is_filterable INTEGER NOT NULL DEFAULT 1,
  is_groupable INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  formula TEXT NOT NULL,
  description TEXT,
  time_grain TEXT,
  owner_id TEXT,
  status TEXT NOT NULL DEFAULT 'published'
);

CREATE TABLE IF NOT EXISTS synonyms (
  id TEXT PRIMARY KEY,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  synonym TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_permissions (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  row_filter TEXT,
  masked_fields TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  backend_type TEXT NOT NULL,
  adapter_id TEXT,
  description TEXT,
  owner_id TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS knowledge_bindings (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  knowledge_base_id TEXT NOT NULL,
  binding_type TEXT NOT NULL DEFAULT 'default',
  priority INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS knowledge_versions (
  id TEXT PRIMARY KEY,
  knowledge_base_id TEXT NOT NULL,
  version TEXT NOT NULL,
  checksum TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_id TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,
  user_id TEXT NOT NULL,
  agent_id TEXT,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  result_ref TEXT,
  result_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  trace_id TEXT,
  requester_id TEXT NOT NULL,
  approver_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  decision_comment TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  task_id TEXT,
  agent_id TEXT,
  agent_version TEXT,
  user_id TEXT NOT NULL,
  input TEXT NOT NULL,
  output TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  duration_ms INTEGER,
  cost_json TEXT NOT NULL DEFAULT '{}',
  request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trace_steps (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  step_no INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  name TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'success',
  duration_ms INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sql_runs (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  dataset_id TEXT,
  sql_text TEXT NOT NULL,
  status TEXT NOT NULL,
  row_count INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS chart_specs (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  chart_type TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  data_ref TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  report_type TEXT NOT NULL,
  owner_id TEXT,
  agent_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  current_version_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS report_versions (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  version TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eval_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  business_domain TEXT NOT NULL,
  description TEXT,
  owner_id TEXT
);

CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY,
  eval_set_id TEXT NOT NULL,
  question TEXT NOT NULL,
  expected_answer TEXT,
  expected_sql TEXT,
  expected_chart_json TEXT,
  expected_report_outline TEXT,
  tags TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  eval_set_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_version TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS eval_results (
  id TEXT PRIMARY KEY,
  eval_run_id TEXT NOT NULL,
  eval_case_id TEXT NOT NULL,
  score REAL DEFAULT 0,
  result_json TEXT NOT NULL DEFAULT '{}',
  error_type TEXT,
  reviewer_id TEXT
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  message_id TEXT,
  trace_id TEXT,
  user_id TEXT NOT NULL,
  rating TEXT NOT NULL,
  feedback_type TEXT,
  comment TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  ip TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limit_events (
  id TEXT PRIMARY KEY,
  bucket_key TEXT NOT NULL,
  created_at_epoch REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_operation_runs (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  detail_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_traces_user_created ON traces(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_traces_created ON traces(created_at);
CREATE INDEX IF NOT EXISTS idx_trace_steps_trace ON trace_steps(trace_id, step_no);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_sql_runs_trace ON sql_runs(trace_id);
CREATE INDEX IF NOT EXISTS idx_chart_specs_trace ON chart_specs(trace_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_trace ON tool_calls(trace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON tasks(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_bucket ON rate_limit_events(bucket_key, created_at_epoch);
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_created ON rate_limit_events(created_at_epoch);
CREATE INDEX IF NOT EXISTS idx_platform_operation_runs_started ON platform_operation_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_platform_operation_runs_operation_started ON platform_operation_runs(operation, started_at);

-- V0.3 full-agent + data capability + Codex nesting extensions
CREATE TABLE IF NOT EXISTS semantic_terms (
  id TEXT PRIMARY KEY,
  term TEXT NOT NULL,
  term_type TEXT NOT NULL,
  business_domain TEXT NOT NULL,
  definition TEXT NOT NULL,
  canonical_object_type TEXT,
  canonical_object_id TEXT,
  synonyms TEXT NOT NULL DEFAULT '[]',
  owner_id TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS query_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  business_domain TEXT NOT NULL,
  intent TEXT NOT NULL,
  template_text TEXT NOT NULL,
  dataset_id TEXT,
  sql_template TEXT,
  chart_type TEXT,
  example_questions TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_quality_rules (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  field_name TEXT,
  expression TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  owner_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_quality_results (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  status TEXT NOT NULL,
  checked_rows INTEGER DEFAULT 0,
  failed_rows INTEGER DEFAULT 0,
  sample_rows TEXT NOT NULL DEFAULT '[]',
  trace_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_lineage (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  upstream_type TEXT NOT NULL,
  upstream_id TEXT NOT NULL,
  transform_desc TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_import_jobs (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  dataset_id TEXT,
  filename TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  row_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS dashboard_panels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  business_domain TEXT NOT NULL,
  description TEXT,
  owner_id TEXT,
  layout_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS panel_widgets (
  id TEXT PRIMARY KEY,
  panel_id TEXT NOT NULL,
  widget_type TEXT NOT NULL,
  title TEXT NOT NULL,
  dataset_id TEXT,
  metric_id TEXT,
  query_sql TEXT,
  chart_spec TEXT NOT NULL DEFAULT '{}',
  position_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_tools (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_type TEXT NOT NULL,
  adapter_id TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS codex_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  allowed_paths TEXT NOT NULL DEFAULT '[]',
  test_command TEXT,
  owner_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS codex_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  workspace_id TEXT,
  source_agent_id TEXT,
  trace_id TEXT,
  requester_id TEXT NOT NULL,
  task_prompt TEXT NOT NULL,
  acceptance_criteria TEXT NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL DEFAULT 'mock',
  status TEXT NOT NULL DEFAULT 'draft',
  risk_level TEXT NOT NULL DEFAULT 'medium',
  requires_approval INTEGER NOT NULL DEFAULT 1,
  approved_by TEXT,
  result_summary TEXT,
  result_json TEXT NOT NULL DEFAULT '{}',
  dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  last_dispatch_at TEXT,
  execution_log_path TEXT,
  sdk_thread_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS codex_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  path TEXT,
  content TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_codex_tasks_created ON codex_tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_quality_results_created ON data_quality_results(created_at);
CREATE INDEX IF NOT EXISTS idx_semantic_terms_domain ON semantic_terms(business_domain, term);


CREATE TABLE IF NOT EXISTS codex_runtime_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  event_type TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_codex_events_task ON codex_runtime_events(task_id, created_at);
