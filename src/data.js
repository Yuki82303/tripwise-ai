/** @typedef {'beach'|'nature'|'city'|'food'|'warm'|'budget'} Preference */

export const ORIGINS = [
  { id: 'new-york', name: 'New York, NY', lat: 40.7128, lon: -74.006 },
  { id: 'boston', name: 'Boston, MA', lat: 42.3601, lon: -71.0589 },
  { id: 'chicago', name: 'Chicago, IL', lat: 41.8781, lon: -87.6298 },
  { id: 'los-angeles', name: 'Los Angeles, CA', lat: 34.0522, lon: -118.2437 },
  { id: 'san-francisco', name: 'San Francisco, CA', lat: 37.7749, lon: -122.4194 },
  { id: 'seattle', name: 'Seattle, WA', lat: 47.6062, lon: -122.3321 }
];

const commons = (file) => ({
  url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=960`,
  source: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replaceAll(' ', '_'))}`
});

// Each entry was checked against its individual Wikimedia Commons file page.
// Local copies are optional: the browser tries /assets first, then Commons,
// then the existing illustrated fallback. See 图片版权与来源清单.md.
const NEW_PHOTOS = {
  'philadelphia': ['Philadelphia skyline 1.jpg', 'Haimbd', 'Philadelphia skyline'],
  'washington-dc': ['NationalMall.jpg', 'Duane Lempke', 'National Mall and US Capitol'],
  'boston': ['Boston-skyline.jpg', 'Joe Valentine', 'Boston skyline from the harbor'],
  'providence': ['Providence skyline.jpg', 'US Department of Justice', 'Downtown Providence skyline'],
  'baltimore': ['Baltimore Inner Harbor, at Night.jpg', 'Northern-Virginia-Photographer', 'Baltimore Inner Harbor at night'],
  'hudson-valley': ['Hudson Valley Rail Trail - Vineyard bridge, late spring.jpg', 'Gyrobo', 'Hudson Valley Rail Trail bridge'],
  'new-haven': ['Old Campus Courtyard and Durfee Hall, Yale University, New Haven, 2007.jpg', 'DimiTalen', 'Yale Old Campus in New Haven'],
  'atlantic-city': ['Atlantic-city-boardwalk-1376851506eVP.jpg', 'Tim Emerich', 'Atlantic City Boardwalk'],
  'pittsburgh': ['Pittsburgh Skyline from Mount Washington, 2015-09-30, 01 nr.jpg', 'Cbaile19', 'Pittsburgh skyline from Mount Washington'],
  'richmond': ['Richmond Skyline from Shockoe.jpg', 'JuxtaposedJacob', 'Richmond skyline from Shockoe'],
  'nashville': ['Nashvilleskyline.jpg', 'Ryan Kaldari', 'Nashville skyline at dusk'],
  'milwaukee': ['Skyline of Milwaukee view from West.jpg', 'XanderJanowski', 'Milwaukee skyline from the west']
};

export const CURATED_PHOTOS = Object.fromEntries(Object.entries(NEW_PHOTOS).map(([id, [file, credit, subject]]) => [id, {
  ...commons(file), file, localUrl: `/assets/destinations/${id}.jpg`, credit,
  license: id === 'providence' ? 'Public domain (US federal work)' : 'CC0 1.0',
  licenseUrl: id === 'providence' ? null : 'https://creativecommons.org/publicdomain/zero/1.0/',
  subject
}]));

/**
 * Curated destination characteristics are editorial demo assumptions, not live travel facts.
 * Photos are linked to their individual Wikimedia Commons source and license below.
 */
const ORIGINAL_DESTINATIONS = [
  {
    id: 'miami', city: 'Miami', state: 'FL', region: 'Atlantic coast', lat: 25.7617, lon: -80.1918,
    tagline: 'Sun-soaked shores, art deco streets, and late dinners.',
    tags: ['beach', 'city', 'food', 'warm'], highlights: ['South Beach', 'Art Deco', 'Latin flavors'],
    nightly: 177, daily: 82, carFree: 73, shortTrip: 77, idealDays: [3, 5], bestMonths: [1, 2, 3, 4, 11, 12],
    photo: { ...commons('Gfp-florida-miami-beachwalk.jpg'), credit: 'Yinan Chen (Gfp)', license: 'Public domain', subject: 'Miami Beach walk' }
  },
  {
    id: 'san-diego', city: 'San Diego', state: 'CA', region: 'Pacific coast', lat: 32.7157, lon: -117.1611,
    tagline: 'A slower coastal rhythm with beaches and easy sunshine.',
    tags: ['beach', 'nature', 'food', 'warm'], highlights: ['Mission Beach', 'Coastal paths', 'Tacos'],
    nightly: 166, daily: 72, carFree: 62, shortTrip: 83, idealDays: [3, 5], bestMonths: [3, 4, 5, 6, 9, 10],
    photo: { ...commons('Mission Beach-San Diego-California.jpg'), credit: 'Vlastula', license: 'Public domain', subject: 'Mission Beach' }
  },
  {
    id: 'new-orleans', city: 'New Orleans', state: 'LA', region: 'The Gulf South', lat: 29.9511, lon: -90.0715,
    tagline: 'A colorful weekend made for music, food, and wandering.',
    tags: ['city', 'food', 'warm'], highlights: ['French Quarter', 'Live music', 'Creole food'],
    nightly: 139, daily: 77, carFree: 89, shortTrip: 92, idealDays: [2, 4], bestMonths: [2, 3, 4, 10, 11],
    photo: { ...commons('New Orleans French Quarter 1.jpg'), credit: 'Aropasa', license: 'CC0 1.0', subject: 'French Quarter' }
  },
  {
    id: 'denver', city: 'Denver', state: 'CO', region: 'Rocky Mountain gateway', lat: 39.7392, lon: -104.9903,
    tagline: 'Mountain views meet a lively, walkable city core.',
    tags: ['nature', 'city', 'food'], highlights: ['Mountain views', 'Museums', 'Craft food'],
    nightly: 145, daily: 73, carFree: 70, shortTrip: 72, idealDays: [3, 5], bestMonths: [5, 6, 7, 8, 9, 10],
    photo: { ...commons('Downtown denver.jpg'), credit: 'Chachpond', license: 'CC0 1.0', subject: 'Denver skyline' }
  },
  {
    id: 'seattle', city: 'Seattle', state: 'WA', region: 'Pacific Northwest', lat: 47.6062, lon: -122.3321,
    tagline: 'Coffee, water views, and a city wrapped in evergreen.',
    tags: ['nature', 'city', 'food'], highlights: ['Waterfront', 'Coffee culture', 'Parks'],
    nightly: 177, daily: 82, carFree: 90, shortTrip: 82, idealDays: [3, 5], bestMonths: [5, 6, 7, 8, 9],
    photo: { ...commons('Seattle skyline from Space Needle on October 1 2017.jpg'), credit: 'Ron Clausen', license: 'CC0 1.0', subject: 'Seattle skyline' }
  },
  {
    id: 'san-francisco', city: 'San Francisco', state: 'CA', region: 'Northern California', lat: 37.7749, lon: -122.4194,
    tagline: 'Iconic streets, bay air, and neighborhoods worth exploring.',
    tags: ['city', 'food', 'nature'], highlights: ['Golden Gate', 'Neighborhoods', 'Bay views'],
    nightly: 195, daily: 91, carFree: 96, shortTrip: 85, idealDays: [3, 5], bestMonths: [4, 5, 6, 9, 10],
    photo: { ...commons('GoldenGateBridge.jpg'), credit: 'Peter Craig', license: 'Public domain', subject: 'Golden Gate Bridge' }
  },
  {
    id: 'las-vegas', city: 'Las Vegas', state: 'NV', region: 'Desert escape', lat: 36.1699, lon: -115.1398,
    tagline: 'Big energy, desert light, and a surprisingly flexible budget.',
    tags: ['city', 'food', 'warm', 'budget'], highlights: ['The Strip', 'Shows', 'Desert light'],
    nightly: 119, daily: 86, carFree: 75, shortTrip: 95, idealDays: [2, 4], bestMonths: [2, 3, 4, 10, 11],
    photo: { ...commons('The StripLas Vegas Strip.jpg'), credit: 'Daniel Lobo', license: 'CC0 1.0', subject: 'Las Vegas Strip' }
  },
  {
    id: 'chicago', city: 'Chicago', state: 'IL', region: 'Great Lakes', lat: 41.8781, lon: -87.6298,
    tagline: 'Architecture, lakefront walks, and food worth flying for.',
    tags: ['city', 'food', 'budget'], highlights: ['Lakefront', 'Architecture', 'Deep-dish'],
    nightly: 147, daily: 70, carFree: 95, shortTrip: 88, idealDays: [2, 5], bestMonths: [5, 6, 7, 8, 9, 10],
    photo: { ...commons('Chicago Skyline Illinois.jpg'), credit: 'Gian Marco Leonardi', license: 'Public domain', subject: 'Chicago skyline' }
  },
  {
    id: 'new-york-city', city: 'New York City', state: 'NY', region: 'Northeast', lat: 40.7128, lon: -74.006,
    tagline: 'Endless neighborhoods, remarkable food, and no car needed.',
    tags: ['city', 'food'], highlights: ['Neighborhoods', 'Museums', 'Food scene'],
    nightly: 225, daily: 99, carFree: 100, shortTrip: 90, idealDays: [3, 6], bestMonths: [4, 5, 6, 9, 10, 11],
    photo: { ...commons('New York skyline viewed from Fort Greene Park, Oct 2017.jpg'), credit: 'Thomson200', license: 'CC0 1.0', subject: 'New York skyline' }
  },
  {
    id: 'portland-maine', city: 'Portland', state: 'ME', region: 'New England coast', lat: 43.6591, lon: -70.2568,
    tagline: 'Lighthouses, seafood, and a breezy small-city pace.',
    tags: ['beach', 'food', 'nature', 'budget'], highlights: ['Lighthouses', 'Seafood', 'Old Port'],
    nightly: 132, daily: 65, carFree: 72, shortTrip: 90, idealDays: [2, 4], bestMonths: [5, 6, 7, 8, 9, 10],
    photo: { ...commons('Portland Head lighthouse.jpg'), credit: 'Kimmann', license: 'CC0 1.0', subject: 'Portland Head Light' }
  },
  {
    id: 'savannah', city: 'Savannah', state: 'GA', region: 'Coastal Georgia', lat: 32.0809, lon: -81.0912,
    tagline: 'Shady squares, Southern food, and an unhurried weekend.',
    tags: ['city', 'food', 'warm', 'budget'], highlights: ['Historic squares', 'Southern food', 'Riverfront'],
    nightly: 130, daily: 68, carFree: 83, shortTrip: 93, idealDays: [2, 4], bestMonths: [3, 4, 5, 10, 11],
    photo: { ...commons('Forsyth Park.jpg'), credit: 'J. Miers / Jtesla16', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/', modified: 'Display crop', subject: 'Forsyth Park fountain' }
  },
  {
    id: 'asheville', city: 'Asheville', state: 'NC', region: 'Blue Ridge Mountains', lat: 35.5951, lon: -82.5515,
    tagline: 'Mountain trails and a creative town with plenty of character.',
    tags: ['nature', 'food', 'budget'], highlights: ['Blue Ridge', 'Trails', 'Local food'],
    nightly: 128, daily: 67, carFree: 39, shortTrip: 76, idealDays: [3, 5], bestMonths: [4, 5, 6, 9, 10, 11],
    photo: { ...commons('Blue Ridge Parkway BLRI9233.jpg'), credit: 'National Park Service', license: 'Public domain', subject: 'Blue Ridge Parkway region' }
  }
];

// Editorial demo profiles. New entries deliberately use an illustrated fallback
// instead of an unlicensed or incorrectly attributed destination photograph.
const EXTRA_PROFILES = [
  // id, city, state, region, lat, lon, types, nightly, daily, carFree, shortTrip, idealDays, bestMonths, highlights
  ['philadelphia','Philadelphia','PA','Northeast',39.9526,-75.1636,['city','food','budget'],145,64,92,94,[2,4],[3,4,5,6,9,10,11],['Historic core','Markets','Museums']],
  ['washington-dc','Washington','DC','Mid-Atlantic',38.9072,-77.0369,['city','food'],174,73,94,93,[2,5],[3,4,5,9,10,11],['Museums','Monuments','Neighborhoods']],
  ['boston','Boston','MA','New England',42.3601,-71.0589,['city','food'],187,76,95,90,[2,4],[4,5,6,9,10,11],['Historic walks','Harbor','Food halls']],
  ['providence','Providence','RI','New England',41.824,-71.4128,['city','food','budget'],139,61,83,89,[2,3],[4,5,6,9,10],['Arts district','Dining','Riverwalk']],
  ['baltimore','Baltimore','MD','Mid-Atlantic',39.2904,-76.6122,['city','food','budget'],137,64,77,88,[2,4],[4,5,6,9,10],['Harbor','Markets','Museums']],
  ['hudson-valley','Hudson Valley','NY','Northeast',42.2529,-73.7909,['nature','food'],158,69,43,84,[2,4],[4,5,6,9,10,11],['River scenery','Small towns','Trails']],
  ['new-haven','New Haven','CT','New England',41.3083,-72.9279,['city','food','budget'],128,57,81,87,[2,3],[4,5,6,9,10],['Pizza','Campus walks','Museums']],
  ['newport','Newport','RI','New England coast',41.4901,-71.3128,['beach','food','nature'],177,72,59,82,[2,4],[5,6,7,8,9,10],['Coastal walks','Harbor','Historic streets']],
  ['atlantic-city','Atlantic City','NJ','Mid-Atlantic coast',39.3643,-74.4229,['beach','city','budget'],124,67,76,82,[2,3],[5,6,7,8,9],['Boardwalk','Beach','Shows']],
  ['pittsburgh','Pittsburgh','PA','Mid-Atlantic',40.4406,-79.9959,['city','food','budget'],142,65,77,86,[2,4],[4,5,6,9,10],['River views','Museums','Food scene']],
  ['richmond','Richmond','VA','Southeast',37.5407,-77.436,['city','food','budget'],136,62,68,84,[2,4],[4,5,6,9,10],['Riverfront','Arts','Restaurants']],
  ['charleston','Charleston','SC','Southeast coast',32.7765,-79.9311,['city','food','warm'],187,83,74,84,[3,5],[3,4,5,9,10,11],['Historic core','Coast','Dining']],
  ['st-augustine','St. Augustine','FL','Atlantic coast',29.9012,-81.3124,['beach','city','warm'],156,73,55,79,[2,4],[2,3,4,5,10,11],['Old town','Coast','Architecture']],
  ['nashville','Nashville','TN','Southeast',36.1627,-86.7816,['city','food'],166,79,72,88,[2,4],[3,4,5,9,10,11],['Music','Dining','Neighborhoods']],
  ['minneapolis','Minneapolis','MN','Upper Midwest',44.9778,-93.265,['city','food','nature'],147,67,83,83,[2,4],[5,6,7,8,9],['Lakes','Museums','Food scene']],
  ['milwaukee','Milwaukee','WI','Great Lakes',43.0389,-87.9065,['city','food','budget'],127,61,79,86,[2,4],[5,6,7,8,9,10],['Lakefront','Markets','Museums']],
  ['madison','Madison','WI','Upper Midwest',43.0731,-89.4012,['city','nature','budget'],132,60,71,83,[2,4],[5,6,7,8,9,10],['Lakes','Campus','Markets']],
  ['detroit','Detroit','MI','Great Lakes',42.3314,-83.0458,['city','food','budget'],134,64,72,85,[2,4],[5,6,7,8,9,10],['Architecture','Museums','Dining']],
  ['cleveland','Cleveland','OH','Great Lakes',41.4993,-81.6944,['city','food','budget'],129,62,74,83,[2,4],[5,6,7,8,9,10],['Lakefront','Music','Markets']],
  ['columbus','Columbus','OH','Midwest',39.9612,-83.0007,['city','food','budget'],129,61,72,83,[2,4],[4,5,6,9,10],['Arts','Dining','Parks']],
  ['portland-oregon','Portland','OR','Pacific Northwest',45.5152,-122.6784,['city','food','nature'],158,71,87,83,[3,5],[5,6,7,8,9,10],['Food carts','Parks','Neighborhoods']],
  ['tacoma','Tacoma','WA','Pacific Northwest',47.2529,-122.4443,['city','nature','budget'],137,62,75,81,[2,4],[5,6,7,8,9],['Waterfront','Museums','Parks']],
  ['olympia','Olympia','WA','Pacific Northwest',47.0379,-122.9007,['nature','food','budget'],135,62,57,79,[2,4],[5,6,7,8,9],['Waterfront','Markets','Trails']],
  ['sacramento','Sacramento','CA','Northern California',38.5816,-121.4944,['city','food','budget'],143,67,74,82,[2,4],[3,4,5,9,10,11],['Old town','Riverfront','Dining']],
  ['santa-barbara','Santa Barbara','CA','Central coast',34.4208,-119.6982,['beach','food','warm'],198,84,57,82,[2,4],[3,4,5,6,9,10],['Coast','Dining','Parks']],
  ['long-beach','Long Beach','CA','Pacific coast',33.7701,-118.1937,['beach','city','food'],161,74,76,83,[2,4],[4,5,6,7,8,9,10],['Waterfront','Arts','Dining']],
  ['palm-springs','Palm Springs','CA','Desert West',33.8303,-116.5453,['warm','nature','food'],171,82,39,78,[2,4],[1,2,3,4,10,11,12],['Desert scenery','Dining','Design']],
  ['salt-lake-city','Salt Lake City','UT','Mountain West',40.7608,-111.891,['city','nature','budget'],144,68,68,80,[2,4],[4,5,6,7,8,9,10],['Mountain views','Downtown','Parks']]
];

const extras = EXTRA_PROFILES.map(([id, city, state, region, lat, lon, tags, nightly, daily, carFree, shortTrip, idealDays, bestMonths, highlights]) => ({
  id, city, state, region, lat, lon, tags, nightly, daily, carFree, shortTrip, idealDays, bestMonths, highlights,
  tagline: `${highlights[0]}, ${highlights[1].toLowerCase()}, and a trip to make your own.`,
  photo: CURATED_PHOTOS[id] || null
}));

const CULTURE_IDS = new Set(['new-orleans','chicago','new-york-city','philadelphia','washington-dc','boston','providence','baltimore','richmond','charleston','pittsburgh','detroit','cleveland','san-francisco','seattle','portland-oregon','denver','savannah','nashville']);
const NIGHTLIFE_IDS = new Set(['new-orleans','chicago','new-york-city','miami','las-vegas','nashville','los-angeles','san-francisco','seattle']);
const STYLE_OVERRIDES = {
  'new-york-city': ['adventurous'], 'philadelphia': ['adventurous'], 'washington-dc': ['adventurous'],
  'savannah': ['relaxing','romantic'], 'charleston': ['relaxing','romantic'],
  'portland-maine': ['relaxing','quiet','less_touristy'], 'providence': ['quiet','less_touristy'],
  'hudson-valley': ['quiet','romantic','less_touristy'], 'newport': ['relaxing','romantic'],
  'asheville': ['adventurous','quiet'], 'santa-barbara': ['relaxing','romantic'],
  'tacoma': ['quiet','less_touristy'], 'olympia': ['quiet','less_touristy']
};

export const DESTINATIONS = [...ORIGINAL_DESTINATIONS, ...extras].map((destination) => ({
  ...destination,
  photo: destination.photo ? { ...destination.photo, localUrl: `/assets/destinations/${destination.id}.jpg` } : null,
  tags: [...destination.tags, ...(CULTURE_IDS.has(destination.id) ? ['culture'] : []), ...(NIGHTLIFE_IDS.has(destination.id) ? ['nightlife'] : [])],
  styles: STYLE_OVERRIDES[destination.id] || (destination.tags.includes('nature') ? ['adventurous'] : destination.tags.includes('beach') ? ['relaxing'] : ['adventurous'])
}));

// Official route pages establish corridor service, not a bookable itinerary,
// a direct train, a departure on the selected date, travel time, or fare.
export const RAIL_CORRIDORS = [
  { ids: ['new-york','boston','new-york-city','philadelphia','washington-dc','providence','baltimore','new-haven','richmond'], source: 'https://www.amtrak.com/northeast-regional-train' },
  { ids: ['boston','portland-maine'], source: 'https://www.amtrak.com/downeaster-train' },
  { ids: ['seattle','tacoma','olympia','portland-oregon'], source: 'https://www.amtrak.com/cascades-train' },
  { ids: ['chicago','milwaukee'], source: 'https://www.amtrak.com/hiawatha-train' },
  { ids: ['los-angeles','san-diego','santa-barbara'], source: 'https://www.amtrak.com/pacific-surfliner-train' },
  { ids: ['los-angeles','long-beach'], source: 'https://cdn.beta.metro.net/wp-content/uploads/2025/12/12151356/801_TT_12-14-25.pdf' }
];

export const PREFERENCE_LABELS = {
  beach: 'Beach days', nature: 'Nature', city: 'City energy', food: 'Great food', culture: 'Culture', nightlife: 'Nightlife', warm: 'Warm weather', budget: 'Low-key budget'
};

export const STYLE_LABELS = { relaxing: 'Relaxing', adventurous: 'Adventurous', romantic: 'Romantic', quiet: 'Quiet', less_touristy: 'Less touristy' };
export const SOFT_LABELS = { warm_weather: 'Prefer warm weather', walking: 'Prefer walking', direct_flights: 'Prefer direct flights' };
export const SPENDING_LABELS = { accommodation: 'Accommodation', food: 'Food', experiences: 'Experiences', transportation: 'Transportation' };
