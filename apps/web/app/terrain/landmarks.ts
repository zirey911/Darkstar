// USGS Gazetteer mapped feature centers, planetocentric latitude / 0–360° east.
// Verified 2026-11-10. Feature pages also contain legacy coordinate-network entries.
// Zoom values are UI framing choices, not scientific measurements.
export const landmarks = [
  { name: "Olympus Mons", lat: 18.65, lon: 226.20, zoom: 4, feature: 4453 },
  { name: "Valles Marineris", lat: -14.01, lon: 301.41, zoom: 2, feature: 6288 },
  { name: "Jezero Crater", lat: 18.21, lon: 77.62, zoom: 7, feature: 14300 },
  { name: "Gale Crater", lat: -5.37, lon: 137.81, zoom: 5.5, feature: 2071 },
  { name: "Hellas Planitia", lat: -42.43, lon: 70.50, zoom: 2.4, feature: 2432 },
  { name: "Elysium Mons", lat: 25.02, lon: 147.21, zoom: 4.5, feature: 1783 },
  { name: "Utopia Planitia", lat: 46.74, lon: 117.52, zoom: 1.4, feature: 6260 },
] as const;
