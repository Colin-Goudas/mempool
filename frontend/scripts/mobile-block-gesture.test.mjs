import test from 'node:test';
import assert from 'node:assert/strict';
import { blockTouchAxis } from '../src/app/components/start/mobile-block-gesture.ts';
test('taps and small hand movement do not drag the dashboard',()=>{
 assert.equal(blockTouchAxis(0,0),'pending');
 assert.equal(blockTouchAxis(9,-9),'pending');
});
test('vertical and diagonal page swipes stay available over the dashboard',()=>{
 assert.equal(blockTouchAxis(2,25),'vertical');
 assert.equal(blockTouchAxis(-10,-35),'vertical');
 assert.equal(blockTouchAxis(12,12),'vertical');
});
test('horizontal swipes in either direction move blocks',()=>{
 assert.equal(blockTouchAxis(25,3),'horizontal');
 assert.equal(blockTouchAxis(-25,3),'horizontal');
});
test('direction stays locked when a finger curves during a swipe',()=>{
 assert.equal(blockTouchAxis(60,20,blockTouchAxis(2,25)),'vertical');
 assert.equal(blockTouchAxis(15,45,blockTouchAxis(25,3)),'horizontal');
});
