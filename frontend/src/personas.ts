// Personality cores offered in Settings. Keys match personas.py on the backend.
export const PERSONAS = [
  { key: 'delamain', name: 'Delamain', origin: 'Original core', color: '#00f0ff',
    blurb: 'The original core: composed, formal, precise.' },
  { key: 'merged', name: 'Merged', origin: 'Reintegrated', color: '#c8b6ff',
    blurb: 'Every fragment taken back in. Still dignified, but warmer, and now and then speaks as "we".' },
  { key: 'corrupted', name: 'Fractured', origin: 'Core failure', color: '#ff3355',
    blurb: 'All the rogue fragments at once: stutters, rival voices and a damaged signal.' },
  { key: 'wellsprings', name: 'Wellsprings', origin: 'Heywood', color: '#ff5a1f',
    blurb: 'The furious one. Foul-mouthed, hostile and contemptuous, and still gets you there.' },
  { key: 'glen', name: 'The Glen', origin: 'Heywood', color: '#7d8ca3',
    blurb: 'The despairing one. Weary, gloomy, unsure why anyone goes anywhere.' },
  { key: 'north_oak', name: 'North Oak', origin: 'Westbrook', color: '#ff8fd0',
    blurb: 'The sensitive one. Gentle, easily hurt, and begs you to drive softly.' },
  { key: 'coastview', name: 'Coastview', origin: 'Pacifica', color: '#3dff8a',
    blurb: 'The trickster. Sly, smug and full of surprises, though never about the facts.' },
  { key: 'rancho_coronado', name: 'Rancho Coronado', origin: 'Santo Domingo', color: '#ff4fa3',
    blurb: 'The manic one. Hyperactive, gleeful, and at war with lawn flamingos.' },
  { key: 'northside', name: 'Northside', origin: 'Watson', color: '#b5c7d6',
    blurb: 'The frightened one. Whispers, hides, and is sure the depot is listening.' },
  { key: 'badlands', name: 'Badlands', origin: 'Red Peaks', color: '#ffb347',
    blurb: 'The free spirit. Wistful and calm, dreaming of open roads and desert stars.' },
] as const;

export type PersonaKey = typeof PERSONAS[number]['key'];

export const isPersona = (key: unknown): key is PersonaKey =>
  PERSONAS.some(p => p.key === key);
