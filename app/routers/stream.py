import asyncio
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sse_starlette.sse import EventSourceResponse
from sqlalchemy.orm import Session
from jose import JWTError, jwt
from app.database import get_db
from app.models import Agent
from app.services import chat_service
from app.config import get_settings

settings = get_settings()
router = APIRouter(prefix="/api/stream", tags=["stream"])

ALGORITHM = "HS256"


def _get_agent_from_token(token: str = Query(...), db: Session = Depends(get_db)) -> Agent:
    """Reads JWT from ?token= query param — needed because EventSource can't set headers."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        agent_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    agent = db.query(Agent).filter(Agent.id == agent_id, Agent.is_active == True).first()
    if not agent:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Agent not found")
    return agent


@router.get("/chat/{session_id}")
async def stream_chat(session_id: str, db: Session = Depends(get_db)):
    """SSE endpoint for the customer chat widget."""
    session = chat_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    async def event_generator():
        q = chat_service.subscribe_session(session_id)
        try:
            while True:
                try:
                    data = await asyncio.wait_for(q.get(), timeout=25.0)
                    yield {"data": data}
                except asyncio.TimeoutError:
                    # Heartbeat to keep connection alive
                    yield {"data": '{"event":"ping","data":{}}'}
        except asyncio.CancelledError:
            pass
        finally:
            chat_service.unsubscribe_session(session_id, q)

    return EventSourceResponse(event_generator())


@router.get("/agent")
async def stream_agent(current_agent: Agent = Depends(_get_agent_from_token)):
    """SSE endpoint for the agent dashboard."""
    agent_id = current_agent.id

    async def event_generator():
        q = chat_service.subscribe_agent(agent_id)
        try:
            while True:
                try:
                    data = await asyncio.wait_for(q.get(), timeout=25.0)
                    yield {"data": data}
                except asyncio.TimeoutError:
                    yield {"data": '{"event":"ping","data":{}}'}
        except asyncio.CancelledError:
            pass
        finally:
            chat_service.unsubscribe_agent(agent_id, q)

    return EventSourceResponse(event_generator())
