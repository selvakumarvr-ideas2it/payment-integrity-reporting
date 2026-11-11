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
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { describePeriods } from '../data/datasetPeriods.js';
import { brand } from '../theme.js';

const LABELS = { market: 'Market', programType: 'Program Type' };

/** "Market: AZ, TX · Program Type: CPI" for a { market: [], programType: [] } filter object. */
export function describeFilters(filters) {
  const parts = Object.entries(filters || {})
    .filter(([k, v]) => v?.length && k !== 'monthFrom' && k !== 'monthTo')
    .map(([k, v]) => `${LABELS[k] || k}: ${v.join(', ')}`);
  return parts.length ? parts.join(' · ') : 'All markets and programs';
}

function datasetCaption(selected) {
  if (!selected) return '';
  const filters = Object.fromEntries((selected.filters || []).map((f) => [f.attributeKey, f.values]));
  const bits = [describePeriods(selected.periods), describeFilters(filters)];
  if (selected.description) bits.unshift(selected.description);
  return bits.filter(Boolean).join(' · ');
}

/** Saved dataset picker plus create / edit / delete, styled after HPM Explore. */
export default function DatasetBar({
  datasets,
  selected,
  dirty,
  disabled,
  onSelect,
  onCreate,
  onEdit,
  onUpdateFilters,
  onDelete,
}) {
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
    <Stack spacing={0.75} sx={{ mb: 2.5, pb: 2.5, borderBottom: `1px solid ${brand.border}` }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.25}
        useFlexGap
        sx={{
          alignItems: { xs: 'stretch', md: 'center' },
          flexWrap: { xs: 'nowrap', md: 'nowrap' },
        }}
      >
        <FormControl size="small" sx={{ width: { xs: '100%', md: 280 }, flexShrink: 0 }} disabled={disabled}>
          <InputLabel id="dataset-label" shrink>
            Select Dataset
          </InputLabel>
          <Select
            labelId="dataset-label"
            id="dataset"
            label="Select Dataset"
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

        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{
            alignItems: 'center',
            flexShrink: 0,
            flexWrap: 'nowrap',
            justifyContent: { xs: 'flex-start', md: 'flex-end' },
          }}
        >
          {selected && dirty && <Chip label="Modified" size="small" color="warning" variant="outlined" />}
          {selected && dirty && selected.isOwner && (
            <Button size="small" variant="outlined" onClick={onUpdateFilters} disabled={disabled} sx={{ whiteSpace: 'nowrap' }}>
              Update filters
            </Button>
          )}
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={onCreate} disabled={disabled} sx={{ whiteSpace: 'nowrap' }}>
            Create Dataset
          </Button>
          {selected?.isOwner && (
            <>
              <Tooltip title="Edit time periods">
                <IconButton size="small" onClick={onEdit} disabled={disabled} aria-label={`Edit ${selected.name}`}>
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
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {selected
          ? datasetCaption(selected)
          : datasets.length
            ? 'Pick a dataset, or create one to define service, payment and enrollment dates.'
            : 'Create a dataset to define the time periods used by this report.'}
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
