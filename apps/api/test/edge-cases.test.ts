import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { notificationOutbox, tickets } from '../src/db/schema';
import { createTestApp, ids, JPEG, resetData, type TestContext } from './helpers';

const complaint = (ref: string, contractNo = '40217735') => ({
  externalRef: ref,
  contractNo,
  problemType: 'cable_down',
  description: 'Cable on the ground near the school'
});

describe('inputs and situations that must not break the system', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetData(t.db));

  it('does not create a second ticket or second SMS when the Call Center sends the same complaint again', async () => {
    const first = await t.as('call-center').post('/api/intake/call-center/complaints', complaint('CC-9'));
    const second = await t.as('call-center').post('/api/intake/call-center/complaints', complaint('CC-9'));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ ticketId: first.body.ticketId, created: false });
    const [{ n }] = (await t.db.execute<{ n: number }>(sql`select count(*)::int as n from tickets`)).rows;
    expect(n).toBe(1);
    const sms = await t.db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipient, '+258841110001'));
    expect(sms).toHaveLength(1);
  });

  it('creates exactly one ticket when the same complaint arrives twice at the same moment', async () => {
    const [a, b] = await Promise.all([
      t.as('call-center').post('/api/intake/call-center/complaints', complaint('CC-RACE')),
      t.as('call-center').post('/api/intake/call-center/complaints', complaint('CC-RACE'))
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.ticketId).toBe(b.body.ticketId);
  });

  it('explains clearly when the contract number is unknown', async () => {
    const res = await t
      .as('call-center')
      .post('/api/intake/call-center/complaints', complaint('CC-10', '99999999'));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('rejects a complaint with missing fields and says which ones', async () => {
    const res = await t
      .as('call-center')
      .post('/api/intake/call-center/complaints', { externalRef: 'CC-11' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.map((d: { path: string[] }) => d.path[0])).toEqual(
      expect.arrayContaining(['contractNo', 'problemType', 'description'])
    );
  });

  it('still records a complaint from outside every area, unassigned to any team, for NOC to see', async () => {
    const res = await t
      .as('call-center')
      .post('/api/intake/call-center/complaints', complaint('CC-12', '40999999'));
    expect(res.status).toBe(201);
    const detail = await t.as('nadia.mussa').get(`/api/tickets/${res.body.ticketId}`);
    expect(detail.body).toMatchObject({ teamId: null, areaName: null, status: 'new' });
    expect((await t.as('helena.mondlane').get('/api/tickets')).body.total).toBe(0);
  });

  it('lets only one of two simultaneous accepts succeed', async () => {
    const { body } = await t.as('call-center').post('/api/intake/call-center/complaints', complaint('CC-13'));
    await t
      .as('helena.mondlane')
      .post(`/api/tickets/${body.ticketId}/assign`, { assigneeId: ids['armando.cossa'] });
    const results = await Promise.all([
      t.as('armando.cossa').post(`/api/tickets/${body.ticketId}/accept`),
      t.as('armando.cossa').post(`/api/tickets/${body.ticketId}/accept`)
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const detail = await t.as('nadia.mussa').get(`/api/tickets/${body.ticketId}`);
    expect(detail.body.events.filter((e: { type: string }) => e.type === 'accept')).toHaveLength(1);
  });

  it('stops managers and staff from acting on tickets that are not theirs', async () => {
    const { body } = await t.as('call-center').post('/api/intake/call-center/complaints', complaint('CC-14'));
    const id = body.ticketId;

    const otherManager = await t
      .as('joao.matsinhe')
      .post(`/api/tickets/${id}/assign`, { assigneeId: ids['ofelia.tembe'] });
    expect([otherManager.status, otherManager.body.code]).toEqual([403, 'NOT_IN_TEAM']);

    const wrongTeamStaff = await t
      .as('helena.mondlane')
      .post(`/api/tickets/${id}/assign`, { assigneeId: ids['ofelia.tembe'] });
    expect([wrongTeamStaff.status, wrongTeamStaff.body.code]).toEqual([422, 'ASSIGNEE_NOT_IN_TEAM']);

    const notStaff = await t
      .as('helena.mondlane')
      .post(`/api/tickets/${id}/assign`, { assigneeId: ids['helena.mondlane'] });
    expect(notStaff.status).toBe(422);

    await t.as('helena.mondlane').post(`/api/tickets/${id}/assign`, { assigneeId: ids['armando.cossa'] });
    const colleague = await t.as('ana.sitoe').post(`/api/tickets/${id}/accept`);
    expect([colleague.status, colleague.body.code]).toEqual([403, 'NOT_ASSIGNEE']);
  });

  it('refuses steps out of order with a clear message', async () => {
    const { body } = await t.as('call-center').post('/api/intake/call-center/complaints', complaint('CC-15'));
    const early = await t
      .as('call-center')
      .post('/api/intake/call-center/tickets/CC-15/check-result', { result: 'fixed' });
    expect([early.status, early.body.code]).toEqual([409, 'INVALID_TRANSITION']);
    const [row] = await t.db
      .select({ status: tickets.status })
      .from(tickets)
      .where(eq(tickets.id, body.ticketId));
    expect(row.status).toBe('assigned');
  });

  it('does not accept a photo that was never uploaded', async () => {
    const { body } = await t.as('call-center').post('/api/intake/call-center/complaints', complaint('CC-16'));
    const id = body.ticketId;
    await t.as('helena.mondlane').post(`/api/tickets/${id}/assign`, { assigneeId: ids['armando.cossa'] });
    await t.as('armando.cossa').post(`/api/tickets/${id}/accept`);
    await t.as('armando.cossa').post(`/api/tickets/${id}/start`);
    const upload = await t.as('armando.cossa').post(`/api/tickets/${id}/attachments`, {
      fileName: 'x.jpg',
      contentType: 'image/jpeg',
      size: 10
    });
    const res = await t
      .as('armando.cossa')
      .post(`/api/tickets/${id}/resolve`, { note: 'done', attachmentIds: [upload.body.attachmentId] });
    expect([res.status, res.body.code]).toEqual([422, 'ATTACHMENT_NOT_UPLOADED']);
  });

  it('serves only real photos, as photos, whatever was sent to the upload address', async () => {
    const { body } = await t.as('call-center').post('/api/intake/call-center/complaints', complaint('CC-19'));
    const id = body.ticketId;
    await t.as('helena.mondlane').post(`/api/tickets/${id}/assign`, { assigneeId: ids['armando.cossa'] });
    await t.as('armando.cossa').post(`/api/tickets/${id}/accept`);
    await t.as('armando.cossa').post(`/api/tickets/${id}/start`);
    const page = '<html><script>alert(document.domain)</script></html>';
    const newUpload = async () =>
      (
        await t.as('armando.cossa').post(`/api/tickets/${id}/attachments`, {
          fileName: 'meter.jpg',
          contentType: 'image/jpeg',
          size: 4
        })
      ).body as { attachmentId: string; uploadUrl: string; headers: Record<string, string> };

    // The announced type is part of the signature: a web page cannot be stored under another type.
    const asPage = await newUpload();
    const put = await fetch(asPage.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/html' },
      body: page
    });
    expect(put.ok).toBe(false);

    // Sent with the right type, a web page is still not a photo: refused and removed when the job is finished.
    await fetch(asPage.uploadUrl, { method: 'PUT', headers: asPage.headers, body: page });
    const refused = await t
      .as('armando.cossa')
      .post(`/api/tickets/${id}/resolve`, { note: 'done', attachmentIds: [asPage.attachmentId] });
    expect([refused.status, refused.body.code]).toEqual([422, 'ATTACHMENT_INVALID']);
    const again = await t
      .as('armando.cossa')
      .post(`/api/tickets/${id}/resolve`, { note: 'done', attachmentIds: [asPage.attachmentId] });
    expect(again.body.code).toBe('ATTACHMENT_NOT_UPLOADED');

    // More than announced and more than 10 MB is refused too, even when it starts like a JPEG.
    const tooBig = await newUpload();
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(JPEG);
    await fetch(tooBig.uploadUrl, { method: 'PUT', headers: tooBig.headers, body: big });
    const bigRes = await t
      .as('armando.cossa')
      .post(`/api/tickets/${id}/resolve`, { note: 'done', attachmentIds: [tooBig.attachmentId] });
    expect(bigRes.body.code).toBe('ATTACHMENT_INVALID');

    // A real photo is kept, and its address always answers with the photo's type.
    const photo = await newUpload();
    await fetch(photo.uploadUrl, { method: 'PUT', headers: photo.headers, body: JPEG });
    const done = await t
      .as('armando.cossa')
      .post(`/api/tickets/${id}/resolve`, { note: 'done', attachmentIds: [photo.attachmentId] });
    expect(done.status).toBe(200);
    const kept = done.body.attachments.find((a: { id: string }) => a.id === photo.attachmentId);
    const got = await fetch(kept.url);
    expect(got.headers.get('content-type')).toBe('image/jpeg');
  });

  it('rejects files that are not photos or are too large', async () => {
    const { body } = await t.as('call-center').post('/api/intake/call-center/complaints', complaint('CC-17'));
    const res = await t.as('armando.cossa').post(`/api/tickets/${body.ticketId}/attachments`, {
      fileName: 'virus.exe',
      contentType: 'application/x-msdownload',
      size: 50 * 1024 * 1024
    });
    expect(res.status).toBe(400);
  });

  it('keeps the event partitions ready for the coming months', async () => {
    const rows = (
      await t.db.execute<{ name: string }>(sql`
        select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid
        join pg_class p on p.oid = i.inhparent where p.relname = 'ticket_events'`)
    ).rows.map((r) => r.name);
    const next = new Date();
    next.setUTCMonth(next.getUTCMonth() + 1, 1);
    const expected = `ticket_events_y${next.getUTCFullYear()}m${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
    expect(rows).toContain(expected);
  });
});
