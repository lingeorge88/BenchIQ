import React from 'react';
import { Box, TextField, IconButton, Select, MenuItem, Tooltip, Typography } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';

const menuPaperSx = {
  backgroundColor: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
  '& .MuiMenuItem-root.Mui-selected': { backgroundColor: 'var(--bg-tertiary)' },
  '& .MuiMenuItem-root:hover': { backgroundColor: 'var(--bg-tertiary)' },
};

const selectSx = {
  height: 30,
  maxWidth: { xs: 150, sm: 220 },
  fontSize: '0.75rem',
  color: 'var(--text-secondary)',
  borderRadius: '10px',
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border)' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--text-muted)' },
  '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--accent)' },
  '& .MuiSelect-icon': { color: 'var(--text-muted)' },
};

const roundButtonSx = { width: 36, height: 36, borderRadius: '10px', transition: 'all 0.2s' };

function MessageInput({ input, setInput, handleSend, disabled, models, model, setModel, voiceSupported, onVoice }) {
  const hasText = !!input.trim();

  const onKeyDown = (e) => {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (hasText && !disabled) handleSend(e);
    }
  };

  return (
    <form onSubmit={handleSend} style={{ padding: '6px 0 4px', width: '100%' }}>
      <TextField
        fullWidth
        multiline
        maxRows={6}
        variant="outlined"
        size="small"
        placeholder="Ask about analyzer procedures, maintenance, troubleshooting..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        sx={{
          '& .MuiOutlinedInput-root': {
            padding: '6px 4px',
            backgroundColor: 'transparent',
            color: 'var(--text-primary)',
            fontSize: '0.9rem',
            '& fieldset': { border: 'none' },
          },
          '& .MuiInputBase-input::placeholder': { color: 'var(--text-muted)', opacity: 1 },
        }}
      />

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, pt: 0.5 }}>
        <Box sx={{ minWidth: 0 }}>
          {models && (
            <Select
              size="small"
              value={models.some(m => m.id === model) ? model : ''}
              onChange={(e) => setModel(e.target.value)}
              inputProps={{ 'aria-label': 'Model' }}
              renderValue={(id) => models.find(m => m.id === id)?.id || id}
              MenuProps={{ PaperProps: { sx: menuPaperSx } }}
              sx={selectSx}
            >
              {models.map(m => (
                <MenuItem key={m.id} value={m.id} sx={{ display: 'block', py: 0.75 }}>
                  <Typography sx={{ fontSize: '0.85rem' }}>
                    {m.id}{' '}
                    <Box component="span" sx={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>· {m.label}</Box>
                  </Typography>
                  {m.price_note && (
                    <Typography sx={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>{m.price_note}</Typography>
                  )}
                </MenuItem>
              ))}
            </Select>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title={voiceSupported ? 'Voice mode' : 'Voice mode needs microphone access in a modern browser'}>
            <span>
              <IconButton
                onClick={onVoice}
                disabled={!voiceSupported || disabled}
                aria-label="Voice mode"
                sx={{
                  ...roundButtonSx,
                  backgroundColor: hasText ? 'var(--bg-tertiary)' : 'var(--accent)',
                  color: hasText ? 'var(--text-secondary)' : '#fff',
                  '&:hover': { backgroundColor: hasText ? 'var(--bg-tertiary)' : 'var(--accent-hover)' },
                  '&.Mui-disabled': { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' },
                }}
              >
                <GraphicEqIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
          <IconButton
            type="submit"
            disabled={disabled || !hasText}
            aria-label="Send"
            sx={{
              ...roundButtonSx,
              backgroundColor: hasText ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: hasText ? '#fff' : 'var(--text-muted)',
              '&:hover': { backgroundColor: hasText ? 'var(--accent-hover)' : 'var(--bg-tertiary)' },
              '&.Mui-disabled': { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' },
            }}
          >
            <SendIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      </Box>
    </form>
  );
}

export default MessageInput;
