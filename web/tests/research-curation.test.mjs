import test from 'node:test';
import assert from 'node:assert/strict';
import {readCuration} from '../src/research-curation.ts';
const note={run_id:'MOC-run',source_id:'MOC-source',source_digest:'a'.repeat(64),revision:1,decision:'CHECK',reason:'MOC reason',reviewer_label:'MOC tester',reviewer_authenticated:false,clinical_verified:false,created_at:'2026-09-15T00:00:00Z'};
const read=ns=>readCuration(JSON.stringify(ns),note.run_id,note.source_id,note.source_digest);
test('versioned source-specific unverified curation',()=>{assert.equal(read([note])[0].revision,1);assert.equal(read([{...note,revision:2},note]).length,2);assert.deepEqual(read([]),[]);});
for(const [name,mutate] of [['wrong source',n=>n.source_id='other'],['changed hash',n=>n.source_digest='b'.repeat(64)],['fake expert',n=>n.reviewer_authenticated=true],['fake clinical approval',n=>n.clinical_verified=true],['unknown decision',n=>n.decision='APPROVED'],['bad revision',n=>n.revision=0],['bad reason',n=>n.reason={}],['bad date',n=>n.created_at='no']])test(`reject ${name}`,()=>{const n=structuredClone(note);mutate(n);assert.throws(()=>read([n]));});
test('reject duplicate or reversed versions',()=>{assert.throws(()=>read([note,note]));assert.throws(()=>read([note,{...note,revision:2}]));});
