import {Button,MenuItem,TextField} from '@mui/material';
import {ChevronLeft,ChevronRight,Files} from 'lucide-react';
import {pdfTotalPages,type PdfSource} from './pdf-contract';
import styles from './PdfPageNavigation.module.css';

export default function PdfPageNavigation({source,page,disabled,onChange}:{source:PdfSource;page:number;disabled:boolean;onChange:(page:number)=>void}){
 const index=source.pages.findIndex(p=>p.number===page),selected=source.schemaVersion==='pdf-evidence-selected/1';
 return <section className={styles.navigation} aria-label="PDF 검토 페이지">
  <div className={styles.scope}><Files size={20}/><div><strong>{selected?'선택 페이지 검토':'PDF 원문'}</strong><p>{selected?`전체 ${pdfTotalPages(source)}쪽 중 ${source.pages.length}쪽 연결 · 나머지 ${pdfTotalPages(source)-source.pages.length}쪽은 이 검토에 포함되지 않습니다.`:'파일의 원래 페이지 번호입니다. 인쇄된 쪽수와 다를 수 있습니다.'}</p></div></div>
  <div className={styles.controls}>
   <Button aria-label="이전 검토 페이지" disabled={disabled||index<=0} onClick={()=>onChange(source.pages[index-1].number)} startIcon={<ChevronLeft size={16}/>}>이전</Button>
   <TextField select size="small" label="원문 쪽수" value={page} disabled={disabled} onChange={e=>onChange(Number(e.target.value))}>
    {source.pages.map(p=><MenuItem key={p.number} value={p.number}>PDF {p.number}쪽</MenuItem>)}
   </TextField>
   <Button aria-label="다음 검토 페이지" disabled={disabled||index<0||index>=source.pages.length-1} onClick={()=>onChange(source.pages[index+1].number)} endIcon={<ChevronRight size={16}/>}>다음</Button>
  </div>
  {selected&&<p className={styles.note}>원문 쪽수와 인용 위치를 유지합니다. 페이지 연결은 내용 확인·전문 검토 완료를 뜻하지 않습니다.</p>}
 </section>;
}
