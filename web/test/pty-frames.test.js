/**
 * pty-frames.test.js — the worker pty socket's JSON frame codec
 * (src/renderer/pty-frames.ts): the exact frames the server must speak.
 */
import { describe, it, expect } from 'vitest';
import { encodePtyFrame, decodePtyFrame, dataFrame, resizeFrame, closeFrame, ptyOpenBody } from '../../src/renderer/pty-frames.ts';

describe('pty frames', () => {
  it('encodes the three frames exactly', () => {
    expect(JSON.parse(dataFrame('ls\r'))).toEqual({ type: 'data', data: 'ls\r' });
    expect(JSON.parse(resizeFrame(120, 40))).toEqual({ type: 'resize', cols: 120, rows: 40 });
    expect(JSON.parse(closeFrame())).toEqual({ type: 'close' });
    expect(encodePtyFrame({ type: 'close', code: 1 })).toBe('{"type":"close","code":1}');
  });
  it('decodes strings and objects, round-tripping', () => {
    expect(decodePtyFrame('{"type":"data","data":"hi"}')).toEqual({ type: 'data', data: 'hi' });
    expect(decodePtyFrame({ type: 'resize', cols: '80', rows: 24 })).toEqual({ type: 'resize', cols: 80, rows: 24 });
    expect(decodePtyFrame('{"type":"close","code":0}')).toEqual({ type: 'close', code: 0 });
    expect(decodePtyFrame('{"type":"close"}')).toEqual({ type: 'close' });
  });
  it('drops anything that is not a known frame (never throws)', () => {
    expect(decodePtyFrame('not json')).toBeNull();
    expect(decodePtyFrame('')).toBeNull();
    expect(decodePtyFrame(null)).toBeNull();
    expect(decodePtyFrame(42)).toBeNull();
    expect(decodePtyFrame({ type: 'frame', data: 'x' })).toBeNull();
    expect(decodePtyFrame({ type: 'data', data: 7 })).toBeNull();
    expect(decodePtyFrame({ type: 'resize', cols: 0, rows: 10 })).toBeNull();
    expect(decodePtyFrame({ type: 'resize', cols: 10 })).toBeNull();
  });
  it('the open body carries size, and only the optional fields that are set', () => {
    expect(ptyOpenBody({ cols: 80.7, rows: 24 })).toEqual({ cols: 80, rows: 24 });
    expect(ptyOpenBody({ cols: 0, rows: 0 })).toEqual({ cols: 1, rows: 1 });
    expect(ptyOpenBody({ cols: 100, rows: 30, cwd: 'src', command: 'claude' })).toEqual({ cols: 100, rows: 30, cwd: 'src', command: 'claude' });
    expect(ptyOpenBody({ cols: 100, rows: 30, cwd: '', command: '' })).toEqual({ cols: 100, rows: 30 });
  });
});
