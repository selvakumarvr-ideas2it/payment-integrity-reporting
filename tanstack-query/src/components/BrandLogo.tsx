'use client';

import { useState } from 'react';
import { Box, Typography } from '@mui/material';

/** Official logo from public/logos, or the organisation name when the file is absent. */
export default function BrandLogo({
  name,
  label,
  height = 32,
  color = 'primary.main',
}: {
  name: string;
  label: string;
  height?: number;
  color?: string;
}) {
  const candidates = [`/logos/${name}.svg`, `/logos/${name}.png`];
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
      onError={() => setIndex((current) => current + 1)}
      sx={{ height, width: 'auto', display: 'block' }}
    />
  );
}
