import { useState } from 'react';
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  ListSubheader,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { brand } from '../theme.js';

const LABELS = { market: 'Market', programType: 'Program Type' };

/** "Market: AZ, TX · Program Type: CPI" for a { market: [], programType: [] } filter object. */
export function describeFilters(filters) {
  const parts = Object.entries(filters)
    .filter(([, v]) => v?.length)
    .map(([k, v]) => `${LABELS[k] || k}: ${v.join(', ')}`);
  return parts.length ? parts.join(' · ') : 'All data (no filters)';
}

/** Saved dataset picker plus save / update / rename / delete actions. */
export default function DatasetBar({ datasets, selected, dirty, hasFilters, disabled, onSelect, onSaveNew, onUpdate, onRename, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mine = datasets.filter((d) => d.isOwner);
  const shared = datasets.filter((d) => !d.isOwner);

  const item = (d) => (
    <MenuItem key={d.id} value={d.id}>
      {d.name}
      {!d.isOwner && (
        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          by {d.owner.displayName}
        </Typography>
      )}
    </MenuItem>
  );

  return (
    <Stack spacing={0.5} sx={{ mb: 2.5, pb: 2.5, borderBottom: `1px solid ${brand.border}` }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: { sm: 'center' } }}>
        <FormControl size="small" sx={{ minWidth: 260 }} disabled={disabled}>
          <InputLabel id="dataset-label" shrink>
            Saved dataset
          </InputLabel>
          <Select
            labelId="dataset-label"
            id="dataset"
            label="Saved dataset"
            notched
            displayEmpty
            value={selected?.id ?? ''}
            onChange={(e) => onSelect(e.target.value === '' ? null : Number(e.target.value))}
          >
            <MenuItem value="">
              <em>None (choose filters below)</em>
            </MenuItem>
            {mine.length > 0 && <ListSubheader>My datasets</ListSubheader>}
            {mine.map(item)}
            {shared.length > 0 && <ListSubheader>Public datasets</ListSubheader>}
            {shared.map(item)}
          </Select>
        </FormControl>

        {selected && dirty && <Chip label="Modified" size="small" color="warning" variant="outlined" />}

        {selected && dirty && selected.isOwner && (
          <Button size="small" variant="contained" startIcon={<SaveOutlinedIcon />} onClick={onUpdate} disabled={disabled || !hasFilters}>
            Update “{selected.name}”
          </Button>
        )}
        {((selected && dirty) || (!selected && hasFilters)) && (
          <Button size="small" variant={selected ? 'outlined' : 'contained'} startIcon={<SaveOutlinedIcon />} onClick={onSaveNew} disabled={disabled}>
            {selected ? 'Save as new' : 'Save as dataset'}
          </Button>
        )}
        {selected?.isOwner && !dirty && (
          <>
            <Tooltip title="Rename">
              <IconButton size="small" onClick={onRename} disabled={disabled} aria-label={`Rename ${selected.name}`}>
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton size="small" onClick={() => setConfirmDelete(true)} disabled={disabled} aria-label={`Delete ${selected.name}`}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {selected
          ? `${selected.description ? `${selected.description} · ` : ''}${describeFilters(Object.fromEntries(selected.filters.map((f) => [f.attributeKey, f.values])))}`
          : datasets.length
            ? 'Pick a saved dataset, or choose filters and save them as a dataset.'
            : 'Choose filters below and save them as a dataset to reuse later.'}
      </Typography>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Delete dataset?</DialogTitle>
        <DialogContent>
          <DialogContentText>“{selected?.name}” will be deleted. The current filters stay on screen.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              setConfirmDelete(false);
              onDelete();
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
