import { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';

/**
 * Create or rename a dataset. onSubmit({ name, description }) may throw an Error with
 * `field: 'name'` (e.g. duplicate name), which is shown under the name box.
 */
export default function SaveDatasetDialog({ open, mode = 'create', initial, filterSummary, onSubmit, onClose }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState({ message: '', field: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name || '');
    setDescription(initial?.description || '');
    setError({ message: '', field: '' });
    setBusy(false);
  }, [open, initial]);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), description: description.trim() });
    } catch (err) {
      setError({ message: err.message, field: err.field || '' });
      setBusy(false);
    }
  }

  const nameError = error.field === 'name';
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" slotProps={{ paper: { component: 'form', onSubmit: handleSubmit } }}>
      <DialogTitle>{mode === 'create' ? 'Save filters as a dataset' : 'Rename dataset'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error.message && !nameError && <Alert severity="error">{error.message}</Alert>}
          <TextField
            label="Dataset name"
            placeholder="e.g. Arizona-CPI"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={nameError}
            helperText={nameError ? error.message : ' '}
            slotProps={{ htmlInput: { maxLength: 100 } }}
            autoFocus
            required
            fullWidth
          />
          <TextField
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 1000 } }}
            multiline
            minRows={2}
            fullWidth
          />
          {filterSummary && (
            <Typography variant="body2" color="text.secondary">
              Filters: {filterSummary}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
