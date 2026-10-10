import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRequestBuildArgs,REQUEST_BUILD_CLOSURE_SHA256} from './portable-build.mjs';
const args=['--private-root','private','--dependency-root','dependencies','--kit-root','kit','--toolchain-root','tools','--python','python.exe','--selection','selection.json','--official','owner.zip','--output-root','output','--run','new-request'];
test('request parser accepts explicit roots and a fresh key without caller authority fields',()=>{assert.equal(parseRequestBuildArgs(args).run,'new-request');assert.match(REQUEST_BUILD_CLOSURE_SHA256,/^[a-f0-9]{64}$/);});
for(const key of ['family','source-hash','tool-hash','candidate-sha','macro','closure-sha'])test(`request parser refuses caller --${key} authority`,()=>assert.throws(()=>parseRequestBuildArgs([...args,`--${key}`,'caller-value']),/Invalid request-build argument/));
test('request parser refuses duplicate variables',()=>assert.throws(()=>parseRequestBuildArgs([...args,'--selection','another.json']),/Duplicate/));
test('request parser refuses incomplete request',()=>assert.throws(()=>parseRequestBuildArgs(args.slice(0,-2)),/Supply all/));
test('request parser refuses output traversal',()=>assert.throws(()=>parseRequestBuildArgs([...args.slice(0,-1),'../outside']),/new request run key/));
