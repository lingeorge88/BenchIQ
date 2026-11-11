import React from 'react';
import { Box, Dialog, IconButton, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import CallEndIcon from '@mui/icons-material/CallEnd';
import './VoiceMode.css';

const LABELS = {
  idle: 'Starting microphone…',
  listening: 'Listening…',
  transcribing: 'Transcribing…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
};

const roundButton = {
  width: 56,
  height: 56,
  border: '1px solid var(--border)',
  backgroundColor: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  '&:hover': { backgroundColor: 'var(--bg-secondary)' },
};

function VoiceMode({ voice }) {
  const { isOpen, phase, level, userCaption, assistantCaption, error, muted, close, interrupt, toggleMute } = voice;
  const label = muted && phase === 'listening' ? 'Mic muted' : LABELS[phase];
  const busy = phase === 'transcribing' || phase === 'thinking' || phase === 'speaking';
  const orbHint = busy ? 'Tap to interrupt' : 'Voice orb';
  const orbClass = phase === 'transcribing' ? 'thinking' : phase;
  const hint = muted
    ? 'Unmute to keep talking.'
    : phase === 'listening'
      ? 'Just start talking — I’ll answer when you pause.'
      : busy
        ? 'Tap the orb to interrupt.'
        : '';

  return (
    <Dialog
      fullScreen
      open={isOpen}
      onClose={close}
      aria-label="Voice mode"
      PaperProps={{
        sx: {
          backgroundColor: 'color-mix(in srgb, var(--bg-primary) 94%, transparent)',
          backdropFilter: 'blur(8px)',
          color: 'var(--text-primary)',
          backgroundImage: 'none',
        },
      }}
    >
      <Box sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        px: 2,
        pt: 'max(16px, env(safe-area-inset-top))',
        pb: 'max(24px, env(safe-area-inset-bottom))',
      }}>
        <Box sx={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography sx={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            BenchIQ voice
          </Typography>
          <Tooltip title="Close (Esc)">
            <IconButton onClick={close} aria-label="Close voice mode" sx={{ color: 'var(--text-secondary)' }}>
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, width: '100%' }}>
          <button
            type="button"
            className={`voice-orb ${orbClass}${muted ? ' muted' : ''}`}
            style={{ '--level': phase === 'listening' && !muted ? level : 0 }}
            onClick={interrupt}
            aria-label={orbHint}
            title={orbHint}
          />
          <Typography aria-live="polite" sx={{ fontSize: '1.1rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
            {label}
          </Typography>
          {hint && (
            <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.8rem', mt: -2 }}>{hint}</Typography>
          )}
          {error && (
            <Typography role="alert" sx={{ color: 'var(--error)', fontSize: '0.9rem', textAlign: 'center' }}>
              {error}
            </Typography>
          )}

          <Box sx={{ width: '100%', maxWidth: 560, minHeight: 120, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {userCaption && (
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.95rem', }}>
                “{userCaption}”
              </Typography>
            )}
            {assistantCaption && (phase === 'speaking' || phase === 'thinking') && (
              <Typography sx={{ color: 'var(--text-primary)', fontSize: '1.05rem', lineHeight: 1.5 }}>
                {assistantCaption}
              </Typography>
            )}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 3 }}>
          <Tooltip title={muted ? 'Unmute microphone' : 'Mute microphone'}>
            <IconButton onClick={toggleMute} aria-pressed={muted} aria-label="Toggle microphone" sx={roundButton}>
              {muted ? <MicOffIcon /> : <MicIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="End voice mode">
            <IconButton
              onClick={close}
              aria-label="End voice mode"
              sx={{ ...roundButton, backgroundColor: 'var(--error)', color: '#fff', border: 'none', '&:hover': { backgroundColor: 'var(--error)', filter: 'brightness(0.9)' } }}
            >
              <CallEndIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </Dialog>
  );
}

export default VoiceMode;
