from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from jose import JWTError, jwt
import bcrypt

from app.database import get_db
from app.models import Agent
from app.schemas import (
    AgentLoginRequest, AgentLoginResponse,
    SessionSummary, AgentMessageRequest,
)
from app.services import chat_service
from app.config import get_settings

settings = get_settings()
router = APIRouter(prefix="/api/agent", tags=["agent"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/agent/login")

ALGORITHM = "HS256"


def _create_token(agent_id: int) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub": str(agent_id), "exp": expire}, settings.secret_key, algorithm=ALGORITHM)


def get_current_agent(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> Agent:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        agent_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    agent = db.query(Agent).filter(Agent.id == agent_id, Agent.is_active == True).first()
    if not agent:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Agent not found")
    return agent


@router.post("/login", response_model=AgentLoginResponse)
def login(req: AgentLoginRequest, db: Session = Depends(get_db)):
    agent = db.query(Agent).filter(Agent.username == req.username, Agent.is_active == True).first()
    if not agent or not bcrypt.checkpw(req.password.encode(), agent.password_hash.encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = _create_token(agent.id)
    return AgentLoginResponse(access_token=token, agent_id=agent.id, full_name=agent.full_name)


@router.get("/sessions", response_model=list[SessionSummary])
def list_sessions(db: Session = Depends(get_db), current_agent=Depends(get_current_agent)):
    sessions = chat_service.get_active_sessions(db)
    result = []
    for s in sessions:
        last_msg = s.messages[-1].content if s.messages else None
        result.append(SessionSummary(
            session_id=s.id,
            visitor_id=s.visitor_id,
            status=s.status,
            language=s.language,
            created_at=s.created_at,
            assigned_agent_name=s.assigned_agent.full_name if s.assigned_agent else None,
            last_message=last_msg,
        ))
    return result


@router.get("/sessions/{session_id}")
def get_session_detail(session_id: str, db: Session = Depends(get_db), current_agent=Depends(get_current_agent)):
    from app.schemas import ChatHistoryResponse, MessageOut
    session = chat_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return ChatHistoryResponse(
        session_id=session.id,
        status=session.status,
        messages=[MessageOut.model_validate(m) for m in session.messages],
        assigned_agent_name=session.assigned_agent.full_name if session.assigned_agent else None,
    )


@router.post("/takeover/{session_id}")
async def takeover(session_id: str, db: Session = Depends(get_db), current_agent=Depends(get_current_agent)):
    ok = await chat_service.agent_takeover(db, session_id, current_agent.id)
    if not ok:
        raise HTTPException(status_code=400, detail="Cannot take over this session")
    return {"detail": "Takeover successful"}


@router.post("/message")
async def send_message(req: AgentMessageRequest, db: Session = Depends(get_db), current_agent=Depends(get_current_agent)):
    session = chat_service.get_session(db, req.session_id)
    if not session or session.status == "closed":
        raise HTTPException(status_code=400, detail="Session not available")
    await chat_service.agent_send_message(db, req.session_id, current_agent.id, req.content)
    return {"detail": "Message sent"}


@router.post("/close/{session_id}")
async def close_session(session_id: str, db: Session = Depends(get_db), current_agent=Depends(get_current_agent)):
    await chat_service.agent_close_session(db, session_id)
    return {"detail": "Session closed"}
