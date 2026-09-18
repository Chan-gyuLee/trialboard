import {useEffect,useMemo,useState} from 'react';
import {Alert,Button,Slider} from '@mui/material';
import {Pause,Play,RotateCcw,SkipForward} from 'lucide-react';
import type {Collection} from './research';
import {replayDelay,replayEvents} from './activity-model';
import AgentActivity from './AgentActivity';

export default function ActivityReplay({collection}:{collection:Collection}){
 const events=useMemo(()=>replayEvents(collection),[collection]);
 const [index,setIndex]=useState(0),[playing,setPlaying]=useState(false),[reading,setReading]=useState(false);
 const end=index>=events.length-1;
 useEffect(()=>{
  if(!playing||end)return;
  const timer=setTimeout(()=>setIndex(i=>Math.min(i+1,events.length-1)),reading?2500:replayDelay(events[index],events[index+1]));
  return()=>clearTimeout(timer);
 },[playing,end,index,events,reading]);
 useEffect(()=>{if(end)setPlaying(false);},[end]);
 if(!events.length)return <Alert severity="info">저장된 작업 기록이 없습니다.</Alert>;
 return <section className="activity-replay" aria-label="저장된 실행 과정 재생" data-demo-scene="replay">
  <div className="replay-notice"><strong>{collection.execution_mode==='SCRIPTED_TEST_DOUBLE'?'MOC · 합성 테스트 기록 재생':'저장된 실행 기록 재생'}</strong><span>대기 구간 축약 · {new Date(collection.created_at).toLocaleString('ko-KR')}</span></div>
  <div className="replay-controls"><Button variant="contained" startIcon={playing?<Pause size={16}/>:<Play size={16}/>} onClick={()=>{if(end)setIndex(0);setPlaying(v=>!v);}}>{playing?'일시 정지':end?'다시 재생':'재생'}</Button><Button startIcon={<SkipForward size={16}/>} disabled={end} onClick={()=>{setPlaying(false);setIndex(i=>Math.min(i+1,events.length-1));}}>다음 기록</Button><Button aria-label="처음 기록으로" startIcon={<RotateCcw size={16}/>} onClick={()=>{setPlaying(false);setIndex(0);}}>처음</Button><span>{index+1} / {events.length} 기록</span></div>
  <Button size="small" aria-pressed={reading} onClick={()=>setReading(v=>!v)}>{reading?'기록당 2.5초':'천천히 재생'}</Button>
  {reading&&<p className="auto-caption">원래 작업 시간은 그대로 표시합니다.</p>}
  {events.length>1&&<Slider aria-label="저장된 작업 기록 위치" min={0} max={events.length-1} step={1} value={index} onChange={(_,value)=>{setPlaying(false);setIndex(value as number);}} getAriaValueText={v=>`${v+1}번째 작업 기록`}/>}
  <AgentActivity events={events.slice(0,index+1)} outcome={null} busy={false} seconds={Math.floor((events[index].research?.elapsed_ms??0)/1000)} query={collection.request.asset} onStop={()=>setPlaying(false)} replay playing={playing}/>
 </section>;
}
