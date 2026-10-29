import { useRef } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import { ALL } from '../data/schema.js';
import { SOURCES } from '../data/dataService.js';

const MAX_SHOWN = 4;

/** Multi-select filter; an empty selection means all values. */
function FilterSelect({ id, label, value, options, onChange, disabled }) {
  return (
    <FormControl size="small" sx={{ minWidth: 200, maxWidth: { sm: 320 } }} disabled={disabled}>
      <InputLabel id={`${id}-label`} shrink>
        {label}
      </InputLabel>
      <Select
        multiple
        displayEmpty
        notched
        labelId={`${id}-label`}
        id={id}
        label={label}
        value={value}
        // Picking "(All)" clears the selection.
        onChange={(e) => onChange(e.target.value.includes(ALL) ? [] : [...e.target.value].sort())}
        renderValue={(selected) =>
          !selected.length
            ? ALL
            : selected.length > MAX_SHOWN
              ? `${selected.slice(0, MAX_SHOWN).join(', ')} +${selected.length - MAX_SHOWN}`
              : selected.join(', ')
        }
        MenuProps={{ slotProps: { paper: { sx: { maxHeight: 360 } } } }}
      >
        <MenuItem value={ALL} dense>
          <Checkbox size="small" checked={!value.length} sx={{ py: 0 }} />
          <ListItemText primary={ALL} />
        </MenuItem>
        {options.map((o) => (
          <MenuItem key={o} value={o} dense>
            <Checkbox size="small" checked={value.includes(o)} sx={{ py: 0 }} />
            <ListItemText primary={o} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

export default function ReportToolbar({
  filters,
  filterOptions,
  onFilterChange,
  source,
  onSourceChange,
  uploadedName,
  onUpload,
  onClearUpload,
  onRefresh,
  onExport,
  loading,
}) {
  const fileRef = useRef(null);

  return (
    <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { lg: 'center' } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <FilterSelect
          id="market"
          label="Market"
          value={filters.market}
          options={filterOptions.market}
          onChange={(v) => onFilterChange({ ...filters, market: v })}
          disabled={loading}
        />
        <FilterSelect
          id="programType"
          label="Program Type"
          value={filters.programType}
          options={filterOptions.programType}
          onChange={(v) => onFilterChange({ ...filters, programType: v })}
          disabled={loading}
        />
      </Stack>

      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ alignItems: 'center', flexWrap: 'wrap', minWidth: 0, '& .MuiButton-root': { whiteSpace: 'nowrap' } }}
      >
        {uploadedName ? (
          <Chip label={`CSV: ${uploadedName}`} onDelete={onClearUpload} color="secondary" variant="outlined" />
        ) : (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={source}
            onChange={(_, v) => v && onSourceChange(v)}
            aria-label="Data source"
          >
            {Object.entries(SOURCES).map(([key, label]) => (
              <ToggleButton key={key} value={key} sx={{ textTransform: 'none', px: { xs: 1, sm: 1.5 }, whiteSpace: 'nowrap' }}>
                {label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
        <Box>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = '';
            }}
          />
          <Button size="small" variant="outlined" startIcon={<UploadFileIcon />} onClick={() => fileRef.current?.click()}>
            Upload CSV
          </Button>
        </Box>
        <Tooltip title="Reload data">
          <span>
            <Button size="small" variant="text" startIcon={<RefreshIcon />} onClick={onRefresh} disabled={loading}>
              Refresh
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="Download the table as CSV">
          <span>
            <Button size="small" variant="text" startIcon={<DownloadIcon />} onClick={onExport} disabled={loading}>
              Export
            </Button>
          </span>
        </Tooltip>
      </Stack>
    </Stack>
  );
}
