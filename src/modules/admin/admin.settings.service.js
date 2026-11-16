'use strict';

/**
 * admin.settings.service.js
 *
 * CRUD over the Setting collection.
 * Only admins can write. Reads can be used internally.
 */

const { Setting } = require('./setting.model');
const { NotFoundError, ValidationError, ConflictError } = require('../../shared/errors/AppError');
const { createAuditLog } = require('../audit/audit.service');
const { ADMIN_ACTIONS, ENTITY_TYPES, ACTOR_ROLES } = require('../audit/audit.constants');
const settingsCache = require('./settings.cache');

const PAYMENT_SETTING_KEYS = new Set([
    'paymentGroups',
    'paymentCountryAccounts',
    'paymentInstructions',
    'whatsappNumber',
    'supportContacts',
]);

// ─── List ──────────────────────────────────────────────────────────────────────

const listSettings = async () => {
    return Setting.find().sort({ key: 1 }).select('-__v');
};

// ─── Get One ──────────────────────────────────────────────────────────────────

const getSettingByKey = async (key) => {
    const setting = await Setting.findOne({ key });
    if (!setting) throw new NotFoundError('Setting');
    return setting;
};

// ─── Get value (internal use) ─────────────────────────────────────────────────

const getSettingValue = async (key, defaultValue = null) => {
    const setting = await Setting.findOne({ key }).lean();
    return setting ? setting.value : defaultValue;
};

const getPaymentSettings = async () => {
    const cacheKey = settingsCache.SETTINGS_CACHE_KEYS.paymentGroups;
    const cached = settingsCache.get(cacheKey);
    if (cached) return cached;

    const keys = [...PAYMENT_SETTING_KEYS];
    const settings = await Setting.find({ key: { $in: keys } }).lean();
    const find = (key) => settings.find((s) => s.key === key)?.value;

    const paymentGroups = (find('paymentGroups') || [])
        .filter((g) => g.isActive !== false)
        .map((g) => ({
            ...g,
            methods: (g.methods || []).filter((m) => m.isActive !== false),
        }))
        .filter((g) => g.methods && g.methods.length > 0);

    const payload = {
        paymentGroups,
        countryAccounts: find('paymentCountryAccounts') || [],
        instructions: find('paymentInstructions') || '',
        whatsappNumber: find('whatsappNumber') || '',
        supportContacts: find('supportContacts') || { owner: '', support: '', entries: [], revision: 0 },
    };

    return settingsCache.set(cacheKey, payload);
};

const invalidateSettingsCache = (key) => {
    if (!key) {
        settingsCache.clear();
        return;
    }

    if (PAYMENT_SETTING_KEYS.has(key)) {
        settingsCache.del(settingsCache.SETTINGS_CACHE_KEYS.paymentGroups);
    }
};

// ─── Update ───────────────────────────────────────────────────────────────────

const updateSetting = async (key, value, adminId) => {
    const normalizePhone = (input) => {
        const phone = String(input || '').trim();
        if (!phone) return '';
        if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new ValidationError('Enter a WhatsApp number with country code, such as +201234567890.');
        return phone;
    };
    if (key === 'adminNotificationWhatsApp') {
        value = normalizePhone(value);
    }
    if (key === 'supportContacts') {
        if (!value || !Array.isArray(value.entries) || value.entries.length > 30
            || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new ValidationError('Invalid contact list.');
        const ids = new Set();
        const entries = value.entries.map((entry) => {
            const id = String(entry?.id || '').trim();
            const name = String(entry?.name || '').trim();
            const role = String(entry?.role || '').trim();
            if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id) || !name || name.length > 80 || !role || role.length > 80) {
                throw new ValidationError('Each contact needs a unique ID, name, role and valid WhatsApp number.');
            }
            ids.add(id);
            const number = normalizePhone(entry.number);
            if (!number) throw new ValidationError('Each contact needs a valid WhatsApp number.');
            return { id, name, role, number };
        });
        const nextValue = { entries, revision: value.revision + 1, owner: entries[0]?.number || '', support: entries[1]?.number || '' };
        const filter = value.revision === 0
            ? { key, $or: [{ 'value.revision': 0 }, { 'value.revision': { $exists: false } }] }
            : { key, 'value.revision': value.revision };
        const updated = await Setting.findOneAndUpdate(filter, { $set: { value: nextValue, updatedBy: adminId } }, { new: true });
        if (!updated) throw new ConflictError('Contacts changed. Reload before saving.');
        invalidateSettingsCache(key);
        createAuditLog({ actorId: adminId, actorRole: ACTOR_ROLES.ADMIN, action: ADMIN_ACTIONS.SETTING_UPDATED,
            entityType: ENTITY_TYPES.SETTING, entityId: updated._id, metadata: { key, before: '[REDACTED]', after: '[REDACTED]' } });
        return updated;
    }
    let setting = await Setting.findOne({ key });
    if (!setting) throw new NotFoundError('Setting');

    const before = setting.value;

    // Mongoose does not detect mutations to Mixed-type fields.
    // Without markModified(), `.save()` silently skips the write.
    setting.value = value;
    setting.updatedBy = adminId;
    setting.markModified('value');
    await setting.save();

    invalidateSettingsCache(key);

    const sensitiveValue = key === 'adminNotificationWhatsApp';
    createAuditLog({
        actorId: adminId,
        actorRole: ACTOR_ROLES.ADMIN,
        action: ADMIN_ACTIONS.SETTING_UPDATED,
        entityType: ENTITY_TYPES.SETTING,
        entityId: setting._id,
        metadata: { key, before: sensitiveValue ? '[REDACTED]' : before, after: sensitiveValue ? '[REDACTED]' : value },
    });

    return setting;
};

module.exports = {
    listSettings,
    getSettingByKey,
    getSettingValue,
    getPaymentSettings,
    invalidateSettingsCache,
    updateSetting,
};
