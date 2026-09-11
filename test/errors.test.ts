import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { ApiError, errors } from '../src/errors.js';
import { createErrorHandler } from '../src/http/errorHandler.js';
import { testApp, recordingLogger } from './helpers.js';

describe('the error envelope', () => {
  it('renders an unmatched route as the documented shape', async () => {
    const { app } = testApp();
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'route_not_found', message: 'No such route.' },
    });
  });

  it('omits details entirely rather than sending null', () => {
    expect(new ApiError(404, 'gone', 'Gone.').toBody().error).not.toHaveProperty('details');
  });

  it('sets Retry-After from the details of a 429', async () => {
    const logger = recordingLogger();
    const app = express();
    app.get('/limited', () => {
      throw errors.tooManyRequests(42);
    });
    app.use(createErrorHandler(logger));

    const res = await request(app).get('/limited');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('42');
  });

  it('translates malformed JSON into a client error, not a 500', async () => {
    const { app } = testApp();
    const res = await request(app)
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send('{"unterminated":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('malformed_json');
  });

  it('never leaks the message of an unexpected exception', async () => {
    const logger = recordingLogger();
    const app = express();
    app.get('/boom', () => {
      throw new Error('SELECT * FROM accounts WHERE secret = "hunter2"');
    });
    app.use(createErrorHandler(logger));

    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal_error');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    // It is still logged in full, which is the whole trade.
    expect(logger.lines.some((l) => l.level === 'error')).toBe(true);
  });
});
