import { useState } from 'react';
import { Box, Typography } from '@mui/material';

/**
 * Shows an official logo file from public/logos/<name>.svg (falls back to .png).
 * If neither file exists yet, shows the organisation name as plain text so the
 * layout still holds. Drop the approved logo files into public/logos to replace it.
 */
export default function BrandLogo({ name, label, height = 32, color = 'primary.main' }) {
  const candidates = [`logos/${name}.svg`, `logos/${name}.png`];
  const [index, setIndex] = useState(0);

  if (index >= candidates.length) {
    return (
      <Typography
        component="span"
        aria-label={`${label} logo placeholder`}
        sx={{ fontWeight: 700, fontSize: height * 0.7, lineHeight: `${height}px`, color, letterSpacing: 0.2 }}
      >
        {label}
      </Typography>
    );
  }

  return (
    <Box
      component="img"
      src={candidates[index]}
      alt={`${label} logo`}
      onError={() => setIndex((i) => i + 1)}
      sx={{ height, width: 'auto', display: 'block' }}
    />
  );
}
