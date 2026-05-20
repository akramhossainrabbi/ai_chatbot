from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ── Chat ──────────────────────────────────────────────────────────────────────

class StartChatRequest(BaseModel):
    visitor_id: str

class StartChatResponse(BaseModel):
    session_id: str
    status: str

class SendMessageRequest(BaseModel):
    session_id: str
    content: str

class SendMessageResponse(BaseModel):
    reply: str
    sender_type: str        # "ai" or "agent"
    needs_handoff: bool = False
    session_status: str

class MessageOut(BaseModel):
    id: int
    sender_type: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True

class ChatHistoryResponse(BaseModel):
    session_id: str
    status: str
    messages: List[MessageOut]
    assigned_agent_name: Optional[str] = None


# ── Agent Auth ─────────────────────────────────────────────────────────────────

class AgentLoginRequest(BaseModel):
    username: str
    password: str

class AgentLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    agent_id: int
    full_name: str


# ── Agent Dashboard ────────────────────────────────────────────────────────────

class SessionSummary(BaseModel):
    session_id: str
    visitor_id: str
    status: str
    language: str
    created_at: datetime
    assigned_agent_name: Optional[str] = None
    last_message: Optional[str] = None

    class Config:
        from_attributes = True

class AgentMessageRequest(BaseModel):
    session_id: str
    content: str


# ── SSE Events ─────────────────────────────────────────────────────────────────

class SSEEvent(BaseModel):
    event: str          # "message", "handoff", "agent_joined", "closed"
    data: dict
