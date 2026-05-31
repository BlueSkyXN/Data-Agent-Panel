from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)


class AgentCreate(BaseModel):
    name: str
    code: str
    type: str
    description: str = ""
    backend_type: str = "custom_http"
    adapter_id: str = "ad_generic_http"
    risk_level: Literal["low", "medium", "high"] = "medium"
    require_human_approval: bool = False
    config_json: dict[str, Any] = Field(default_factory=dict)


class ChatQuery(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    agent_id: str = "agent_router"
    session_id: str | None = None
    context: dict[str, Any] = Field(default_factory=dict)


class SessionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    status: Literal["active", "archived"] | None = None


class ReportCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    report_type: str = Field(default="chat_answer", max_length=80)
    agent_id: str | None = None
    content_markdown: str = Field(min_length=1, max_length=50000)
    evidence: list[dict[str, Any]] = Field(default_factory=list)


class FeedbackCreate(BaseModel):
    session_id: str | None = None
    message_id: str | None = None
    trace_id: str | None = None
    rating: Literal["correct", "partial", "wrong", "unsafe", "needs_review"]
    feedback_type: str | None = None
    comment: str | None = Field(default=None, max_length=2000)


class AnalysisTaskCreate(BaseModel):
    question: str = Field(min_length=1, max_length=12000)
    agent_id: str = "agent_business_analysis"
    require_plan_approval: bool = False


class DataSourceCreate(BaseModel):
    name: str
    type: str
    connection_config: dict[str, Any] = Field(default_factory=dict)


class DatasetCreate(BaseModel):
    name: str
    business_domain: str
    source_id: str
    physical_table: str
    description: str = ""


class MetricCreate(BaseModel):
    dataset_id: str
    name: str
    code: str
    formula: str
    description: str = ""
    time_grain: str | None = None


class KnowledgeBaseCreate(BaseModel):
    name: str
    type: str = "document"
    backend_type: str = "mock"
    adapter_id: str | None = None
    description: str = ""


class EvalSetCreate(BaseModel):
    name: str
    business_domain: str
    description: str = ""


class EvalCaseCreate(BaseModel):
    question: str
    expected_answer: str = ""
    expected_sql: str = ""
    expected_chart_json: dict[str, Any] = Field(default_factory=dict)
    expected_report_outline: str = ""
    tags: list[str] = Field(default_factory=list)


class EvalRunCreate(BaseModel):
    eval_set_id: str
    agent_id: str

class DataQueryRequest(BaseModel):
    dataset_id: str
    sql: str = Field(min_length=1, max_length=12000)
    max_rows: int | None = Field(default=None, ge=1, le=5000)


class QualityRunRequest(BaseModel):
    dataset_id: str | None = None
    rule_ids: list[str] = Field(default_factory=list)


class SemanticTermCreate(BaseModel):
    term: str
    term_type: str = "business_term"
    business_domain: str = "Business"
    definition: str
    canonical_object_type: str | None = None
    canonical_object_id: str | None = None
    synonyms: list[str] = Field(default_factory=list)


class PanelCreate(BaseModel):
    name: str
    business_domain: str = "Business"
    description: str = ""


class PanelWidgetCreate(BaseModel):
    panel_id: str
    widget_type: str = "bar"
    title: str
    dataset_id: str | None = None
    metric_id: str | None = None
    query_sql: str | None = None
    chart_spec: dict[str, Any] = Field(default_factory=dict)
    position_json: dict[str, Any] = Field(default_factory=dict)


class CodexTaskCreate(BaseModel):
    title: str
    task_prompt: str = Field(min_length=1, max_length=20000)
    workspace_id: str = "codex_ws_data_agent_platform"
    source_agent_id: str | None = None
    trace_id: str | None = None
    acceptance_criteria: list[str] = Field(default_factory=list)
    risk_level: Literal["low", "medium", "high"] = "medium"
    requires_approval: bool = True
    mode: Literal["mock", "http", "cli", "sdk"] = "mock"


class CodexTaskDecision(BaseModel):
    comment: str = ""


class CodexDispatchRequest(BaseModel):
    mode: Literal["mock", "http", "cli", "sdk"] | None = None
