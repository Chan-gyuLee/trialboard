import {Checkbox,FormControlLabel,TextField} from '@mui/material';
import {collectors,type Collector,type RawStorageDrafts} from './raw-storage-consent';
const labels:Record<Collector,string>={REGISTRY:'ClinicalTrials.gov 시험 등록 원본',LITERATURE:'Europe PMC / PubMed 논문 검색 원본',REGULATORY:'Drugs@FDA 규제 문서 목록 원본'};
export default function RawStorageConsent({value,onChange,disabled}:{value:RawStorageDrafts;onChange:(v:RawStorageDrafts)=>void;disabled:boolean}){
 return <fieldset className="saved-review-sources raw-storage-consent"><legend>조사 원본 저장 허가</legend><p>이용조건을 확인한 수집 경로만 선택하세요. 선택하지 않은 경로는 조사에서 제외합니다. 이 허가는 저장만 허용하며 검색·AI 전송·학습 허가로 확대되지 않습니다.</p>
  {collectors.map(c=><div key={c}><FormControlLabel control={<Checkbox checked={value[c].selected} disabled={disabled} onChange={e=>onChange({...value,[c]:{...value[c],selected:e.target.checked}})}/>} label={labels[c]}/>{value[c].selected&&<><TextField fullWidth label={`${labels[c]} 허가 근거`} disabled={disabled} value={value[c].evidence_reference} onChange={e=>onChange({...value,[c]:{...value[c],evidence_reference:e.target.value}})} slotProps={{htmlInput:{maxLength:2000}}}/><TextField fullWidth multiline minRows={2} label={`${labels[c]} 확인 사유`} disabled={disabled} value={value[c].reason} onChange={e=>onChange({...value,[c]:{...value[c],reason:e.target.value}})} slotProps={{htmlInput:{maxLength:4000}}}/></>}</div>)}
  <p>공개된 주소라는 이유만으로 이용 허가를 자동 판단하지 않습니다. 초기 시험 찾기는 별도의 공개 검색 동의로 실행되며, 여기의 허가는 그 검색 저장소에 적용되지 않습니다.</p>
 </fieldset>;
}
