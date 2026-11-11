import React, { useRef, useEffect } from 'react';
import { List, Box } from '@mui/material';
import ChatMessage from './ChatMessage';
import AgentStatus from './AgentStatus';

function MessageList({ messages, loading, agentStatus }) {
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, agentStatus]);

  return (
    <List sx={{ flexGrow: 1, overflowY: 'auto', padding: '10px', paddingBottom: '100px' }}>
      {messages.map((message, index) => (
        <ChatMessage key={index} message={message} />
      ))}
      {agentStatus && (
        <Box sx={{ px: 2, pb: 1 }}>
          <AgentStatus status={agentStatus} />
        </Box>
      )}
      <div ref={messagesEndRef} />
    </List>
  );
}

export default MessageList;
