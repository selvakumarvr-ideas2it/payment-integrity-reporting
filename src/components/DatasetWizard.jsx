import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { FilterSelect } from './ReportToolbar.jsx';
import {
  applyPopularSelection,
  applySixMonthRunout,
  describePeriods,
  emptyPeriods,
  generateDatasetName,
  POPULAR_SELECTIONS,
} from '../data/datasetPeriods.js';
import { describeFilters } from './DatasetBar.jsx';
import { brand } from '../theme.js';

const STEPS = ['Time Periods', 'Population & Norms', 'Description', 'Filter', 'Assign Groups', 'Save', 'Submit'];

function DateRange({ label, value, onChange, hint, extra }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 160 }}>
          {label}
        </Typography>
        {extra}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TextField
          type="date"
          size="small"
          value={value.start}
          onChange={(e) => onChange({ ...value, start: e.target.value })}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Typography color="text.secondary">–</Typography>
        <TextField
          type="date"
          size="small"
          value={value.end}
          onChange={(e) => onChange({ ...value, end: e.target.value })}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Stack>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Box>
  );
}

function PeriodColumn({ title, bucket, onChange, showContinuous, continuous, onContinuous, hideContinuous }) {
  return (
    <Box sx={{ flex: 1, minWidth: 280 }}>
      <Typography variant="h3" sx={{ mb: 2, fontSize: 16 }}>
        {title}
      </Typography>
      <DateRange label="Service Dates" value={bucket.service} onChange={(service) => onChange({ ...bucket, service })} />
      <DateRange
        label="Payment Dates"
        value={bucket.payment}
        onChange={(payment) => onChange({ ...bucket, payment })}
        extra={
          <Link
            component="button"
            type="button"
            variant="caption"
            onClick={() => onChange(applySixMonthRunout(bucket))}
            sx={{ whiteSpace: 'nowrap' }}
          >
            6 Month Runout
          </Link>
        }
      />
      <DateRange label="Enrollment Dates" value={bucket.enrollment} onChange={(enrollment) => onChange({ ...bucket, enrollment })} />
      {showContinuous && !hideContinuous && (
        <DateRange
          label="Continuously Enrolled Dates"
          value={continuous}
          onChange={onContinuous}
          hint="Not a date field. Use for attribute only"
        />
      )}
    </Box>
  );
}

export default function DatasetWizard({
  open,
  mode = 'create',
  customerName,
  initial,
  filterOptions,
  initialFilters,
  onSubmit,
  onClose,
}) {
  const [step, setStep] = useState(0);
  const [periods, setPeriods] = useState(emptyPeriods());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [filters, setFilters] = useState({ market: [], programType: [] });
  const [optionTab, setOptionTab] = useState('current');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState(null);

  useEffect(() => {
    if (!open) return;
    const next = initial?.periods ? { ...emptyPeriods(), ...initial.periods } : applyPopularSelection('2025-full');
    setPeriods(next);
    setName(initial?.name || generateDatasetName(next));
    setDescription(initial?.description || '');
    setFilters(initialFilters || { market: [], programType: [] });
    setStep(0);
    setOptionTab('current');
    setError('');
    setBusy(false);
    setSavedId(initial?.id || null);
    // Hydrate only when the dialog opens so Save does not reset the wizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [open]);

  const autoName = useMemo(() => generateDatasetName(periods), [periods]);
  const summary = `${describePeriods(periods)} · ${describeFilters(filters)}`;

  const setBucket = (key, bucket) => setPeriods((p) => ({ ...p, [key]: bucket }));

  const persist = async (closeAfter) => {
    setBusy(true);
    setError('');
    try {
      const result = await onSubmit({
        id: savedId,
        name: name.trim() || autoName,
        description: description.trim(),
        periods,
        filters,
      });
      if (result?.id) setSavedId(result.id);
      if (closeAfter) onClose();
      return true;
    } catch (e) {
      setError(e.message || String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    if (step === 0 && !periods.current?.service?.start) {
      setError('Current period service dates are required.');
      return;
    }
    setError('');
    if (step === 2 && !name.trim() && autoName) setName(autoName);
    if (step === 5) {
      if (await persist(false)) setStep(6);
      return;
    }
    if (step === 6) {
      await persist(true);
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const hideContinuous = !periods.includeContinuouslyEnrolled;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="lg">
      <DialogTitle sx={{ pb: 1 }}>
        {mode === 'create' ? `New Dataset for ${customerName}` : `Edit Dataset for ${customerName}`}
      </DialogTitle>
      <DialogContent>
        <Stepper activeStep={step} alternativeLabel sx={{ mb: 3 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {step === 0 && (
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: 'flex-start' }}>
            <Box sx={{ flex: 2 }}>
              <Typography variant="h3" sx={{ mb: 1, fontSize: 16 }}>
                Time Periods
              </Typography>
              <FormControl size="small" sx={{ minWidth: 240, mb: 2 }}>
                <InputLabel>Popular Selections</InputLabel>
                <Select
                  label="Popular Selections"
                  value={periods.popularSelection || ''}
                  onChange={(e) => {
                    const next = applyPopularSelection(e.target.value);
                    setPeriods(next);
                    if (!initial?.name) setName(generateDatasetName(next));
                  }}
                >
                  {POPULAR_SELECTIONS.map((s) => (
                    <MenuItem key={s.id} value={s.id}>
                      {s.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4}>
                <PeriodColumn
                  title="Current Period"
                  bucket={periods.current}
                  onChange={(b) => setBucket('current', b)}
                  showContinuous
                  hideContinuous={hideContinuous}
                  continuous={periods.continuouslyEnrolled}
                  onContinuous={(continuouslyEnrolled) => setPeriods((p) => ({ ...p, continuouslyEnrolled }))}
                />
                {periods.included.prior && (
                  <PeriodColumn title="Prior Period" bucket={periods.prior} onChange={(b) => setBucket('prior', b)} />
                )}
                {periods.included.priorPrior && (
                  <PeriodColumn
                    title="Prior Prior Period"
                    bucket={periods.priorPrior}
                    onChange={(b) => setBucket('priorPrior', b)}
                  />
                )}
              </Stack>
            </Box>
            <Box sx={{ flex: 1, minWidth: 240, border: `1px solid ${brand.border}`, borderRadius: 1, p: 2 }}>
              <Typography variant="h3" sx={{ mb: 1, fontSize: 16 }}>
                Time Period Options
              </Typography>
              <Tabs
                value={optionTab}
                onChange={(_, v) => {
                  setOptionTab(v);
                  if (v === 'priorPrior') setPeriods((p) => ({ ...p, included: { ...p.included, priorPrior: true } }));
                  if (v === 'prior') setPeriods((p) => ({ ...p, included: { ...p.included, prior: true } }));
                }}
                sx={{ mb: 1 }}
              >
                <Tab value="current" label="Current" />
                <Tab value="prior" label="Prior" />
                <Tab value="priorPrior" label="Prior Prior" />
              </Tabs>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={periods.usePaidOnly}
                    onChange={(e) => setPeriods((p) => ({ ...p, usePaidOnly: e.target.checked }))}
                  />
                }
                label="Use Paid Only dates"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={!periods.includeContinuouslyEnrolled}
                    onChange={(e) => setPeriods((p) => ({ ...p, includeContinuouslyEnrolled: !e.target.checked }))}
                  />
                }
                label="Exit Continuous Enrolled Dates"
              />
            </Box>
          </Stack>
        )}

        {step === 1 && (
          <Stack spacing={1}>
            <Typography color="text.secondary">
              Population and norms flags from the HPM dataset. They do not change the Savings Invoice query yet.
            </Typography>
            <FormControlLabel
              control={<Checkbox checked={periods.isNorm} onChange={(e) => setPeriods((p) => ({ ...p, isNorm: e.target.checked }))} />}
              label="Norm dataset"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={periods.isDefaultTemplate}
                  onChange={(e) => setPeriods((p) => ({ ...p, isDefaultTemplate: e.target.checked }))}
                />
              }
              label="Default template"
            />
          </Stack>
        )}

        {step === 2 && (
          <Stack spacing={2} sx={{ maxWidth: 560 }}>
            <TextField
              label="Dataset name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              helperText={autoName && name !== autoName ? `Suggested from time periods: ${autoName}` : 'Generated from service and payment dates unless you change it.'}
              required
              fullWidth
            />
            <TextField
              label="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              multiline
              minRows={3}
              fullWidth
            />
          </Stack>
        )}

        {step === 3 && (
          <Stack spacing={2}>
            <Typography color="text.secondary">Optional. Leave as (All) to include every market and program type in the time period.</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FilterSelect
                id="wizard-market"
                label="Market"
                value={filters.market}
                options={filterOptions?.market || []}
                onChange={(market) => setFilters((f) => ({ ...f, market }))}
              />
              <FilterSelect
                id="wizard-programType"
                label="Program Type"
                value={filters.programType}
                options={filterOptions?.programType || []}
                onChange={(programType) => setFilters((f) => ({ ...f, programType }))}
              />
            </Stack>
          </Stack>
        )}

        {step === 4 && (
          <Typography color="text.secondary">
            Assign Groups is not used in this reporting app. Continue to save the dataset.
          </Typography>
        )}

        {(step === 5 || step === 6) && (
          <Stack spacing={1}>
            <Typography variant="h3" sx={{ fontSize: 16 }}>
              {name || autoName}
            </Typography>
            {description && <Typography color="text.secondary">{description}</Typography>}
            <Typography variant="body2">{summary}</Typography>
            {periods.isNorm && <Typography variant="body2">Norm dataset</Typography>}
            <Typography variant="body2" color="text.secondary">
              {step === 5 ? 'Save stores the dataset. Submit selects it on the report.' : 'Submit saves the dataset and applies it to the report.'}
            </Typography>
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={busy || step === 0}>
          Previous
        </Button>
        <Button variant="contained" onClick={next} disabled={busy}>
          {busy ? 'Saving…' : step === 5 ? 'Save' : step === 6 ? 'Submit' : 'Next'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
