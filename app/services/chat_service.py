import asyncio
import json
import logging
from typing import Dict, List, Set
from datetime import datetime
from sqlalchemy.orm import Session, joinedload
from app.models import ChatSession, Message, Agent
from app.services.ai_service import get_ai_response

logger = logging.getLogger(__name__)

# In-memory SSE subscriber queues keyed by session_id and agent_id
# { session_id: set of asyncio.Queue }
_session_queues: Dict[str, Set[asyncio.Queue]] = {}
# { agent_id: set of asyncio.Queue }
_agent_queues: Dict[int, Set[asyncio.Queue]] = {}


# ── Queue helpers ──────────────────────────────────────────────────────────────

def subscribe_session(session_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _session_queues.setdefault(session_id, set()).add(q)
    return q

def unsubscribe_session(session_id: str, q: asyncio.Queue):
    if session_id in _session_queues:
        _session_queues[session_id].discard(q)

def subscribe_agent(agent_id: int) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _agent_queues.setdefault(agent_id, set()).add(q)
    return q

def unsubscribe_agent(agent_id: int, q: asyncio.Queue):
    if agent_id in _agent_queues:
        _agent_queues[agent_id].discard(q)

async def _broadcast_to_session(session_id: str, event: str, data: dict):
    payload = json.dumps({"event": event, "data": data})
    for q in list(_session_queues.get(session_id, [])):
        await q.put(payload)

async def _broadcast_to_all_agents(event: str, data: dict):
    payload = json.dumps({"event": event, "data": data})
    for queues in _agent_queues.values():
        for q in list(queues):
            await q.put(payload)

async def _broadcast_to_agent(agent_id: int, event: str, data: dict):
    payload = json.dumps({"event": event, "data": data})
    for q in list(_agent_queues.get(agent_id, [])):
        await q.put(payload)


# ── Session management ─────────────────────────────────────────────────────────

async def create_session(db: Session, visitor_id: str) -> ChatSession:
    session = ChatSession(visitor_id=visitor_id)
    db.add(session)
    db.commit()
    db.refresh(session)
    await _broadcast_to_all_agents("new_session", {
        "session_id": session.id,
        "visitor_id": session.visitor_id,
        "status": session.status,
        "last_message": None,
    })
    return session

def get_session(db: Session, session_id: str) -> ChatSession | None:
    return db.query(ChatSession).filter(ChatSession.id == session_id).first()

def get_active_sessions(db: Session) -> List[ChatSession]:
    return (
        db.query(ChatSession)
        .options(
            joinedload(ChatSession.messages),
            joinedload(ChatSession.assigned_agent),
        )
        .filter(ChatSession.status.in_(["active", "waiting", "with_agent"]))
        .order_by(ChatSession.updated_at.desc())
        .all()
    )

def close_session(db: Session, session_id: str):
    session = get_session(db, session_id)
    if session:
        session.status = "closed"
        session.updated_at = datetime.utcnow()
        db.commit()

def _save_message(db: Session, session_id: str, sender_type: str, content: str) -> Message:
    msg = Message(session_id=session_id, sender_type=sender_type, content=content)
    db.add(msg)
    # also update session timestamp
    session = get_session(db, session_id)
    if session:
        session.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(msg)
    return msg

def _build_history(db: Session, session_id: str) -> List[Dict]:
    messages = (
        db.query(Message)
        .filter(Message.session_id == session_id)
        .order_by(Message.created_at)
        .all()
    )
    history = []
    for m in messages:
        role = "user" if m.sender_type == "user" else "assistant"
        history.append({"role": role, "content": m.content})
    return history


# ── Message handling ───────────────────────────────────────────────────────────

async def handle_user_message(db: Session, session_id: str, content: str) -> dict:
    session = get_session(db, session_id)
    if not session or session.status == "closed":
        return {"reply": "This chat session has ended.", "needs_handoff": False, "session_status": "closed"}

    # Save user message
    _save_message(db, session_id, "user", content)

    # If a human agent is handling, don't call AI — just notify agent
    if session.status == "with_agent":
        agent_id = session.assigned_agent_id
        await _broadcast_to_agent(agent_id, "message", {
            "session_id": session_id,
            "sender_type": "user",
            "content": content,
        })
        return {"reply": "", "needs_handoff": False, "session_status": "with_agent"}

    # AI response
    history = _build_history(db, session_id)
    ai_result = get_ai_response(history)
    reply = ai_result.get("reply", "")
    needs_handoff = ai_result.get("needs_handoff", False)

    # Save AI message
    _save_message(db, session_id, "ai", reply)

    # Push to customer SSE
    await _broadcast_to_session(session_id, "message", {
        "sender_type": "ai",
        "content": reply,
    })

    if needs_handoff:
        session.status = "waiting"
        session.updated_at = datetime.utcnow()
        db.commit()
        await _broadcast_to_session(session_id, "handoff", {
            "message": "Connecting you to a human agent, please wait..."
        })
        await _broadcast_to_all_agents("new_waiting_session", {
            "session_id": session_id,
            "visitor_id": session.visitor_id,
            "last_message": content,
        })

    db.refresh(session)
    return {"reply": reply, "needs_handoff": needs_handoff, "session_status": session.status}


async def agent_takeover(db: Session, session_id: str, agent_id: int) -> bool:
    session = get_session(db, session_id)
    if not session or session.status == "closed":
        return False
    session.status = "with_agent"
    session.assigned_agent_id = agent_id
    session.updated_at = datetime.utcnow()
    db.commit()

    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    agent_name = agent.full_name if agent else "Agent"

    await _broadcast_to_session(session_id, "agent_joined", {
        "agent_name": agent_name,
        "message": f"You are now connected with {agent_name}.",
    })
    return True


async def agent_send_message(db: Session, session_id: str, agent_id: int, content: str):
    _save_message(db, session_id, "agent", content)
    await _broadcast_to_session(session_id, "message", {
        "sender_type": "agent",
        "content": content,
    })


async def agent_close_session(db: Session, session_id: str):
    close_session(db, session_id)
    await _broadcast_to_session(session_id, "closed", {
        "message": "This chat session has been closed."
    })
