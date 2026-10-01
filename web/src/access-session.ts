import type {SessionPacket} from "./auth-client";

export function sessionIdentity(session:SessionPacket):string{return `${session.subject.id}:${session.team.id}`;}
export function expiryDelay(session:SessionPacket,now=Date.now()):number{
  return Math.max(0,Math.min(session.absolute_expires_at,session.idle_expires_at)*1000-now);
}
