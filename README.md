# Bank Live Chat — AI Customer Support System

A production-ready live chat system for banks, powered by free AI APIs (Groq + Google Gemini), built with FastAPI, and deployable on shared cPanel hosting.

---

## Features

- **AI-powered chat** — Groq (Llama 3.3 70B) as primary, Google Gemini 2.0 Flash as automatic fallback
- **Auto language detection** — AI detects and responds in the user's language
- **Human handoff** — AI escalates to a live agent when it cannot help
- **Agent dashboard** — real-time session list, full chat history, take over from AI
- **Embeddable widget** — floating chat button added to any website with one `<script>` tag
- **JWT authentication** — secure agent login with auto-logout on token expiry
- **Real-time updates** — Server-Sent Events (SSE) for both widget and dashboard
- **MariaDB storage** — persistent sessions, messages, and agent accounts
- **cPanel ready** — runs on shared hosting via Python App (Passenger/WSGI)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.10+ / FastAPI |
| AI (Primary) | Groq API — `llama-3.3-70b-versatile` (free) |
| AI (Fallback) | Google Gemini API — `gemini-2.0-flash` (free) |
| Database | MariaDB via SQLAlchemy + PyMySQL |
| Real-time | Server-Sent Events (SSE) |
| Auth | JWT (python-jose + bcrypt) |
| Frontend | Vanilla JS + CSS (no framework) |
| Hosting | cPanel shared hosting (Passenger WSGI) |

---

## Free API Capacity

| API | Requests/min | Requests/day |
|---|---|---|
| Groq (primary) | 30 RPM | 6,000 RPD |
| Gemini (fallback) | 15 RPM | 1,500 RPD |
| **Combined** | — | **7,500 RPD** |

At ~10 messages per conversation: **~750 complete chats/day** on the free plan.
Safely handles **5–7 simultaneous active users**.

---

## Project Structure

```
ai_chatbot/
├── app/
│   ├── main.py              # FastAPI entry point
│   ├── config.py            # Settings from .env
│   ├── database.py          # SQLAlchemy engine + session
│   ├── models.py            # ORM models (agents, chat_sessions, messages)
│   ├── schemas.py           # Pydantic request/response models
│   ├── routers/
│   │   ├── chat.py          # Customer chat endpoints
│   │   ├── agent.py         # Agent dashboard endpoints
│   │   └── stream.py        # SSE streaming endpoints
│   └── services/
│       ├── ai_service.py    # Groq + Gemini integration
│       └── chat_service.py  # Session logic, handoff, SSE broadcasting
├── static/
│   ├── widget.js            # Embeddable chat widget
│   ├── widget.css           # Widget styles
│   ├── dashboard.html       # Agent dashboard page
│   ├── dashboard.js         # Dashboard logic
│   └── dashboard.css        # Dashboard styles
├── passenger_wsgi.py        # cPanel Passenger entry point
├── create_agent.py          # Script to create agent accounts
├── test_widget.html         # Local test page for the widget
├── requirements.txt
├── .env.example
└── .htaccess                # cPanel routing config
```

---

## Local Setup

### 1. Prerequisites

```bash
sudo apt-get install -y python3-pip python3.10-venv python3-full
```

### 2. Clone and set up environment

```bash
cd ai_chatbot

# Install pyenv (if not already installed)
curl https://pyenv.run | bash

# Add to ~/.bashrc
export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init - bash)"
eval "$(pyenv virtualenv-init -)"

# Create and activate virtualenv
pyenv virtualenv system ai_chatbot
pyenv local ai_chatbot
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
GROQ_API_KEY=your_groq_api_key
GEMINI_API_KEY=your_gemini_api_key

DB_HOST=localhost
DB_PORT=3306
DB_NAME=chatbot_db
DB_USER=db_user
DB_PASSWORD=db_password

SECRET_KEY=your_random_secret_string
ACCESS_TOKEN_EXPIRE_MINUTES=480

BASE_URL=http://localhost:8000
```

**Get free API keys:**
- Groq: [console.groq.com](https://console.groq.com)
- Gemini: [aistudio.google.com](https://aistudio.google.com)

### 5. Set up the database

Create the database in MariaDB/MySQL:

```sql
CREATE DATABASE chatbot_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'db_user'@'localhost' IDENTIFIED BY 'db_password';
GRANT ALL PRIVILEGES ON chatbot_db.* TO 'db_user'@'localhost';
FLUSH PRIVILEGES;
```

Tables are created automatically on first server start.

### 6. Create the first agent account

```bash
python create_agent.py
```

```
Username: admin
Password: yourpassword
Full name: Ahmed Ali

Agent 'Ahmed Ali' created successfully (id=1)
```

### 7. Run the server

```bash
uvicorn app.main:app --reload --port 8000
```

---

## Testing Locally

### API documentation
```
http://localhost:8000/docs
```

### Agent dashboard
```
http://localhost:8000/static/dashboard.html
```

### Widget test page

Open a second terminal and run:
```bash
python3 -m http.server 8082
```

Then open:
```
http://localhost:8082/test_widget.html
```

---

## Embedding the Widget

Add one line to any HTML page on the bank's website:

```html
<script
  src="https://yourdomain.com/static/widget.js"
  data-base-url="https://yourdomain.com"
  data-bank-name="My Bank Support">
</script>
```

| Attribute | Description |
|---|---|
| `data-base-url` | URL of your FastAPI server |
| `data-bank-name` | Name shown in the chat header |

---

## API Endpoints

### Customer Chat

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/chat/start` | Start a new chat session |
| POST | `/api/chat/message` | Send a message, get AI reply |
| GET | `/api/chat/history/{session_id}` | Get full chat history |
| POST | `/api/chat/close/{session_id}` | Close the session |

### Agent Dashboard

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/agent/login` | Agent login, returns JWT |
| GET | `/api/agent/sessions` | List all active sessions |
| GET | `/api/agent/sessions/{id}` | Get session detail + history |
| POST | `/api/agent/takeover/{id}` | Take over from AI |
| POST | `/api/agent/message` | Send message as agent |
| POST | `/api/agent/close/{id}` | Close a session |

### SSE Streams

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/stream/chat/{session_id}` | Real-time stream for widget |
| GET | `/api/stream/agent?token=JWT` | Real-time stream for dashboard |

---

## cPanel Deployment

### 1. Upload files

Upload all project files to your cPanel hosting (e.g., via FTP or File Manager) into a directory like `ai_chatbot/`.

### 2. Set up Python App in cPanel

```
cPanel → Software → Setup Python App
  → Python version: 3.11 (or available version)
  → Application root: /home/yourusername/ai_chatbot
  → Application startup file: passenger_wsgi.py
  → Application Entry point: application
```

### 3. Install dependencies

Inside the cPanel Python App interface, run:
```bash
pip install -r requirements.txt
```

### 4. Update .htaccess

Edit `.htaccess` and replace `yourusername` with your actual cPanel username:

```apache
PassengerEnabled on
PassengerAppRoot /home/yourusername/ai_chatbot
PassengerBaseURI /
PassengerPython /home/yourusername/virtualenv/ai_chatbot/3.11/bin/python3.11
```

### 5. Update dashboard API URL

In `static/dashboard.html`, change the script tag to point to your live domain:

```html
<script src="dashboard.js" data-api-url="https://yourdomain.com"></script>
```

### 6. Create MariaDB database in cPanel

```
cPanel → Databases → MySQL Databases
  → Create database: chatbot_db
  → Create user + assign all privileges
```

### 7. Configure .env on server

Update `.env` with your live database credentials and API keys.

### 8. Create agent accounts

```bash
python create_agent.py
```

---

## Database Schema

### `agents`
| Column | Type | Description |
|---|---|---|
| id | INT PK | Auto-increment |
| username | VARCHAR(100) | Unique login name |
| password_hash | VARCHAR(255) | bcrypt hash |
| full_name | VARCHAR(200) | Display name |
| is_active | BOOLEAN | Enable/disable account |

### `chat_sessions`
| Column | Type | Description |
|---|---|---|
| id | VARCHAR(36) PK | UUID |
| visitor_id | VARCHAR(36) | Client-generated ID (localStorage) |
| status | ENUM | `active`, `waiting`, `with_agent`, `closed` |
| assigned_agent_id | INT FK | NULL if AI is handling |
| language | VARCHAR(10) | Detected language code |

### `messages`
| Column | Type | Description |
|---|---|---|
| id | INT PK | Auto-increment |
| session_id | VARCHAR(36) FK | Linked session |
| sender_type | ENUM | `user`, `ai`, `agent` |
| content | TEXT | Message content |
| created_at | DATETIME | Timestamp |

---

## Security Notes

- Agent passwords are hashed with **bcrypt**
- JWT tokens expire after **8 hours** (configurable via `ACCESS_TOKEN_EXPIRE_MINUTES`)
- The AI is instructed to **never accept passwords, PINs, or card numbers**
- All traffic should be served over **HTTPS** (free SSL included with cPanel hosting)
- CORS is configured — restrict `allow_origins` to your domain in production

---

## License

MIT
