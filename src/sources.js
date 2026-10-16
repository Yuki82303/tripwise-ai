export const SOURCE_TYPES = Object.freeze({
  official: { label: 'Official source', description: 'Published by a public agency or route operator; scope is limited to the linked fact.' },
  public: { label: 'Public source', description: 'A linked public file or page with its own reuse terms.' },
  curated: { label: 'Curated profile', description: 'TripWise editorial demo data; not independently verified.' },
  modeled: { label: 'Modeled estimate', description: 'Calculated planning assumption, never a live booking quote.' },
  live: { label: 'Live Price', description: 'A source-linked flight or hotel quote returned by a user-triggered SerpApi search; availability can change.' },
  cached: { label: 'Cached Price', description: 'Previously returned source-linked quote kept locally for up to six hours.' },
  community: { label: 'Curated community voice', description: 'Short, manually entered source-linked excerpt; not independently verified.' },
  search: { label: 'Public search preview', description: 'A source-linked search result title and snippet, not a verified quotation from the full post.' },
  provisional: { label: 'Provisional', description: 'The necessary route or local access evidence is incomplete.' }
});

export function destinationEvidence(item) {
  const records = [
    { type: 'curated', label: 'Highlights, season & no-car score', detail: 'Undated TripWise editorial demo profile' },
    { type: 'modeled', label: 'Group budget & distance burden', detail: 'Calculated for this search; no live fare or room availability' },
    item.cost.routeKnown
      ? { type: 'official', label: 'Rail corridor', detail: 'Operator page confirms corridor only; timetable, fare and transfers unverified', url: item.cost.routeSource }
      : { type: 'provisional', label: 'Travel route', detail: 'Modeled candidate; date-specific route, time and fare unverified' }
  ];
  if (item.photo) records.push({ type: 'public', label: 'Destination photo', detail: `${item.photo.credit} · ${item.photo.license}`, url: item.photo.source });
  return records;
}
