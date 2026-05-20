(function () {
  'use strict';

  var scriptTag = document.currentScript || document.querySelector('script[data-api-url]');
  var BASE_URL = (scriptTag && scriptTag.getAttribute('data-api-url')) || '';
  var token = null;
  var agentId = null;
  var agentName = '';
  var eventSource = null;

  var sessions = {};        // { sessionId: sessionData }
  var activeSessionId = null;

  // ── Elements ──────────────────────────────────────────────────────────────
  var loginScreen    = document.getElementById('login-screen');
  var appScreen      = document.getElementById('app-screen');
  var loginBtn       = document.getElementById('login-btn');
  var loginError     = document.getElementById('login-error');
  var logoutBtn      = document.getElementById('logout-btn');
  var refreshBtn     = document.getElementById('refresh-btn');
  var agentNameEl    = document.getElementById('agent-name-display');
  var sessionList    = document.getElementById('session-list');
  var sessionCount   = document.getElementById('session-count');
  var emptyState     = document.getElementById('empty-state');
  var chatView       = document.getElementById('chat-view');
  var chatTitle      = document.getElementById('chat-panel-title');
  var chatMessages   = document.getElementById('chat-messages');
  var btnTakeover    = document.getElementById('btn-takeover');
  var btnCloseChat   = document.getElementById('btn-close-chat');
  var agentMsgInput  = document.getElementById('agent-msg-input');
  var agentSendBtn   = document.getElementById('agent-send-btn');
  var toastEl        = document.getElementById('toast');

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _handleUnauthorized(status) {
    if (status === 401) {
      sessionStorage.clear();
      if (eventSource) eventSource.close();
      loginError.textContent = 'Your session has expired. Please sign in again.';
      appScreen.style.display = 'none';
      loginScreen.style.display = 'flex';
      return true;
    }
    return false;
  }

  function apiPost(path, body) {
    return fetch(BASE_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (_handleUnauthorized(r.status)) throw new Error('session_expired');
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.detail || 'Error'); });
      return r.json();
    });
  }

  function apiGet(path) {
    return fetch(BASE_URL + path, {
      headers: { 'Authorization': 'Bearer ' + token },
    }).then(function (r) {
      if (_handleUnauthorized(r.status)) throw new Error('session_expired');
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.detail || 'Request failed'); });
      return r.json();
    });
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(function () { toastEl.style.display = 'none'; }, 3500);
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }

  function shortId(id) {
    return '#' + id.slice(-6).toUpperCase();
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  document.getElementById('login-username').addEventListener('keydown', handleLoginKey);
  document.getElementById('login-password').addEventListener('keydown', handleLoginKey);
  function handleLoginKey(e) { if (e.key === 'Enter') loginBtn.click(); }

  loginBtn.addEventListener('click', function () {
    var username = document.getElementById('login-username').value.trim();
    var password = document.getElementById('login-password').value;
    loginError.textContent = '';
    if (!username || !password) { loginError.textContent = 'Please enter username and password.'; return; }
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';

    fetch(BASE_URL + '/api/agent/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.access_token) throw new Error(data.detail || 'Login failed');
        token = data.access_token;
        agentId = data.agent_id;
        agentName = data.full_name;
        sessionStorage.setItem('agent_token', token);
        sessionStorage.setItem('agent_id', agentId);
        sessionStorage.setItem('agent_name', agentName);
        showApp();
      })
      .catch(function (err) {
        loginError.textContent = err.message || 'Login failed. Check your credentials.';
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign In';
      });
  });

  refreshBtn.addEventListener('click', loadSessions);

  logoutBtn.addEventListener('click', function () {
    sessionStorage.clear();
    if (eventSource) eventSource.close();
    location.reload();
  });

  function showApp() {
    loginScreen.style.display = 'none';
    appScreen.style.display = 'flex';
    agentNameEl.textContent = agentName;
    loadSessions();
    startPolling();
    connectSSE();
  }

  // ── Session list ──────────────────────────────────────────────────────────
  function loadSessions() {
    apiGet('/api/agent/sessions').then(function (data) {
      if (!Array.isArray(data)) throw new Error('Unexpected response from server');
      sessions = {};
      data.forEach(function (s) { sessions[s.session_id] = s; });
      renderSessionList();
    }).catch(function (err) {
      if (err.message === 'session_expired') return;
      showToast('Could not load sessions: ' + err.message);
    });
  }

  var _pollTimer = null;
  function startPolling() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(loadSessions, 30000);
  }

  function renderSessionList() {
    var ids = Object.keys(sessions);
    sessionCount.textContent = ids.length;
    if (!ids.length) {
      sessionList.innerHTML = '<div style="padding:24px;text-align:center;color:#aaa;font-size:13px;">No active chats</div>';
      return;
    }
    ids.sort(function (a, b) {
      // waiting first, then by time
      var order = { waiting: 0, active: 1, with_agent: 2 };
      var sa = sessions[a], sb = sessions[b];
      return (order[sa.status] || 3) - (order[sb.status] || 3);
    });
    sessionList.innerHTML = ids.map(function (id) {
      var s = sessions[id];
      return [
        '<div class="session-item' + (id === activeSessionId ? ' active' : '') + '" data-id="' + id + '">',
          '<div class="session-item-top">',
            '<span class="session-item-id">' + shortId(id) + '</span>',
            '<span class="session-dot dot-' + s.status + '"></span>',
          '</div>',
          '<div class="session-last-msg">' + escapeHtml(s.last_message || '—') + '</div>',
          '<div class="session-meta">',
            '<span class="session-badge badge-' + s.status + '">' + s.status.replace('_', ' ') + '</span>',
            '<span class="session-time">' + (s.created_at ? formatTime(s.created_at) : '') + '</span>',
          '</div>',
        '</div>',
      ].join('');
    }).join('');

    sessionList.querySelectorAll('.session-item').forEach(function (el) {
      el.addEventListener('click', function () { openSession(el.dataset.id); });
    });
  }

  function openSession(sessionId) {
    activeSessionId = sessionId;
    renderSessionList();
    emptyState.style.display = 'none';
    chatView.style.display = 'flex';

    var s = sessions[sessionId];
    chatTitle.textContent = 'Chat ' + shortId(sessionId) + (s && s.assigned_agent_name ? ' — ' + s.assigned_agent_name : '');
    updateTakeoverButton(s);
    chatMessages.innerHTML = '';

    apiGet('/api/agent/sessions/' + sessionId).then(function (data) {
      data.messages.forEach(function (m) { appendMessage(m.sender_type, m.content, m.created_at); });
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
  }

  function updateTakeoverButton(s) {
    if (!s) return;
    if (s.status === 'with_agent' && s.assigned_agent_name) {
      btnTakeover.disabled = true;
      btnTakeover.textContent = 'Agent: ' + s.assigned_agent_name;
    } else if (s.status === 'closed') {
      btnTakeover.disabled = true;
      btnTakeover.textContent = 'Closed';
      agentMsgInput.disabled = true;
      agentSendBtn.disabled = true;
    } else {
      btnTakeover.disabled = false;
      btnTakeover.textContent = 'Take Over';
      agentMsgInput.disabled = false;
      agentSendBtn.disabled = false;
    }
  }

  function appendMessage(senderType, content, time) {
    var div = document.createElement('div');
    div.className = 'msg-row ' + senderType;
    var senderLabel = senderType === 'user' ? 'Customer' : senderType === 'ai' ? 'AI Support' : agentName;
    div.innerHTML = [
      '<div class="msg-sender">' + escapeHtml(senderLabel) + '</div>',
      '<div class="msg-bubble ' + senderType + '">' + escapeHtml(content) + '</div>',
      '<div class="msg-time">' + (time ? formatTime(time) : formatTime(new Date().toISOString())) + '</div>',
    ].join('');
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // ── Takeover ──────────────────────────────────────────────────────────────
  btnTakeover.addEventListener('click', function () {
    if (!activeSessionId) return;
    btnTakeover.disabled = true;
    apiPost('/api/agent/takeover/' + activeSessionId, {})
      .then(function () {
        showToast('You have taken over the chat.');
        sessions[activeSessionId].status = 'with_agent';
        sessions[activeSessionId].assigned_agent_name = agentName;
        renderSessionList();
        updateTakeoverButton(sessions[activeSessionId]);
      })
      .catch(function (e) { showToast(e.message); btnTakeover.disabled = false; });
  });

  // ── Close chat ────────────────────────────────────────────────────────────
  btnCloseChat.addEventListener('click', function () {
    if (!activeSessionId || !confirm('End this chat session?')) return;
    apiPost('/api/agent/close/' + activeSessionId, {})
      .then(function () {
        showToast('Chat ended.');
        delete sessions[activeSessionId];
        activeSessionId = null;
        renderSessionList();
        emptyState.style.display = 'flex';
        chatView.style.display = 'none';
      });
  });

  // ── Send message ──────────────────────────────────────────────────────────
  function sendAgentMessage() {
    var text = agentMsgInput.value.trim();
    if (!text || !activeSessionId) return;
    agentMsgInput.value = '';
    agentMsgInput.style.height = 'auto';
    apiPost('/api/agent/message', { session_id: activeSessionId, content: text })
      .then(function () {
        appendMessage('agent', text, null);
        if (sessions[activeSessionId]) sessions[activeSessionId].last_message = text;
        renderSessionList();
      });
  }

  agentSendBtn.addEventListener('click', sendAgentMessage);
  agentMsgInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAgentMessage(); }
  });
  agentMsgInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
  });

  // ── SSE ───────────────────────────────────────────────────────────────────
  function connectSSE() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(BASE_URL + '/api/stream/agent?token=' + token);
    eventSource.onmessage = function (e) {
      try {
        var payload = JSON.parse(e.data);
        handleAgentSSE(payload.event, payload.data);
      } catch (_) {}
    };
    eventSource.onerror = function () {
      if (eventSource) { eventSource.close(); eventSource = null; }
      // Verify token is still valid before retrying — avoids infinite 401 loop
      fetch(BASE_URL + '/api/agent/sessions', {
        headers: { 'Authorization': 'Bearer ' + token },
      }).then(function (r) {
        if (r.status === 401) {
          _handleUnauthorized(401);
        } else {
          setTimeout(connectSSE, 4000);
        }
      }).catch(function () {
        setTimeout(connectSSE, 4000);
      });
    };
  }

  function handleAgentSSE(event, data) {
    if (event === 'new_session') {
      loadSessions();
      showToast('New chat started: ' + shortId(data.session_id));
    } else if (event === 'new_waiting_session') {
      loadSessions();
      showToast('⚠️ Chat needs agent: ' + shortId(data.session_id));
    } else if (event === 'message') {
      // New message in a session we're watching
      if (data.session_id === activeSessionId && data.sender_type === 'user') {
        appendMessage('user', data.content, null);
      }
      if (sessions[data.session_id]) {
        sessions[data.session_id].last_message = data.content;
        renderSessionList();
      }
    } else if (event === 'ping') {
      // keep-alive, ignore
    }
  }

  // ── Auto-login from sessionStorage ───────────────────────────────────────
  var savedToken = sessionStorage.getItem('agent_token');
  if (savedToken) {
    token = savedToken;
    agentId = parseInt(sessionStorage.getItem('agent_id'));
    agentName = sessionStorage.getItem('agent_name') || 'Agent';
    showApp();
  }

})();
