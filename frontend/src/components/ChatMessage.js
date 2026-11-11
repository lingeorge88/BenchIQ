import React from 'react';
import ReactMarkdown from 'react-markdown';
import { ListItem, Avatar, Box, Chip, Typography } from '@mui/material';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import SearchIcon from '@mui/icons-material/Search';
import LanguageIcon from '@mui/icons-material/Language';

const TOOL_LABELS = {
  search_knowledge_base: { label: 'Knowledge Base', icon: <SearchIcon sx={{ fontSize: 12 }} /> },
  web_search: { label: 'Web Search', icon: <LanguageIcon sx={{ fontSize: 12 }} /> },
};

function ChatMessage({ message }) {
  const isUser = message.sender === 'user';
  const tools = message.toolsUsed || [];

  return (
    <ListItem sx={{
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      alignItems: 'flex-start',
      marginBottom: '10px',
      padding: '0 8px',
    }}>
      {!isUser && (
        <Avatar sx={{ mr: 1.5, mt: 0.5, width: 36, height: 36, backgroundColor: 'var(--accent)', flexShrink: 0 }}>
          <SmartToyOutlinedIcon sx={{ fontSize: 18 }} />
        </Avatar>
      )}
      <Box sx={{ maxWidth: '75%', minWidth: 0, overflow: 'hidden' }}>
        <Box sx={{
          backgroundColor: isUser ? 'var(--user-bubble)' : 'var(--bot-bubble)',
          border: isUser ? 'none' : '1px solid var(--border)',
          borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          padding: '10px 16px',
          overflow: 'hidden',
        }}>
          <Box sx={{
            color: isUser ? '#fff' : 'var(--text-primary)',
            fontSize: '0.9rem',
            lineHeight: 1.65,
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
            '& p': { margin: '0 0 8px 0' },
            '& p:last-child': { mb: 0 },
            '& ul, & ol': { pl: 2.5, mb: 1, mt: 0.5 },
            '& li': { mb: 0.5 },
            '& li::marker': { color: 'var(--text-muted)' },
            '& h1, & h2, & h3, & h4': {
              fontSize: '0.95rem',
              fontWeight: 600,
              mt: 1.5,
              mb: 0.5,
              '&:first-of-type': { mt: 0 },
            },
            '& code': {
              backgroundColor: 'var(--bg-primary)',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '0.82em',
              overflowWrap: 'break-word',
            },
            '& pre': {
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '8px',
              padding: '10px 12px',
              overflowX: 'auto',
              mb: 1,
              '& code': {
                backgroundColor: 'transparent',
                padding: 0,
                fontSize: '0.82em',
              },
            },
            '& a': {
              color: 'var(--accent)',
              textDecoration: 'none',
              wordBreak: 'break-all',
              '&:hover': { textDecoration: 'underline' },
            },
            '& strong': { fontWeight: 600 },
            '& blockquote': {
              borderLeft: '3px solid var(--border)',
              pl: 1.5,
              ml: 0,
              color: 'var(--text-secondary)',
              fontStyle: 'italic',
            },
            '& hr': {
              border: 'none',
              borderTop: '1px solid var(--border)',
              my: 1.5,
            },
            '& table': {
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.85em',
              mb: 1,
              display: 'block',
              overflowX: 'auto',
            },
            '& th, & td': {
              border: '1px solid var(--border)',
              padding: '4px 8px',
              textAlign: 'left',
            },
            '& th': {
              backgroundColor: 'var(--bg-tertiary)',
              fontWeight: 600,
            },
            '& img': {
              maxWidth: '100%',
              borderRadius: '8px',
            },
          }}>
            <ReactMarkdown>{message.text || (message.streaming ? '' : '...')}</ReactMarkdown>
          </Box>
          <Typography variant="caption" sx={{
            color: 'var(--text-muted)',
            fontSize: '0.7rem',
            display: 'block',
            mt: 0.5,
            textAlign: isUser ? 'right' : 'left',
          }}>
            {message.time}
          </Typography>
        </Box>
        {!isUser && tools.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
            {tools.map(tool => {
              const info = TOOL_LABELS[tool];
              if (!info) return null;
              return (
                <Chip
                  key={tool}
                  icon={info.icon}
                  label={info.label}
                  size="small"
                  sx={{
                    height: 20, fontSize: '0.65rem',
                    backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)',
                    border: '1px solid var(--border)',
                    '& .MuiChip-icon': { color: 'var(--text-muted)', ml: 0.5 },
                    '& .MuiChip-label': { px: 0.75 },
                  }}
                />
              );
            })}
          </Box>
        )}
      </Box>
      {isUser && (
        <Avatar sx={{ ml: 1.5, mt: 0.5, width: 36, height: 36, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border)', flexShrink: 0 }}>
          <PersonOutlineIcon sx={{ fontSize: 18, color: 'var(--text-secondary)' }} />
        </Avatar>
      )}
    </ListItem>
  );
}

export default ChatMessage;
