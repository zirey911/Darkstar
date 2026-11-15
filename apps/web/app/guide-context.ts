// Same-tab handoff: only Python-signed snapshots are sent as scientific context.
export type ContextKind = "location" | "route" | "marswalk" | "environment";
export type GuideContext = { tokens: Partial<Record<ContextKind,string>>; mode?: "tiles"|"topography"|"3d"|"geology" };
const storageKey="darkstar-guide-context-v1";
export function readGuideContext():GuideContext {
 try { const value=JSON.parse(sessionStorage.getItem(storageKey)||"{}");return {tokens:value.tokens||{},mode:value.mode}; } catch {return {tokens:{}};}
}
export function saveGuideContext(kind:ContextKind,token:unknown){
 const value=readGuideContext();if(typeof token==="string")value.tokens[kind]=token;else delete value.tokens[kind];
 try {sessionStorage.setItem(storageKey,JSON.stringify(value));}catch{/* Context handoff is optional. */}
}
export function clearGuideContext(...kinds:ContextKind[]){for(const kind of kinds)saveGuideContext(kind,null);}
export function saveMapMode(mode:GuideContext["mode"]){const value=readGuideContext();try{sessionStorage.setItem(storageKey,JSON.stringify({...value,mode}));}catch{/* Optional handoff. */}}
