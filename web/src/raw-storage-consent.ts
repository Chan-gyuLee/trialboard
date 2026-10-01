export const collectors=['REGISTRY','LITERATURE','REGULATORY'] as const;
export type Collector=typeof collectors[number];
export type RawStoragePermission={collector:Collector;original_storage:'ALLOW';evidence_reference:string;reason:string};
export type RawStorageDraft={selected:boolean;evidence_reference:string;reason:string};
export type RawStorageDrafts=Record<Collector,RawStorageDraft>;
export const emptyRawStorageDrafts=():RawStorageDrafts=>Object.fromEntries(collectors.map(c=>[c,{selected:false,evidence_reference:'',reason:''}])) as RawStorageDrafts;
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&Array.from(v).length<=max&&!/[\uD800-\uDFFF]/u.test(v);
export function readRawStoragePermissions(value:unknown):RawStoragePermission[]{
 if(!Array.isArray(value)||value.length>3)throw Error('수집 원본 저장 허가 형식이 올바르지 않습니다.');
 const seen=new Set<string>();return value.map(p=>{
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='collector,evidence_reference,original_storage,reason'||!collectors.includes(p.collector)||seen.has(p.collector)||p.original_storage!=='ALLOW'||!text(p.evidence_reference,2000)||!text(p.reason,4000))throw Error('수집할 자료별 저장 허가 근거와 사유를 확인하세요.');
  seen.add(p.collector);return {...p,evidence_reference:p.evidence_reference.trim(),reason:p.reason.trim()};
 });
}
export function permissionsFromDrafts(drafts:RawStorageDrafts):RawStoragePermission[]{
 return readRawStoragePermissions(collectors.filter(c=>drafts[c].selected).map(c=>({collector:c,original_storage:'ALLOW',evidence_reference:drafts[c].evidence_reference,reason:drafts[c].reason})));
}
