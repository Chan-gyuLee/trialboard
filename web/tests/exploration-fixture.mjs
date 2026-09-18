import {execFileSync} from 'node:child_process';
// Real Python simulator, synthetic inputs, no filesystem writes/network/model calls.
const packet=JSON.parse(execFileSync('uv',['run','python','-c',`
import json
from types import SimpleNamespace
from trialboard.research.exploration import build_exploration
run=SimpleNamespace(id='00000000-0000-4000-8000-000000000002', request=SimpleNamespace(nct_id='NCT00000001',asset='MOCdrug'))
print(json.dumps(build_exploration(run,None)))
`],{encoding:'utf8',cwd:new URL('../..',import.meta.url)}));
export const explorationFixture=()=>structuredClone(packet);
