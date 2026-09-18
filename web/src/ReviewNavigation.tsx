import {useId,useState} from 'react';
import {Button,Collapse} from '@mui/material';
import {ArrowRight,ChevronDown,History,SlidersHorizontal} from 'lucide-react';
import BrandLogo from './BrandLogo';
import type {Collection} from './research';
import styles from './ReviewNavigation.module.css';

export function ReviewHeader({step}:{step:0|1|2}){
 return <header className={styles.header}>
  <BrandLogo/>
  <ol className={styles.steps} aria-label="현재 검토 단계">
   {['입력','에이전트 실행','브리핑'].map((label,index)=><li key={label} aria-current={step===index?'step':undefined} data-past={index<step}><span className={styles.number} aria-hidden="true">{String(index+1).padStart(2,'0')}</span><span>{label}</span></li>)}
  </ol>
 </header>;
}

const statusLabels:Record<string,string>={COMPLETE:'완료',PARTIAL:'부분 완료',FAILED:'실패',CANCELLED:'중단',RUNNING:'진행 중'};
type SavedReview=Pick<Collection,'id'|'request'|'status'|'created_at'>;
export function ReviewTools({history,disabled,onOpen,onManual}:{history:SavedReview[];disabled:boolean;onOpen:(id:string)=>void;onManual:()=>void}){
 const [expanded,setExpanded]=useState(false),panelId=useId();
 return <section className={styles.tools} aria-label="검토 기록과 상세 검색">
  <div className={styles.toolbar}>
   <Button className={styles.historyToggle} disabled={disabled||history.length===0} aria-expanded={expanded} aria-controls={panelId} onClick={()=>setExpanded(!expanded)} startIcon={<History size={18}/>}>
    최근 검토 <span className={styles.count}>{history.length}</span><ChevronDown size={16} className={styles.chevron} data-open={expanded}/>
   </Button>
   <Button className={styles.manual} disabled={disabled} onClick={onManual} startIcon={<SlidersHorizontal size={17}/>}>상세 검색·수동 검토</Button>
  </div>
  <Collapse in={expanded} id={panelId}>
   <ul className={styles.history} aria-label="저장된 검토 목록">
    {history.map(h=><li key={h.id}><button disabled={disabled} onClick={()=>onOpen(h.id)}>
     <span className={styles.recordTitle}><strong>{h.request.asset}</strong><span>{h.request.nct_id}</span></span>
     <span className={styles.recordMeta}><span className={styles.status} data-status={h.status}>{statusLabels[h.status]??h.status}</span><time dateTime={h.created_at}>{new Date(h.created_at).toLocaleString('ko-KR',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}</time></span>
     <ArrowRight size={17} className={styles.openIcon} aria-hidden="true"/>
    </button></li>)}
   </ul>
  </Collapse>
 </section>;
}
