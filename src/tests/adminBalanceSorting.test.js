'use strict';
const { Currency } = require('../modules/currency/currency.model');
const { listUsers } = require('../modules/admin/admin.users.service');
const { schemas } = require('../modules/admin/admin.validation');
const { connectTestDB, disconnectTestDB, clearCollections, createCustomer, createGroup, createAdmin } = require('./testHelpers');

beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(clearCollections);

test('sorts all pages by current platform exchange rates and filters debtors', async () => {
    await Currency.create({ code: 'EGP', name: 'Egyptian pound', symbol: 'E', platformRate: 50 });
    const group = await createGroup();
    const usd = await createCustomer({ groupId: group._id, name: 'Dollar', currency: 'USD', walletBalance: 100 });
    const egp = await createCustomer({ groupId: group._id, name: 'Pound', currency: 'EGP', walletBalance: 102 });
    const debt = await createCustomer({ groupId: group._id, name: 'Debt', currency: 'EGP', walletBalance: -200 });
    const unknown = await createCustomer({ groupId: group._id, name: 'Unknown', currency: 'SAR', walletBalance: 50000 });
    const query = { role: 'CUSTOMER', sortBy: 'balanceUsd', sortOrder: 'desc', limit: 2 };
    const first = await listUsers({ ...query, page: 1 });
    const second = await listUsers({ ...query, page: 2 });
    expect(first.users.map((u) => String(u._id))).toEqual([String(usd._id), String(egp._id)]);
    expect(second.users.map((u) => String(u._id))).toEqual([String(debt._id), String(unknown._id)]);
    expect(first.pagination.total).toBe(4);
    const debtors = await listUsers({ ...query, debtors: true });
    expect(debtors.users.map((u) => String(u._id))).toEqual([String(debt._id)]);
    expect(debtors.pagination.total).toBe(1);
    expect(schemas.listUsersQuery.validate({ sortBy: 'balanceUsd', debtors: 'true' }).error).toBeUndefined();
});

test('admin HTTP filters active, highest balance, debtors and deleted customers', async () => {
    const jwt = require('jsonwebtoken');
    const config = require('../config/config');
    const app = require('../app');
    const group = await createGroup();
    const admin = await createAdmin({ groupId: group._id });
    const active = await createCustomer({ groupId: group._id, currency: 'USD', walletBalance: 100 });
    const debt = await createCustomer({ groupId: group._id, currency: 'EGP', walletBalance: -40 });
    const deleted = await createCustomer({ groupId: group._id, currency: 'USD', walletBalance: 900, deletedAt: new Date(), status: 'REJECTED' });
    await Currency.create({ code: 'EGP', name: 'Egyptian pound', symbol: 'E', platformRate: 50 });
    const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
    try {
        const base = `http://127.0.0.1:${server.address().port}/api/admin/users`;
        const headers = { Authorization: `Bearer ${jwt.sign({ id: String(admin._id) }, config.jwt.secret, { expiresIn: '10m' })}` };
        const get = async (path) => { const response = await fetch(`${base}${path}`, { headers }); expect(response.status).toBe(200); return response.json(); };
        const all = await get('?role=CUSTOMER');
        expect(all.data.map((u) => String(u._id))).toEqual(expect.arrayContaining([String(active._id), String(debt._id)]));
        expect(all.data.map((u) => String(u._id))).not.toContain(String(deleted._id));
        const approved = await get('?role=CUSTOMER&status=ACTIVE');
        expect(approved.data.map((u) => String(u._id))).toEqual(expect.arrayContaining([String(active._id), String(debt._id)]));
        const highest = await get('?role=CUSTOMER&sortBy=balanceUsd&sortOrder=desc');
        expect(highest.data.map((u) => String(u._id))).toEqual([String(active._id), String(debt._id)]);
        const debtors = await get('?role=CUSTOMER&sortBy=balanceUsd&sortOrder=asc&debtors=true');
        expect(debtors.data.map((u) => String(u._id))).toEqual([String(debt._id)]);
        const removed = await get('/deleted');
        const entries = Array.isArray(removed.data) ? removed.data : removed.data.users;
        expect(entries.map((u) => String(u._id))).toContain(String(deleted._id));
    } finally { await new Promise((resolve) => server.close(resolve)); }
});
