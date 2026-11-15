import type { Point } from "./terrain-geometry";
// Landing coordinates from NASA publications. EVA destinations are hypothetical,
// not verified sample sites, rover traverses, or actual astronaut habitats.
export type MissionExample = {id:string;name:string;start:Point;end:Point;objective:string;importance:string;source:string;scienceSource:string;coverage:string;zoom:number};
export const missionExamples: MissionExample[] = [
 {id:"jezero",name:"Jezero · Perseverance",start:{lat:18.4446,lon:77.4509},end:{lat:18.45,lon:77.46},zoom:12,
 objective:"Photograph local landforms near the Perseverance landing site; investigate possible sedimentary textures without assuming an outcrop exists at this planning point.",
 importance:"Jezero preserves evidence of an ancient lake and delta, motivating investigation of past environments.",
 source:"https://ntrs.nasa.gov/api/citations/20230016428/downloads/Bell%20et%20al%202022sciadv.pdf",
 scienceSource:"https://www.jpl.nasa.gov/news/press_kits/mars_2020/landing/mission/landing_site/",
 coverage:"Installed Jezero CTX 20 m coverage; actual support is checked when planning."},
 {id:"gale",name:"Gale · Curiosity",start:{lat:-4.5895,lon:137.4417},end:{lat:-4.59,lon:137.52},zoom:9,
 objective:"Plan a regional reconnaissance of Gale terrain to study depositional environments; confirm exposures and local access before any EVA.",
 importance:"Gale's deposits record changing lake, river and desert environments. A regional planning point is not a verified outcrop.",
 source:"https://ntrs.nasa.gov/api/citations/20130010129/downloads/20130010129.pdf",
 scienceSource:"https://science.nasa.gov/resource/sedimentation-and-erosion-in-gale-crater-mars/",
 coverage:"Coarse planning only: MOLA 0.0625° cells, about 3.7 km north–south. No installed detailed DEM."},
 {id:"insight",name:"Elysium Planitia · InSight",start:{lat:4.50238,lon:135.62343},end:{lat:4.5,lon:135.55},zoom:9,
 objective:"Plan a regional surface-context survey near InSight, motivated by its study of Mars' interior; no local subsurface properties are inferred.",
 importance:"InSight investigated Mars' interior through geophysical measurements. Surface terrain alone cannot identify subsurface structure.",
 source:"https://ntrs.nasa.gov/api/citations/20200003204/downloads/20200003204.pdf",
 scienceSource:"https://science.nasa.gov/mission/insight/",
 coverage:"Coarse planning only: MOLA 0.0625° cells, about 3.7 km north–south. No installed detailed DEM."},
];
