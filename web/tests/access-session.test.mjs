import test from "node:test";
import assert from "node:assert/strict";
import {expiryDelay,sessionIdentity} from "../src/access-session.ts";

const packet={authenticated:true,subject:{id:"user-a",username:"alpha"},team:{id:"team-a",name:"Alpha"},role:"admin",permission_epoch:1,absolute_expires_at:2000,idle_expires_at:1500,session_context:"a".repeat(64)};

test("session identity changes only across subject or team",()=>{
  assert.equal(sessionIdentity(packet),"user-a:team-a");
  assert.equal(sessionIdentity({...packet,idle_expires_at:1700}),sessionIdentity(packet));
  assert.notEqual(sessionIdentity({...packet,team:{id:"team-b",name:"Beta"}}),sessionIdentity(packet));
});

test("expiry timer uses the earlier server expiry without renewing",()=>{
  assert.equal(expiryDelay(packet,1_000_000),500_000);
  assert.equal(expiryDelay(packet,1_600_000),0);
});
