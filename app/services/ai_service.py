import json
import re
import logging
from typing import List, Dict
from groq import Groq, RateLimitError, APIStatusError
import google.generativeai as genai
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_groq_client = Groq(api_key=settings.groq_api_key) if settings.groq_api_key else None

if settings.gemini_api_key:
    genai.configure(api_key=settings.gemini_api_key)
    _gemini_model = genai.GenerativeModel("gemini-2.0-flash")
else:
    _gemini_model = None

SYSTEM_PROMPT = """You are a professional customer support assistant for a bank.

Rules:
- Detect the language the user writes in and always respond in that same language.
- Be professional, concise, warm, and empathetic.
- Help with: account inquiries, transaction questions, branch hours, general banking FAQs, card services, loan information.
- NEVER ask for or accept: passwords, full card numbers, CVV codes, or PINs.
- If a user shares sensitive data accidentally, remind them to keep it private.
- If you cannot resolve the issue or the user asks for a human, set needs_handoff to true.

You must ALWAYS respond with valid JSON in this exact format:
{
  "reply": "your response message here",
  "needs_handoff": false
}

Set needs_handoff to true when:
- The user explicitly asks for a human agent
- The issue requires account access or verification
- You cannot answer the question with certainty
- The user is frustrated or upset after 2+ exchanges
"""


def _build_messages(history: List[Dict]) -> List[Dict]:
    return [{"role": "system", "content": SYSTEM_PROMPT}] + history


def _parse_ai_response(raw: str) -> Dict:
    text = raw.strip()

    # 1. Strip markdown code fences
    if "```" in text:
        for part in text.split("```"):
            p = part.strip()
            if p.startswith("json"):
                p = p[4:].strip()
            if p.startswith("{"):
                try:
                    return json.loads(p)
                except json.JSONDecodeError:
                    pass

    # 2. Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 3. Find the first { ... } block anywhere in the text
    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass

    # 4. Regex: extract "reply" and "needs_handoff" values individually
    reply_match = re.search(r'"reply"\s*:\s*"((?:[^"\\]|\\.)*)"', text, re.DOTALL)
    if reply_match:
        reply = reply_match.group(1).replace('\\"', '"').replace('\\n', '\n')
        needs_handoff = bool(re.search(r'"needs_handoff"\s*:\s*true', text, re.IGNORECASE))
        return {"reply": reply, "needs_handoff": needs_handoff}

    # 5. Last resort: strip JSON key fragments and return plain text
    cleaned = re.sub(r',?\s*"needs_handoff"\s*:\s*(true|false)', '', text, flags=re.IGNORECASE)
    cleaned = re.sub(r'^["\s]*reply["\s]*:\s*["\s]*', '', cleaned).strip().strip('"')
    return {"reply": cleaned or text, "needs_handoff": False}


def _call_groq(history: List[Dict]) -> Dict:
    messages = _build_messages(history)
    response = _groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=messages,
        temperature=0.7,
        max_tokens=512,
    )
    return _parse_ai_response(response.choices[0].message.content)


def _call_gemini(history: List[Dict]) -> Dict:
    # Convert to Gemini format (no system role — inject into first user message)
    parts = [SYSTEM_PROMPT + "\n\n"]
    for msg in history:
        role = "User" if msg["role"] == "user" else "Assistant"
        parts.append(f"{role}: {msg['content']}")
    prompt = "\n".join(parts)
    response = _gemini_model.generate_content(prompt)
    return _parse_ai_response(response.text)


def get_ai_response(history: List[Dict]) -> Dict:
    """
    Try Groq first; fall back to Gemini on rate-limit or error.
    Returns {"reply": str, "needs_handoff": bool}
    """
    if _groq_client:
        try:
            return _call_groq(history)
        except (RateLimitError, APIStatusError) as e:
            logger.warning("Groq failed (%s), falling back to Gemini", e)
        except Exception as e:
            logger.error("Groq unexpected error: %s", e)

    if _gemini_model:
        try:
            return _call_gemini(history)
        except Exception as e:
            logger.error("Gemini failed: %s", e)

    return {
        "reply": "I'm sorry, I'm temporarily unavailable. Please try again shortly.",
        "needs_handoff": True,
    }
