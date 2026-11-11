import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Typography, Chip, IconButton, Drawer } from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import MenuIcon from '@mui/icons-material/Menu';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import Sidebar from './Sidebar';

const MAX_WIDTH = '768px';

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

  const accumulatedRef = useRef('');
  const API_URL = process.env.REACT_APP_API_URL ?? '';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    fetch(`${API_URL}/quota?session_id=${sessionId}`)
      .then(r => r.json())
      .then(setQuota)
      .catch(() => {});
  }, [API_URL, sessionId]);

  const loadSessions = useCallback(() => {
    fetch(`${API_URL}/sessions`)
      .then(r => r.json())
      .then(setSessions)
      .catch(() => {});
  }, [API_URL]);

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
        accumulatedRef.current += data.text;
        updateLastMessage({ text: accumulatedRef.current });
        break;
      case 'done':
        setAgentStatus(null);
        if (data.quota) setQuota(data.quota);
        updateLastMessage(prev => ({ ...prev, streaming: false, toolsUsed: data.tools_used }));
        break;
      case 'error':
        setAgentStatus(null);
        updateLastMessage({ text: `Error: ${data.message}`, streaming: false });
        break;
      default:
        if (data.token) {
          accumulatedRef.current += data.token;
          updateLastMessage({ text: accumulatedRef.current });
        }
    }
  }, [updateLastMessage]);

  const handleSend = useCallback(async (e) => {
    e.preventDefault();
    if (input.trim() === '' || loading) return;

    const time = formatTime();
    setMessages(prev => [...prev,
      { text: input, time, sender: 'user' },
      { text: '', time, sender: 'bot', streaming: true },
    ]);
    setInput('');
    setLoading(true);
    setAgentStatus(null);
    accumulatedRef.current = '';

    try {
      const response = await fetch(`${API_URL}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg: input, session_id: sessionId }),
      });

      if (response.status === 429) {
        const data = await response.json();
        updateLastMessage({ text: `Rate limit reached: ${data.message}`, streaming: false });
        if (data.remaining !== undefined) setQuota(data);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        decoder.decode(value, { stream: true }).split('\n').forEach(processSSELine);
      }
    } catch (error) {
      console.error("Error:", error);
      setAgentStatus(null);
      updateLastMessage({ text: "Sorry, something went wrong. Please try again.", streaming: false });
    } finally {
      setLoading(false);
      setAgentStatus(null);
    }
  }, [input, loading, sessionId, API_URL, updateLastMessage, processSSELine]);

  const handleNewChat = useCallback(() => {
    const newId = crypto.randomUUID();
    localStorage.setItem('chat_session_id', newId);
    setSessionId(newId);
    setMessages([welcomeMessage()]);
    setAgentStatus(null);
    setLoading(false);
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
            <img src="/applogo.png" alt="App Logo" style={{ height: '28px', marginRight: '10px', borderRadius: 4 }} />
            <Box>
              <Typography sx={{ fontWeight: 600, fontSize: '1rem' }}>Medical Lab Assistant</Typography>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>AU5812 / AU680 / DXI800</Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {quota && (
              <Chip
                label={`${quota.remaining}/${quota.limit}`}
                size="small"
                sx={{
                  backgroundColor: quota.remaining > 3 ? 'var(--bg-tertiary)' : 'rgba(248,113,113,0.15)',
                  color: quota.remaining > 3 ? 'var(--text-secondary)' : 'var(--error)',
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
          <MessageInput input={input} setInput={setInput} handleSend={handleSend} disabled={loading} />
        </Box>
      </Box>
    </>
  );
}

function formatTime() {
  const now = new Date();
  return now.getHours() + ":" + String(now.getMinutes()).padStart(2, '0');
}

function welcomeMessage() {
  return {
    text: "Hello! I'm your Medical Lab Assistant. I can help with questions about the AU5812, AU680, and DXI800 analyzers — maintenance, calibration, troubleshooting, reagents, and more. I can also search the web for general lab topics.",
    time: formatTime(),
    sender: 'bot',
  };
}

export default ChatContainer;
