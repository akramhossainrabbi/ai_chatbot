from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import (
    StartChatRequest, StartChatResponse,
    SendMessageRequest, SendMessageResponse,
    ChatHistoryResponse, MessageOut,
)
from app.services import chat_service

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("/start", response_model=StartChatResponse)
async def start_chat(req: StartChatRequest, db: Session = Depends(get_db)):
    session = await chat_service.create_session(db, req.visitor_id)
    return StartChatResponse(session_id=session.id, status=session.status)


@router.post("/message", response_model=SendMessageResponse)
async def send_message(req: SendMessageRequest, db: Session = Depends(get_db)):
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    result = await chat_service.handle_user_message(db, req.session_id, req.content.strip())
    return SendMessageResponse(
        reply=result["reply"],
        sender_type="agent" if result["session_status"] == "with_agent" else "ai",
        needs_handoff=result["needs_handoff"],
        session_status=result["session_status"],
    )


@router.get("/history/{session_id}", response_model=ChatHistoryResponse)
def get_history(session_id: str, db: Session = Depends(get_db)):
    session = chat_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    agent_name = session.assigned_agent.full_name if session.assigned_agent else None
    return ChatHistoryResponse(
        session_id=session.id,
        status=session.status,
        messages=[MessageOut.model_validate(m) for m in session.messages],
        assigned_agent_name=agent_name,
    )


@router.post("/close/{session_id}")
async def close_chat(session_id: str, db: Session = Depends(get_db)):
    chat_service.close_session(db, session_id)
    return {"detail": "Session closed"}
