'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const service = require('../modules/theme/theme.service');
const { ThemeSettings, ThemeHistory } = require('../modules/theme/theme.model');
const { connectTestDB, disconnectTestDB, clearCollections, createAdmin } = require('./testHelpers');
beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(clearCollections);

test('stores and reloads logo, five image slots and mobile columns while accepting old four-slot themes', async () => {
    const admin = await createAdmin();
    const theme = service.presets()[0].configuration;
    const legacy = JSON.parse(JSON.stringify(theme)); legacy.brand.slides = [null, null, null, null];
    expect(service.validateTheme(legacy).brand.slides).toHaveLength(5);
    theme.brand.logoPath = '/uploads/themes/1234567890123-1234567890abcdef.png';
    theme.brand.slides = [1, 2, 3, 4, 5].map((n) => `/uploads/themes/123456789012${n}-1234567890abcdef.png`);
    for (const count of [2, 3, 4]) {
        theme.layout.productsPerRowMobile = count;
        theme.layout.categoriesPerRowMobile = count;
        await service.saveDraft(admin._id, theme);
        const saved = await service.settings();
        expect(saved.draft.layout.productsPerRowMobile).toBe(count);
        expect(saved.draft.layout.categoriesPerRowMobile).toBe(count);
    }
    await service.publish(admin._id, theme);
    const published = await service.published();
    expect(published.published.brand.logoPath).toBe(theme.brand.logoPath);
    expect(published.published.brand.slides).toEqual(theme.brand.slides);
    expect(published.published.layout).toMatchObject({ productsPerRowMobile: 4, categoriesPerRowMobile: 4 });
    expect(await ThemeHistory.countDocuments()).toBe(1);
    await service.resetToDefault();
    expect((await service.published()).published).toBeNull();
    expect((await ThemeSettings.findOne({ scopeKey: 'main' })).draft).toBeNull();
    expect(await ThemeHistory.countDocuments()).toBe(1);
});

test('reset API requires admin and returns original appearance', async () => {
    const admin = await createAdmin(); const app = require('../app');
    const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
    try {
        const base = `http://127.0.0.1:${server.address().port}/api`;
        const noAuth = await fetch(`${base}/admin/theme/reset-default`, { method: 'POST' });
        expect([401, 403]).toContain(noAuth.status);
        const token = jwt.sign({ id: String(admin._id) }, config.jwt.secret, { expiresIn: '10m' });
        const res = await fetch(`${base}/admin/theme/reset-default`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
        expect(res.status).toBe(200);
        expect((await res.json()).data.published).toBeNull();
        expect((await (await fetch(`${base}/theme/published`)).json()).data.published).toBeNull();
    } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('admin uploads six images, publishes them and reads each uploaded image', async () => {
    const sharp = require('sharp'); const fs = require('fs/promises'); const path = require('path');
    const admin = await createAdmin(); const app = require('../app'); const files = [];
    const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        const token = jwt.sign({ id: String(admin._id) }, config.jwt.secret, { expiresIn: '10m' });
        const headers = { Authorization: `Bearer ${token}` };
        for (let index = 0; index < 6; index++) {
            const buffer = await sharp({ create: { width: 128, height: 128, channels: 3, background: { r: index * 20, g: 30, b: 80 } } }).png().toBuffer();
            const form = new FormData(); form.append('image', new Blob([buffer], { type: 'image/png' }), `theme-${index}.png`);
            const response = await fetch(`${base}/api/admin/theme/media/upload`, { method: 'POST', headers, body: form });
            expect(response.status).toBe(200);
            const uploaded = (await response.json()).data.path; files.push(uploaded);
            expect((await fetch(`${base}${uploaded}`)).status).toBe(200);
        }
        const theme = service.presets()[0].configuration; theme.brand.logoPath = files[0]; theme.brand.slides = files.slice(1);
        const publish = await fetch(`${base}/api/admin/theme/publish`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(theme) });
        expect(publish.status).toBe(200);
        const stored = (await (await fetch(`${base}/api/theme/published`)).json()).data.published;
        expect(stored.brand.logoPath).toBe(files[0]); expect(stored.brand.slides).toEqual(files.slice(1));
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await Promise.all(files.map((name) => fs.unlink(path.join(__dirname, '..', '..', name.replace(/^\/+/, ''))).catch(() => undefined)));
    }
});
