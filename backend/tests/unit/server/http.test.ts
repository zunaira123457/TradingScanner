import { Request, Response } from 'express';
import { apiKeyAuth, parseTickers, rateLimit } from '@/server/http';

function mockRes() {
  const res: Partial<Response> & { statusCode?: number; body?: unknown; headers: Record<string, unknown> } = {
    headers: {},
  };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res as Response;
  });
  res.setHeader = jest.fn((k: string, v: unknown) => {
    res.headers[k] = v;
    return res as Response;
  });
  return res;
}

describe('parseTickers', () => {
  it('uppercases, trims and de-duplicates', () => {
    expect(parseTickers(' aapl, MSFT,aapl ', 10)).toEqual(['AAPL', 'MSFT']);
  });
  it('returns [] for empty input', () => {
    expect(parseTickers(undefined, 10)).toEqual([]);
  });
  it('rejects malformed tickers and over-long lists', () => {
    expect(parseTickers('AAPL,../etc', 10)).toBeNull();
    expect(parseTickers('A,B,C', 2)).toBeNull();
  });
  it('accepts class-share tickers like BRK.B', () => {
    expect(parseTickers('BRK.B', 10)).toEqual(['BRK.B']);
  });
});

describe('apiKeyAuth', () => {
  const req = (key?: string) => ({ header: (h: string) => (h === 'x-api-key' ? key : undefined) }) as Request;

  it('passes through when no key is configured', () => {
    const next = jest.fn();
    apiKeyAuth(undefined)(req(), mockRes() as Response, next);
    expect(next).toHaveBeenCalled();
  });
  it('rejects a wrong key with 401', () => {
    const next = jest.fn();
    const res = mockRes();
    apiKeyAuth('secret')(req('nope'), res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
  it('accepts the right key', () => {
    const next = jest.fn();
    apiKeyAuth('secret')(req('secret'), mockRes() as Response, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('rateLimit', () => {
  it('allows `limit` requests per window then returns 429 until the window resets', () => {
    let t = 0;
    const limiter = rateLimit(2, 1000, () => t);
    const req = { ip: '1.2.3.4' } as Request;
    const next = jest.fn();

    limiter(req, mockRes() as Response, next);
    limiter(req, mockRes() as Response, next);
    const blocked = mockRes();
    limiter(req, blocked as Response, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['Retry-After']).toBe(1);

    t = 1000;
    limiter(req, mockRes() as Response, next);
    expect(next).toHaveBeenCalledTimes(3);
  });
});
