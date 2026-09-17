import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../client.js',import.meta.url),'utf8');
const definition=source.match(/^const POWER_TIERS=.*$/m)?.[0];
const resolver=source.match(/^function powerTier\(value\).*$/m)?.[0];
assert.ok(definition&&resolver,'Badge rules must be present');
const powerTier=runInNewContext(`${definition}\n${resolver}\npowerTier`);

test('badge bands include both boundaries and preserve iron below 1100',()=>{
  for(const [value,name] of [[0,'아이언'],[1099,'아이언'],[1100,'브론즈'],[1199,'브론즈'],[1200,'실버'],[1299,'실버'],[1300,'골드'],[1399,'골드'],[1400,'플래티넘'],[1599,'플래티넘'],[1600,'다이아'],[1799,'다이아'],[1800,'챌린저'],[3200,'챌린저']])assert.equal(powerTier(value).name,name,`score ${value}`);
});
test('next badge tooltips use the revised thresholds',()=>{
  for(const value of [1099,1199,1299,1399,1599,1799])assert.equal(powerTier(value).nextGap,1);
  assert.equal(powerTier(1400).nextGap,200);
  assert.equal(powerTier(1800).next,null);
  assert.equal(powerTier(1800).nextGap,0);
});
