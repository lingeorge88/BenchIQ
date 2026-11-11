import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Typography, Chip, IconButton, Drawer } from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import MenuIcon from '@mui/icons-material/Menu';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import Sidebar from './Sidebar';
import VoiceMode from './VoiceMode';
import useVoiceMode from '../hooks/useVoiceMode';

const MAX_WIDTH = '768px';
const MODEL_KEY = 'benchiq_model';
const API_URL = process.env.REACT_APP_API_URL ?? '';

function ChatContainer() {
  const [messages, setMessages] = useState([welcomeMessage()]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null);
  const [quota, setQuota] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved ? saved === 'dark' : true;
  });
  const [sessionId, setSessionId] = useState(() => {
    let id = localStorage.getItem('chat_session_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('chat_session_id', id);
    }
    return id;
  });

  const [models, setModels] = useState(null); // null = unavailable -> picker hidden, model omitted
  const [model, setModel] = useState(() => localStorage.getItem(MODEL_KEY) || '');

  const accumulatedRef = useRef('');
  const loadingRef = useRef(false);
  // Per-request callbacks ({ onToken, onDone, onError, settled }) reachable from processSSELine.
  const requestRef = useRef({});

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    fetch(`${API_URL}/models`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(data => {
        const list = Array.isArray(data?.models) ? data.models : [];
        if (!list.length) return;
        setModels(list);
        setModel(prev => (list.some(m => m.id === prev) ? prev : data.default || list[0].id));
      })
      .catch(() => setModels(null));
  }, []);

  useEffect(() => {
    if (model) localStorage.setItem(MODEL_KEY, model);
  }, [model]);

  useEffect(() => {
    fetch(`${API_URL}/quota?session_id=${sessionId}`)
      .then(r => r.json())
      .then(setQuota)
      .catch(() => {});
  }, [sessionId]);

  const loadSessions = useCallback(() => {
    fetch(`${API_URL}/sessions`)
      .then(r => r.json())
      .then(setSessions)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (sidebarOpen) loadSessions();
  }, [sidebarOpen, loadSessions]);

  const updateLastMessage = useCallback((updater) => {
    setMessages(prev => {
      const updated = [...prev];
      updated[updated.length - 1] = typeof updater === 'function'
        ? updater(updated[updated.length - 1])
        : { ...updated[updated.length - 1], ...updater };
      return updated;
    });
  }, []);

  const processSSELine = useCallback((line) => {
    if (!line.startsWith('data: ')) return;
    let data;
    try {
      data = JSON.parse(line.slice(6));
    } catch {
      return;
    }
    switch (data.type) {
      case 'status':
        setAgentStatus({ message: data.message });
        break;
      case 'tool_start':
        setAgentStatus({ tool: data.tool, message: data.message });
        break;
      case 'tool_result':
        setAgentStatus({ tool: data.tool, message: `Found ${data.result_count} results` });
        break;
      case 'generation_start':
        setAgentStatus({ message: data.message });
        break;
      case 'token':
        appendToken(data.text);
        break;
      case 'done':
        setAgentStatus(null);
        if (data.quota) setQuota(data.quota);
        updateLastMessage(prev => ({ ...prev, streaming: false, toolsUsed: data.tools_used }));
        settle(requestRef.current, null, accumulatedRef.current);
        break;
      case 'error':
        setAgentStatus(null);
        updateLastMessage({ text: `Error: ${data.message}`, streaming: false });
        settle(requestRef.current, data.message || 'Error');
        break;
      default:
        if (data.token) appendToken(data.token);
    }

    function appendToken(chunk) {
      if (!chunk) return;
      accumulatedRef.current += chunk;
      updateLastMessage({ text: accumulatedRef.current });
      requestRef.current.onToken?.(chunk);
    }
  }, [updateLastMessage]);

  const sendMessage = useCallback(async (text, { voice = false, onToken, onDone, onError } = {}) => {
    const msg = (text || '').trim();
    if (!msg) return;
    if (loadingRef.current) {
      onError?.('Please wait for the current response to finish.');
      return;
    }
    const request = { onToken, onDone, onError, settled: false };
    requestRef.current = request;
    loadingRef.current = true;

    const time = formatTime();
    setMessages(prev => [...prev,
      { text: msg, time, sender: 'user' },
      { text: '', time, sender: 'bot', streaming: true },
    ]);
    setLoading(true);
    setAgentStatus(null);
    accumulatedRef.current = '';

    const body = { msg, session_id: sessionId, voice };
    if (models && model) body.model = model;

    try {
      const response = await fetch(`${API_URL}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        const message = `Rate limit reached: ${data.message || 'please try again later.'}`;
        updateLastMessage({ text: message, streaming: false });
        if (data.remaining !== undefined) setQuota(data);
        settle(request, message);
        return;
      }
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        const message = data.detail || data.message || `Request failed (${response.status})`;
        updateLastMessage({ text: `Error: ${message}`, streaming: false });
        settle(request, String(message));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = ''; // carries a partial SSE line across chunk boundaries
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop();
        lines.forEach(line => processSSELine(line.replace(/\r$/, '')));
      }
      pending += decoder.decode();
      if (pending) processSSELine(pending.replace(/\r$/, ''));

      // Stream closed without a done/error event.
      if (!request.settled) {
        updateLastMessage(prev => ({ ...prev, streaming: false }));
        settle(request, null, accumulatedRef.current);
      }
    } catch (error) {
      console.error("Error:", error);
      updateLastMessage({ text: "Sorry, something went wrong. Please try again.", streaming: false });
      settle(request, 'Something went wrong. Please try again.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setAgentStatus(null);
    }
  }, [sessionId, model, models, updateLastMessage, processSSELine]);

  const handleSend = useCallback((e) => {
    e.preventDefault();
    if (input.trim() === '' || loading) return;
    setInput('');
    sendMessage(input);
  }, [input, loading, sendMessage]);

  const voice = useVoiceMode({ sendMessage, apiUrl: API_URL });

  const handleNewChat = useCallback(() => {
    const newId = crypto.randomUUID();
    localStorage.setItem('chat_session_id', newId);
    setSessionId(newId);
    setMessages([welcomeMessage()]);
    setAgentStatus(null);
    setSidebarOpen(false);
  }, []);

  const handleSelectSession = useCallback((id) => {
    localStorage.setItem('chat_session_id', id);
    setSessionId(id);
    setMessages([{ text: "Resumed previous conversation.", time: formatTime(), sender: 'bot' }]);
    setSidebarOpen(false);
  }, []);

  return (
    <>
      {/* Sidebar overlay drawer */}
      <Drawer
        anchor="left"
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        PaperProps={{
          sx: { backgroundColor: 'var(--bg-secondary)', borderRight: '1px solid var(--border)', width: 260 },
        }}
      >
        <Sidebar
          sessions={sessions}
          currentSessionId={sessionId}
          onSelectSession={handleSelectSession}
          onNewChat={handleNewChat}
          open={true}
        />
      </Drawer>

      {/* Main chat — fixed 768px centered */}
      <Box sx={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        maxWidth: MAX_WIDTH,
        margin: '0 auto',
      }}>
        {/* Header */}
        <Box sx={{
          backgroundColor: 'var(--bg-secondary)',
          padding: '8px 16px',
          margin: '8px 8px 0 8px',
          borderRadius: '18px',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <IconButton onClick={() => setSidebarOpen(true)} size="small" sx={{ color: 'var(--text-secondary)', mr: 1 }}>
              <MenuIcon sx={{ fontSize: 20 }} />
            </IconButton>
            <img src="/applogo.png" alt="BenchIQ logo" style={{ height: '28px', marginRight: '10px', borderRadius: 4 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 600, fontSize: '1rem' }}>BenchIQ</Typography>
              <Typography noWrap sx={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: { xs: 'none', sm: 'block' } }}>
                Lab assistant · AU5812 / AU680 / DXI800
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {quota && (
              <Chip
                label={`${quota.remaining}/${quota.limit}`}
                size="small"
                sx={{
                  backgroundColor: quota.remaining > 1 ? 'var(--bg-tertiary)' : 'rgba(248,113,113,0.15)',
                  color: quota.remaining > 1 ? 'var(--text-secondary)' : 'var(--error)',
                  border: '1px solid var(--border)',
                  fontSize: '0.7rem',
                  height: 24,
                }}
              />
            )}
            <IconButton onClick={() => setDarkMode(!darkMode)} size="small" sx={{ color: 'var(--text-secondary)' }}>
              {darkMode ? <LightModeIcon sx={{ fontSize: 18 }} /> : <DarkModeIcon sx={{ fontSize: 18 }} />}
            </IconButton>
          </Box>
        </Box>

        {/* Messages */}
        <MessageList messages={messages} loading={loading} agentStatus={agentStatus} />

        {/* Input */}
        <Box sx={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: '18px',
          padding: '4px 12px',
          margin: '0 8px 36px 8px',
          flexShrink: 0,
        }}>
          <MessageInput
            input={input}
            setInput={setInput}
            handleSend={handleSend}
            disabled={loading}
            models={models}
            model={model}
            setModel={setModel}
            voiceSupported={voice.supported}
            onVoice={voice.open}
          />
        </Box>
      </Box>

      <VoiceMode voice={voice} />
    </>
  );
}

function formatTime() {
  const now = new Date();
  return now.getHours() + ":" + String(now.getMinutes()).padStart(2, '0');
}

// Invoke a request's onDone/onError exactly once.
function settle(request, error, text = '') {
  if (!request || request.settled) return;
  request.settled = true;
  if (error != null) request.onError?.(error);
  else request.onDone?.(text);
}

function welcomeMessage() {
  return {
    text: "Hello! I'm BenchIQ, your lab assistant. I can help with questions about the AU5812, AU680, and DXI800 analyzers — maintenance, calibration, troubleshooting, reagents, and more. I can also search the web for general lab topics.",
    time: formatTime(),
    sender: 'bot',
  };
}

export default ChatContainer;
