(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────
  // The script tag can carry a data-base-url attribute to override the default.
  var scriptTag = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();
  var BASE_URL = (scriptTag && scriptTag.getAttribute('data-base-url')) || '';
  var BANK_NAME = (scriptTag && scriptTag.getAttribute('data-bank-name')) || 'Bank Support';

  // ── State ────────────────────────────────────────────────────────────────────
  var visitorId = localStorage.getItem('bcw_visitor_id');
  if (!visitorId) {
    visitorId = 'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('bcw_visitor_id', visitorId);
  }
  var sessionId = null;
  var isOpen = false;
  var isWaiting = false;
  var unreadCount = 0;
  var eventSource = null;
  var currentAgentName = null;

  // ── Inject CSS ───────────────────────────────────────────────────────────────
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = BASE_URL + '/static/widget.css';
  document.head.appendChild(link);

  // ── Build HTML ───────────────────────────────────────────────────────────────
  var container = document.createElement('div');
  container.id = 'bank-chat-widget';
  container.innerHTML = [
    '<button id="bank-chat-btn" aria-label="Open chat">',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">',
        '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
      '</svg>',
      '<span id="bank-chat-badge"></span>',
    '</button>',
    '<div id="bank-chat-window" role="dialog" aria-label="Customer support chat">',
      '<div id="bank-chat-header">',
        '<div id="bank-chat-avatar">',
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">',
            '<circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>',
          '</svg>',
        '</div>',
        '<div id="bank-chat-header-info">',
          '<div id="bank-chat-title">' + BANK_NAME + '</div>',
          '<div id="bank-chat-subtitle">We typically reply in seconds</div>',
        '</div>',
        '<button id="bank-chat-close" aria-label="Close chat">',
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">',
            '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
          '</svg>',
        '</button>',
      '</div>',
      '<div id="bank-chat-status"></div>',
      '<div id="bank-chat-messages" aria-live="polite">',
        '<div class="bcw-msg ai">',
          '<div class="bcw-sender">Support</div>',
          'Hello! How can I help you today?',
        '</div>',
        '<div id="bank-chat-typing"><div class="bcw-dots"><span></span><span></span><span></span></div></div>',
      '</div>',
      '<div id="bank-chat-input-area">',
        '<textarea id="bank-chat-input" placeholder="Type a message..." rows="1" aria-label="Message input"></textarea>',
        '<button id="bank-chat-send" aria-label="Send message">',
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">',
            '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
          '</svg>',
        '</button>',
      '</div>',
    '</div>',
  ].join('');
  document.body.appendChild(container);

  // ── Element references ───────────────────────────────────────────────────────
  var btn     = document.getElementById('bank-chat-btn');
  var badge   = document.getElementById('bank-chat-badge');
  var window_ = document.getElementById('bank-chat-window');
  var status_ = document.getElementById('bank-chat-status');
  var msgs    = document.getElementById('bank-chat-messages');
  var typing  = document.getElementById('bank-chat-typing');
  var input   = document.getElementById('bank-chat-input');
  var send    = document.getElementById('bank-chat-send');
  var close   = document.getElementById('bank-chat-close');

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function scrollToBottom() {
    msgs.scrollTop = msgs.scrollHeight;
  }

  function showStatus(text, color) {
    status_.textContent = text;
    status_.style.background = color || '#e8f0fe';
    status_.style.color = '#1a3a6b';
    status_.style.display = 'block';
  }

  function hideStatus() {
    status_.style.display = 'none';
  }

  function addMessage(senderType, content, senderName) {
    var div = document.createElement('div');
    div.className = 'bcw-msg ' + senderType;
    var html = '';
    if (senderType !== 'user') {
      html += '<div class="bcw-sender">' + (senderName || (senderType === 'agent' ? 'Agent' : 'Support')) + '</div>';
    }
    html += escapeHtml(content);
    html += '<div class="bcw-time">' + formatTime(new Date()) + '</div>';
    div.innerHTML = html;
    msgs.appendChild(div);
    scrollToBottom();

    if (!isOpen) {
      unreadCount++;
      badge.textContent = unreadCount;
      badge.style.display = 'flex';
    }
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  function showTyping() { typing.style.display = 'block'; scrollToBottom(); }
  function hideTyping() { typing.style.display = 'none'; }

  function setInputDisabled(disabled) {
    input.disabled = disabled;
    send.disabled = disabled;
  }

  // ── API calls ────────────────────────────────────────────────────────────────
  function apiPost(path, body) {
    return fetch(BASE_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }

  // ── Session management ────────────────────────────────────────────────────────
  function startSession() {
    apiPost('/api/chat/start', { visitor_id: visitorId })
      .then(function (data) {
        sessionId = data.session_id;
        connectSSE();
      })
      .catch(function () {
        showStatus('Connection error. Please refresh.', '#fdecea');
      });
  }

  // ── SSE ──────────────────────────────────────────────────────────────────────
  function connectSSE() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(BASE_URL + '/api/stream/chat/' + sessionId);
    eventSource.onmessage = function (e) {
      try {
        var payload = JSON.parse(e.data);
        handleSSEEvent(payload.event, payload.data);
      } catch (_) {}
    };
    eventSource.onerror = function () {
      setTimeout(connectSSE, 3000);
    };
  }

  function handleSSEEvent(event, data) {
    if (event === 'message') {
      hideTyping();
      if (data.sender_type !== 'user') {
        var name = data.sender_type === 'agent' ? (currentAgentName || 'Agent') : null;
        addMessage(data.sender_type, data.content, name);
      }
    } else if (event === 'handoff') {
      hideTyping();
      showStatus('⏳ ' + data.message, '#fff8e1');
    } else if (event === 'agent_joined') {
      currentAgentName = data.agent_name;
      showStatus('✓ Connected with ' + data.agent_name, '#e8f5e9');
      addMessage('agent', data.message, data.agent_name);
    } else if (event === 'closed') {
      showStatus('Chat ended. Thank you!', '#e8f0fe');
      setInputDisabled(true);
      if (eventSource) { eventSource.close(); eventSource = null; }
    }
  }

  // ── Send message ──────────────────────────────────────────────────────────────
  function sendMessage() {
    var text = input.value.trim();
    if (!text || !sessionId) return;

    addMessage('user', text);
    input.value = '';
    input.style.height = 'auto';
    setInputDisabled(true);
    showTyping();

    apiPost('/api/chat/message', { session_id: sessionId, content: text })
      .then(function (data) {
        setInputDisabled(false);
        input.focus();
        // If with_agent, the SSE push from agent side handles the display
        // If AI replied, SSE will deliver it — but if SSE is slow, data.reply is backup
        if (data.session_status !== 'with_agent' && data.reply) {
          // SSE will also fire; avoid duplicate by relying on SSE only
        }
        if (data.session_status === 'closed') {
          setInputDisabled(true);
        }
      })
      .catch(function () {
        hideTyping();
        setInputDisabled(false);
        addMessage('ai', 'Sorry, there was a connection error. Please try again.');
      });
  }

  // ── Toggle window ─────────────────────────────────────────────────────────────
  function openChat() {
    isOpen = true;
    window_.style.display = 'flex';
    unreadCount = 0;
    badge.style.display = 'none';
    if (!sessionId) startSession();
    setTimeout(function () { input.focus(); scrollToBottom(); }, 100);
  }

  function closeChat() {
    isOpen = false;
    window_.style.display = 'none';
  }

  // ── Event listeners ───────────────────────────────────────────────────────────
  btn.addEventListener('click', function () {
    if (isOpen) closeChat(); else openChat();
  });

  close.addEventListener('click', closeChat);

  send.addEventListener('click', sendMessage);

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  input.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 80) + 'px';
  });

})();
