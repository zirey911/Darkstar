// Gazetteer feature centres, not verified outcrop/sample locations. Checked 2026-11-15.
export const scienceDestinations = [
 {name:"Jezero Crater",lat:18.21,lon:77.62,feature:14300,
 description:"An ancient lake basin with a preserved river delta; a regional target for studying sediment transport and past environments.",
 objective:"Survey Jezero sedimentary landforms and document evidence of sediment transport; verify a local outcrop before EVA.",
 source:"https://www.jpl.nasa.gov/news/press_kits/mars_2020/download/mars_2020_launch_press_kit.pdf"},
 {name:"Neretva Vallis",lat:18.55,lon:77.20,feature:15879,
 description:"An ancient river channel that supplied water to Jezero. Coordinates are the USGS MDIM 2.1 feature centre, not Bright Angel or a sample site.",
 objective:"Document Neretva channel morphology and potential sedimentary exposures; verify local access before EVA.",
 source:"https://science.nasa.gov/resource/tracks-tell-tale-of-perseverances-crater-rim-climb/"},
 {name:"Gale Crater",lat:-5.37,lon:137.81,feature:2071,
 description:"Layered deposits record ancient lake, river and desert environments. This is the crater centre, not Curiosity's location.",
 objective:"Survey Gale layered terrain for evidence of changing depositional environments; verify a local outcrop before EVA.",
 source:"https://science.nasa.gov/resource/sedimentation-and-erosion-in-gale-crater-mars/"},
] as const;
