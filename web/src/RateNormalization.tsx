import {useEffect,useState} from 'react';
import {Alert,Button,Checkbox,FormControlLabel,MenuItem,TextField} from '@mui/material';
import {normalizedRate} from './rate-normalization';
import {locate,type Value} from './field-review';
import type {PdfSource,PdfSpan} from './pdf-contract';

export default function RateNormalization({value,source,disabled,onChange,onChoose}:{value:Value;source:PdfSource;disabled:boolean;onChange:(value:Value)=>void;onChoose:(span:PdfSpan)=>void}){
 const [unit,setUnit]=useState(''),[estimate,setEstimate]=useState(false),[group,setGroup]=useState(false);
 const units=(value.supporting??[]).filter(c=>c.role==='unit');
 useEffect(()=>{setEstimate(false);setGroup(false);},[value.value,value.citation,unit]);
 const chosen=units.find(c=>c.spanId===unit);
 let preview:string|null=null,problem='';
 if(chosen){try{preview=normalizedRate({...value,normalization:{method:'adjacent-percent/1',display:(value.value??'')+'%',unitSpanId:chosen.spanId,pointEstimateAttested:true,sameGroupAttested:true}},source);}catch(e){problem=e instanceof Error?e.message:'원문 관계를 확인하세요.';}}
 const remove=()=>{const next={...value};delete next.normalization;onChange(next);setEstimate(false);setGroup(false);};
 return <section className="supporting-citations" aria-label="분리된 비율 단위 해석">
  <h4>숫자와 %가 따로 추출됐나요?</h4>
  <p>원문 숫자는 바꾸지 않고, 같은 줄 바로 오른쪽의 %를 별도 해석값으로 연결합니다. 표 머리글·각주 단위나 사건 수 역산은 지원하지 않습니다.</p>
  {value.normalization?<><Alert severity="info">원문 {value.value} + 별도 % → 사용자 해석 {value.normalization.display}. 확인 기록은 임상적 타당성·집단 연결의 인증이 아닙니다.</Alert><Button disabled={disabled} onClick={remove}>수치 해석 제거</Button></>:<>
   {!units.length?<Alert severity="info">위의 보조 근거에서 % 문구를 ‘단위’ 역할로 먼저 연결하세요.</Alert>:<TextField select fullWidth label="% 단위 근거" value={chosen?unit:''} disabled={disabled} onChange={e=>setUnit(e.target.value)}><MenuItem value="">선택하세요</MenuItem>{units.map(c=><MenuItem key={c.spanId} value={c.spanId}>{c.spanId} · {c.quote.slice(0,100)}</MenuItem>)}</TextField>}
   {chosen&&<Button disabled={disabled} onClick={()=>{const s=locate(source,chosen);if(s)onChoose(s);}}>단위 원문 위치 열기</Button>}
   {problem&&<Alert severity="warning">{problem}</Alert>}
   {preview&&<><Alert severity="info">원문 {value.value} + 원문 % → 해석값 {preview}. 원문 인용을 합치거나 수정하지 않습니다.</Alert>
    <FormControlLabel control={<Checkbox checked={estimate} disabled={disabled} onChange={e=>setEstimate(e.target.checked)}/>} label="이 숫자는 결과의 점추정치이며 신뢰수준·CI 경계·p값이 아님을 원문에서 확인했습니다."/>
    <FormControlLabel control={<Checkbox checked={group} disabled={disabled} onChange={e=>setGroup(e.target.checked)}/>} label="숫자와 단위가 같은 표의 같은 셀·환자군에 속함을 원문에서 확인했습니다."/>
    <Button variant="outlined" disabled={disabled||!estimate||!group} onClick={()=>onChange({...value,normalization:{method:'adjacent-percent/1',display:preview!,unitSpanId:unit,pointEstimateAttested:true,sameGroupAttested:true}})}>이 해석을 검토값에 연결</Button>
   </>}
  </>}
  <p>연결 후 기본 원문으로 돌아가 사유와 함께 ‘수정값 기록’을 눌러야 저장됩니다.</p>
 </section>;
}
