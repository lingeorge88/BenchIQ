import React from 'react';
import { TextField, IconButton } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';

function MessageInput({ input, setInput, handleSend, disabled }) {
  return (
    <form onSubmit={handleSend} style={{ padding: '4px 0', display: 'flex', alignItems: 'center', width: '100%' }}>
      <TextField
        fullWidth
        variant="outlined"
        size="small"
        placeholder="Ask about analyzer procedures, maintenance, troubleshooting..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={disabled}
        sx={{
          marginRight: '8px',
          '& .MuiOutlinedInput-root': {
            borderRadius: '12px',
            backgroundColor: 'transparent',
            color: 'var(--text-primary)',
            fontSize: '0.9rem',
            '& fieldset': { border: 'none' },
          },
          '& .MuiInputBase-input::placeholder': { color: 'var(--text-muted)', opacity: 1 },
        }}
      />
      <IconButton
        type="submit"
        disabled={disabled || !input.trim()}
        sx={{
          backgroundColor: input.trim() ? 'var(--accent)' : 'var(--bg-tertiary)',
          color: input.trim() ? '#fff' : 'var(--text-muted)',
          width: 36, height: 36, borderRadius: '10px',
          '&:hover': { backgroundColor: input.trim() ? 'var(--accent-hover)' : 'var(--bg-tertiary)' },
          '&.Mui-disabled': { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' },
          transition: 'all 0.2s',
        }}
      >
        <SendIcon sx={{ fontSize: 18 }} />
      </IconButton>
    </form>
  );
}

export default MessageInput;
