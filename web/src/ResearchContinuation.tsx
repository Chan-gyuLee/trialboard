import {Button,Chip} from '@mui/material';
import {ArrowRight,FileCheck2} from 'lucide-react';
import type {AutoResult} from './auto-review';
import {handoffAvailability} from './research-handoff';
import styles from './ResearchContinuation.module.css';
export default function ResearchContinuation({done,disabled,onContinue,onProcess}:{done:AutoResult;disabled:boolean;onContinue:(done:AutoResult)=>void;onProcess:()=>void}){
 const status=handoffAvailability(done);
 return <section className={styles.panel} aria-label="다음 설계 검토 단계">
  <div className={styles.heading}><FileCheck2 size={22}/><h3>{status.ready?'모은 근거를, 다음 설계 검토로':'설계 전에 필요한 근거를 확인하세요'}</h3><Chip size="small" variant="outlined" label={status.ready?`관측 초안 ${status.observations}개`:'추가 근거 필요'}/></div>
  <p>{status.reason}</p>
  <ol><li><b>01</b> 원문·추출값 연결</li><li><b>02</b> 핵심 필드 대조</li><li><b>03</b> AI 설계 초안·가정 비교</li></ol>
  <div className={styles.actions}>{status.ready&&<Button variant="contained" disabled={disabled} endIcon={<ArrowRight size={17}/>} onClick={()=>onContinue(done)}>추출 근거로 검토 이어가기</Button>}<Button disabled={disabled} onClick={onProcess}>원문 처리 기록 확인</Button></div>
  <small>저장된 자료 열기는 새 모델 요청·설계 계산을 실행하지 않습니다. 검토와 별도 전송 동의 후 제안합니다.</small>
 </section>;
}
