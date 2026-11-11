import React from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import LanguageIcon from '@mui/icons-material/Language';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';

const ICONS = {
  search_knowledge_base: <SearchIcon sx={{ fontSize: 14 }} />,
  web_search: <LanguageIcon sx={{ fontSize: 14 }} />,
  default: <AutoAwesomeIcon sx={{ fontSize: 14 }} />,
};

function AgentStatus({ status }) {
  if (!status) return null;

  const icon = ICONS[status.tool] || ICONS.default;

  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 1,
      px: 2,
      py: 0.75,
      mx: 2,
      mb: 1,
      borderRadius: '8px',
      backgroundColor: 'var(--bg-tertiary)',
      border: '1px solid var(--border)',
      maxWidth: 'fit-content',
    }}>
      <CircularProgress size={12} sx={{ color: 'var(--accent)' }} />
      {icon}
      <Typography variant="caption" sx={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
        {status.message}
      </Typography>
    </Box>
  );
}

export default AgentStatus;
