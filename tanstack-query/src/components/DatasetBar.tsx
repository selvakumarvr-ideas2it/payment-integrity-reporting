'use client';

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
import type { DatasetRecord } from '@/model';
import { describeFilters, fromFilterList } from '@/lib/filters';
import { brand } from '@/theme';

export default function DatasetBar({
  datasets,
  selected,
  dirty,
  hasFilters,
  disabled,
  onSelect,
  onSaveNew,
  onUpdate,
  onRename,
  onDelete,
}: {
  datasets: DatasetRecord[];
  selected: DatasetRecord | null;
  dirty: boolean;
  hasFilters: boolean;
  disabled: boolean;
  onSelect: (id: number | null) => void;
  onSaveNew: () => void;
  onUpdate: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mine = datasets.filter((item) => item.isOwner);
  const shared = datasets.filter((item) => !item.isOwner);

  const item = (entry: DatasetRecord) => (
    <MenuItem key={entry.id} value={entry.id}>
      {entry.name}
      {!entry.isOwner && (
        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          by {entry.owner.displayName}
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
            onChange={(event) => {
              const value = String(event.target.value);
              onSelect(value === '' ? null : Number(value));
            }}
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
          ? `${selected.description ? `${selected.description} · ` : ''}${describeFilters(fromFilterList(selected.filters))}`
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
