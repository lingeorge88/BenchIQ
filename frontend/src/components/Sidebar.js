import React from 'react';
import { Box, Typography, List, ListItemButton, ListItemText, IconButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';

function Sidebar({ sessions, currentSessionId, onSelectSession, onNewChat, open }) {
  if (!open) return null;

  return (
    <Box sx={{
      width: 260,
      minWidth: 260,
      height: '100vh',
      backgroundColor: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2,
        py: 1.5,
        borderBottom: '1px solid var(--border)',
      }}>
        <Typography sx={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.85rem' }}>
          Chat History
        </Typography>
        <IconButton onClick={onNewChat} size="small" sx={{ color: 'var(--text-secondary)' }}>
          <AddIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>
      <List sx={{
        flexGrow: 1,
        overflowY: 'auto',
        px: 1,
        py: 1,
        '&::-webkit-scrollbar': { width: '4px' },
        '&::-webkit-scrollbar-thumb': { background: 'var(--border)', borderRadius: '2px' },
      }}>
        {sessions.length === 0 && (
          <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.8rem', px: 1, py: 2, textAlign: 'center' }}>
            No previous chats
          </Typography>
        )}
        {sessions.map((session) => (
          <ListItemButton
            key={session.session_id}
            selected={session.session_id === currentSessionId}
            onClick={() => onSelectSession(session.session_id)}
            sx={{
              borderRadius: '8px',
              mb: 0.5,
              py: 1,
              px: 1.5,
              '&.Mui-selected': {
                backgroundColor: 'var(--bg-tertiary)',
                '&:hover': { backgroundColor: 'var(--bg-hover)' },
              },
              '&:hover': { backgroundColor: 'var(--bg-hover)' },
            }}
          >
            <ChatBubbleOutlineIcon sx={{ fontSize: 14, color: 'var(--text-muted)', mr: 1.5 }} />
            <ListItemText
              primary={`Chat ${session.session_id.slice(0, 8)}`}
              secondary={`${session.message_count} messages`}
              primaryTypographyProps={{
                fontSize: '0.8rem',
                color: 'var(--text-primary)',
                noWrap: true,
              }}
              secondaryTypographyProps={{
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
              }}
            />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}

export default Sidebar;
