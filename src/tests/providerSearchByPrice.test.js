'use strict';
const { Provider } = require('../modules/providers/provider.model');
const { ProviderProduct } = require('../modules/providers/providerProduct.model');
const { listProviderProducts } = require('../modules/providers/providerProduct.service');
const { connectTestDB, disconnectTestDB, clearCollections, createAdmin } = require('./testHelpers');
beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(clearCollections);

test('search compares stored decimal prices across providers before pagination without writes', async () => {
    const a = await Provider.create({ name: 'Supplier A', slug: 'mock-search-a', baseUrl: 'https://mock.example.com', apiToken: 'test', isActive: true });
    const b = await Provider.create({ name: 'Supplier B', slug: 'mock-search-b', baseUrl: 'https://mock.example.com', apiToken: 'test', isActive: true });
    await ProviderProduct.create([{ provider: a._id, externalProductId: '1', rawName: 'Diamond pack', rawPrice: '10', isActive: true }, { provider: b._id, externalProductId: '2', rawName: 'Diamond pack', rawPrice: '2.0000000000000000001', isActive: true }, { provider: a._id, externalProductId: '3', rawName: 'Diamond pack', rawPrice: '2.0000000000000000002', isActive: true }]);
    const first = await listProviderProducts({ isActive: true }, { search: 'Diamond', sortByPrice: true, page: 1, limit: 2 });
    const second = await listProviderProducts({ isActive: true }, { search: 'Diamond', sortByPrice: true, page: 2, limit: 2 });
    expect(first.products.map((p) => p.externalProductId)).toEqual(['2', '3']);
    expect(first.products[0].provider.name).toBe('Supplier B');
    expect(second.products.map((p) => p.externalProductId)).toEqual(['1']);
    expect(first.pagination.total).toBe(3);
    expect((await ProviderProduct.findOne({ externalProductId: '2' }).lean()).rawPrice).toBe('2.0000000000000000001');
});

test('admin HTTP requires three characters and returns sorted supplier prices', async () => {
    const jwt = require('jsonwebtoken'); const config = require('../config/config');
    const provider = await Provider.create({ name: 'HTTP Supplier', slug: 'mock-search-http', baseUrl: 'https://mock.example.com', apiToken: 'test', isActive: true });
    await ProviderProduct.create([{ provider: provider._id, externalProductId: '1', rawName: 'Diamond', rawPrice: '10', isActive: true }, { provider: provider._id, externalProductId: '2', rawName: 'Diamond', rawPrice: '2', isActive: true }]);
    const admin = await createAdmin();
    const app = require('../app');
    const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
    try {
        const base = `http://127.0.0.1:${server.address().port}/api/admin/provider-products`;
        const headers = { Authorization: `Bearer ${jwt.sign({ id: String(admin._id) }, config.jwt.secret, { expiresIn: '10m' })}` };
        expect((await fetch(`${base}?search=di&sortBy=price`, { headers })).status).toBe(400);
        const response = await fetch(`${base}?search=dia&sortBy=price&isActive=true`, { headers });
        expect(response.status).toBe(200);
        expect((await response.json()).data.map((p) => p.rawPrice)).toEqual(['2', '10']);
    } finally { await new Promise((resolve) => server.close(resolve)); }
});
