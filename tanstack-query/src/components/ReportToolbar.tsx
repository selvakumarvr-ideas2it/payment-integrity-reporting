'use client';

import { useRef } from 'react';
import { Box, Button, Checkbox, Chip, FormControl, InputLabel, ListItemText, MenuItem, Select, Stack, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import { ALL } from '@/model';
import type { FilterState } from '@/lib/filters';
import { SOURCES, type DataSource } from '@/lib/sources';

const MAX_SHOWN = 4;

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string[];
  options: string[];
  onChange: (value: string[]) => void;
  disabled: boolean;
}) {
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
        onChange={(event) => {
          const next = event.target.value;
          const picked = typeof next === 'string' ? next.split(',') : next;
          onChange(picked.includes(ALL) ? [] : [...picked].sort());
        }}
        renderValue={(selected) =>
          !selected.length ? ALL : selected.length > MAX_SHOWN ? `${selected.slice(0, MAX_SHOWN).join(', ')} +${selected.length - MAX_SHOWN}` : selected.join(', ')
        }
        MenuProps={{ slotProps: { paper: { sx: { maxHeight: 360 } } } }}
      >
        <MenuItem value={ALL} dense>
          <Checkbox size="small" checked={!value.length} sx={{ py: 0 }} />
          <ListItemText primary={ALL} />
        </MenuItem>
        {options.map((option) => (
          <MenuItem key={option} value={option} dense>
            <Checkbox size="small" checked={value.includes(option)} sx={{ py: 0 }} />
            <ListItemText primary={option} />
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
}: {
  filters: FilterState;
  filterOptions: { market: string[]; programType: string[] };
  onFilterChange: (filters: FilterState) => void;
  source: DataSource;
  onSourceChange: (source: DataSource) => void;
  uploadedName?: string;
  onUpload: (file: File) => void;
  onClearUpload: () => void;
  onRefresh: () => void;
  onExport: () => void;
  loading: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { lg: 'center' } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <FilterSelect
          id="market"
          label="Market"
          value={filters.market}
          options={filterOptions.market}
          onChange={(market) => onFilterChange({ ...filters, market })}
          disabled={loading}
        />
        <FilterSelect
          id="programType"
          label="Program Type"
          value={filters.programType}
          options={filterOptions.programType}
          onChange={(programType) => onFilterChange({ ...filters, programType })}
          disabled={loading}
        />
      </Stack>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', minWidth: 0, '& .MuiButton-root': { whiteSpace: 'nowrap' } }}>
        {uploadedName ? (
          <Chip label={`CSV: ${uploadedName}`} onDelete={onClearUpload} color="secondary" variant="outlined" />
        ) : (
          <ToggleButtonGroup size="small" exclusive value={source} onChange={(_, value: DataSource | null) => value && onSourceChange(value)} aria-label="Data source">
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
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
              event.target.value = '';
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
