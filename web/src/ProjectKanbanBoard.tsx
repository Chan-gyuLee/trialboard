import {Button,Chip} from "@mui/material";
import type {ProjectReceipt} from "./project-checkpoint";
import {groupIntoKanban} from "./project-kanban";

export default function ProjectKanbanBoard({rows,hasSession,busy,locked,onOpen,onViewPolicy}:{rows:ProjectReceipt[];hasSession:boolean;busy:boolean;locked:boolean;onOpen:(row:ProjectReceipt)=>void;onViewPolicy?:(row:ProjectReceipt)=>void}){
  const groups=groupIntoKanban(rows,hasSession);
  return <div className="project-kanban" role="list" aria-label="문서 카드 보드 · 역할별 작업 단계">
    {groups.map(column=><div className="project-kanban-column" role="listitem" key={column.key}>
      <h4>{column.label} <Chip size="small" label={column.items.length}/></h4>
      <div className="project-kanban-cards">
        {!column.items.length&&<p className="project-kanban-empty">없음</p>}
        {column.items.map(row=>{
          const blocked=hasSession&&row.usage_policy?.original_storage!=="ALLOW";
          return <div className="project-kanban-card" key={`${row.project_id}-${row.revision}`}>
            <strong>{row.title}</strong>
            <p>검토 r{row.revision}{row.source_version?.version_id?` · 원문 버전 ${row.source_version.version_id.slice(0,8)}`:" · 독립 원문"}</p>
            <div className="project-kanban-chips">
              {row.sharing_scope&&<Chip size="small" label={row.sharing_scope==="restricted"?"제한 공유":"팀 전체 공유"}/>}
              <Chip size="small" label={`저장 ${row.usage_policy?.original_storage??"UNKNOWN"}`}/>
              <Chip size="small" label={`외부 AI ${row.usage_policy?.external_ai??"UNKNOWN"}`}/>
            </div>
            <div className="project-kanban-actions">
              <Button size="small" variant="outlined" disabled={busy||locked||blocked} onClick={()=>onOpen(row)}>열기</Button>
              {onViewPolicy&&<Button size="small" disabled={busy||locked} onClick={()=>onViewPolicy(row)}>이용조건</Button>}
            </div>
            {blocked&&<small>원본 저장 정책이 UNKNOWN/DENY여서 열기가 차단됩니다.</small>}
          </div>;
        })}
      </div>
    </div>)}
  </div>;
}
