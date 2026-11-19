'use strict';
const { Provider } = require('../modules/providers/provider.model');
const { ProviderProduct } = require('../modules/providers/providerProduct.model');
const { Product } = require('../modules/products/product.model');
const products = require('../modules/products/product.service');
const { syncProviderProducts, recalcProductPrices } = require('../modules/providers/providerProductSync.service');
const { connectTestDB, disconnectTestDB, clearCollections, createAdmin } = require('./testHelpers');
beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(clearCollections);

test.each([['1.25', '11.25', '13.25'], ['-1.25', '8.75', '10.75']])('preserves manual adjustment %s after creation, edit, supplier sync and reload', async (delta, initial, updated) => {
    const provider = await Provider.create({ name: 'Manual price', slug: 'mock-manual-price', baseUrl: 'https://mock.example.com', apiToken: 'test-token', isActive: true });
    const dto = { externalProductId: 'manual-price-1', rawName: 'Provider item', rawPrice: '10', minQty: 1, maxQty: 10, isActive: true };
    await syncProviderProducts(provider._id, { products: [dto] });
    const pp = await ProviderProduct.findOne({ provider: provider._id });
    const product = await products.publishFromProviderProduct({ providerProductId: pp._id, name: 'Platform item', pricingMode: 'sync', enableManualPrice: true, manualPriceAdjustment: delta });
    expect(product.manualPriceAdjustment).toBe(delta);
    expect(product.basePrice).toBe(initial);
    await products.updateProduct(product._id, { name: 'Platform item updated', enableManualPrice: true, manualPriceAdjustment: delta });
    let stored = await Product.findById(product._id);
    expect(stored.manualPriceAdjustment).toBe(delta);
    expect(stored.basePrice).toBe(initial);
    const result = await syncProviderProducts(provider._id, { products: [{ ...dto, rawPrice: '12' }] });
    expect(result.errors).toEqual([]);
    stored = await Product.findById(product._id);
    expect(stored.manualPriceAdjustment).toBe(delta);
    expect(stored.basePrice).toBe(updated);
    expect(stored.finalPrice).toBe(updated);
    await recalcProductPrices(pp._id);
    stored = await Product.findById(product._id);
    expect(stored.manualPriceAdjustment).toBe(delta);
    expect(stored.basePrice).toBe(updated);
});

test('rejects an adjustment that would make the sale price non-positive', async () => {
    const provider = await Provider.create({ name: 'Invalid adjustment', slug: 'mock-invalid-adjustment', baseUrl: 'https://mock.example.com', apiToken: 'test-token', isActive: true });
    await syncProviderProducts(provider._id, { products: [{ externalProductId: 'x', rawName: 'Item', rawPrice: '10', minQty: 1, maxQty: 10, isActive: true }] });
    const pp = await ProviderProduct.findOne({ provider: provider._id });
    await expect(products.publishFromProviderProduct({ providerProductId: pp._id, name: 'Invalid price', pricingMode: 'sync', enableManualPrice: true, manualPriceAdjustment: '-10' })).rejects.toMatchObject({ code: 'INVALID_FINAL_PRICE' });
});

test('admin HTTP saves the exact signed adjustment and returns it after reload', async () => {
    const jwt = require('jsonwebtoken');
    const config = require('../config/config');
    const provider = await Provider.create({ name: 'HTTP supplier', slug: 'mock-http-price', baseUrl: 'https://mock.example.com', apiToken: 'test-token', isActive: true });
    await syncProviderProducts(provider._id, { products: [{ externalProductId: 'h', rawName: 'Item', rawPrice: '10', minQty: 1, maxQty: 10, isActive: true }] });
    const pp = await ProviderProduct.findOne({ provider: provider._id });
    const admin = await createAdmin();
    const app = require('../app');
    const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
    try {
        const base = `http://127.0.0.1:${server.address().port}/api`;
        const headers = { Authorization: `Bearer ${jwt.sign({ id: String(admin._id) }, config.jwt.secret, { expiresIn: '10m' })}`, 'Content-Type': 'application/json' };
        const create = await fetch(`${base}/admin/products/from-provider`, { method: 'POST', headers, body: JSON.stringify({ providerProductId: String(pp._id), name: 'HTTP item', pricingMode: 'sync', enableManualPrice: true, manualPriceAdjustment: '-1.000000000123456789' }) });
        expect(create.status).toBe(201);
        const created = (await create.json()).data;
        const id = created._id || created.product?._id;
        const update = await fetch(`${base}/admin/products/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ enableManualPrice: true, manualPriceAdjustment: '1.000000000123456789' }) });
        expect(update.status).toBe(200);
        const stored = await Product.findById(id).lean();
        expect(stored.manualPriceAdjustment).toBe('1.000000000123456789');
        expect(stored.basePrice).toBe('11.000000000123456789');
    } finally { await new Promise((resolve) => server.close(resolve)); }
});
