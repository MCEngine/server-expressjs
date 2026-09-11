import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildStack, type Stack } from './auth-helpers.js';

const PASSWORD = 'a sufficiently long passphrase';

describe('news', () => {
  let s: Stack;
  let editor: string;

  const registerAs = async (handle: string) => {
    const res = await request(s.app).post('/api/v1/auth/register').send({
      handle,
      displayName: handle,
      email: `${handle}@example.com`,
      password: PASSWORD,
    });
    expect(res.status).toBe(201);
    return res.body.access_token as string;
  };

  const post = (access: string, body: Record<string, unknown>) =>
    request(s.app).post('/api/v1/news').set('Authorization', `Bearer ${access}`).send(body);

  const article = (n: number) => ({
    title: `Release ${n}`,
    summary: `What changed in ${n}.`,
    body: `# Release ${n}\n\nIt **shipped**.`,
  });

  beforeEach(async () => {
    // The allowlist is the whole authorization model, so the suite sets it.
    s = await buildStack({ NEWS_AUTHORS: 'editor' });
    editor = await registerAs('editor');
  });

  afterEach(async () => {
    await s.destroy();
  });

  describe('who may write it', () => {
    it('refuses an account that is not on the list', async () => {
      const stranger = await registerAs('stranger');
      const res = await post(stranger, article(1));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('not_a_news_author');
    });

    it('refuses everyone when the list is empty, which is the default', async () => {
      await s.destroy();
      s = await buildStack();
      const someone = await registerAs('someone');
      expect((await post(someone, article(1))).status).toBe(403);
    });

    it('accepts an account on the list', async () => {
      const res = await post(editor, article(1));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ title: 'Release 1', hidden: false });
      // The Markdown is stored as written, not as HTML.
      expect(res.body.body).toBe('# Release 1\n\nIt **shipped**.');
      expect(res.body.author).toMatchObject({ handle: 'editor' });
    });
  });

  describe('reading it', () => {
    it('needs no credential, and pages ten at a time, newest first', async () => {
      for (let n = 1; n <= 12; n += 1) await post(editor, article(n));

      const first = await request(s.app).get('/api/v1/news');
      expect(first.status).toBe(200);
      expect(first.body.data).toHaveLength(10);
      expect(first.body.data[0].title).toBe('Release 12');
      expect(first.body.next_cursor).toEqual(expect.any(String));

      const second = await request(s.app)
        .get('/api/v1/news')
        .query({ cursor: first.body.next_cursor });
      expect(second.body.data).toHaveLength(2);
      expect(second.body.data[0].title).toBe('Release 2');
      // A short page has nothing behind it, so the reader stops asking.
      expect(second.body.next_cursor).toBeNull();
    });

    it('leaves a hidden item out of the list and answers 404 for it', async () => {
      const created = await post(editor, article(1));
      await request(s.app)
        .patch(`/api/v1/news/${created.body.id}`)
        .set('Authorization', `Bearer ${editor}`)
        .send({ hidden: true })
        .expect(200);

      expect((await request(s.app).get('/api/v1/news')).body.data).toHaveLength(0);
      // 404 rather than 403: a reader does not learn it exists.
      expect((await request(s.app).get(`/api/v1/news/${created.body.id}`)).status).toBe(404);
    });

    it('still shows a hidden item to the author', async () => {
      const created = await post(editor, article(1));
      await request(s.app)
        .patch(`/api/v1/news/${created.body.id}`)
        .set('Authorization', `Bearer ${editor}`)
        .send({ hidden: true });

      const read = await request(s.app)
        .get(`/api/v1/news/${created.body.id}`)
        .set('Authorization', `Bearer ${editor}`);
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({ hidden: true });
      expect(read.body.hidden_at).toEqual(expect.any(String));

      const listed = await request(s.app)
        .get('/api/v1/news')
        .set('Authorization', `Bearer ${editor}`);
      expect(listed.body.data).toHaveLength(1);
    });
  });

  describe('changing it', () => {
    it('is the author’s to edit, hide, show and delete', async () => {
      const created = await post(editor, article(1));
      const id = created.body.id as string;

      const edited = await request(s.app)
        .patch(`/api/v1/news/${id}`)
        .set('Authorization', `Bearer ${editor}`)
        .send({ title: 'Release 1, corrected' });
      expect(edited.body.title).toBe('Release 1, corrected');
      expect(edited.body.body).toBe(article(1).body);

      await request(s.app)
        .patch(`/api/v1/news/${id}`)
        .set('Authorization', `Bearer ${editor}`)
        .send({ hidden: true })
        .expect(200);
      const shown = await request(s.app)
        .patch(`/api/v1/news/${id}`)
        .set('Authorization', `Bearer ${editor}`)
        .send({ hidden: false });
      expect(shown.body.hidden).toBe(false);

      await request(s.app)
        .delete(`/api/v1/news/${id}`)
        .set('Authorization', `Bearer ${editor}`)
        .expect(204);
      expect((await request(s.app).get(`/api/v1/news/${id}`)).status).toBe(404);
    });

    it('refuses another author, on the list or not', async () => {
      const created = await post(editor, article(1));
      await s.destroy();

      // Rebuilt with two authors: being allowed to write news is not being
      // allowed to rewrite somebody else's.
      s = await buildStack({ NEWS_AUTHORS: 'editor,second' });
      const first = await registerAs('editor');
      const second = await registerAs('second');
      const mine = await post(first, article(1));

      const attempt = await request(s.app)
        .patch(`/api/v1/news/${mine.body.id}`)
        .set('Authorization', `Bearer ${second}`)
        .send({ title: 'Not yours' });
      expect(attempt.status).toBe(403);
      expect(attempt.body.error.code).toBe('not_the_author');
      expect(created.status).toBe(201);
    });

    it('records what happened in the audit log', async () => {
      const created = await post(editor, article(1));
      await request(s.app)
        .patch(`/api/v1/news/${created.body.id}`)
        .set('Authorization', `Bearer ${editor}`)
        .send({ hidden: true });

      const rows = await s.db.db
        .selectFrom('audit_events')
        .selectAll()
        .where('subject_type', '=', 'news')
        .orderBy('id')
        .execute();
      expect(rows.map((r) => r.action)).toEqual(['news.created', 'news.hidden']);
    });
  });
});
