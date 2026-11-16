'use strict';

const Visibility = require('./userProductVisibility.model');

async function hiddenProductIds(userId) {
    if (!userId) return [];
    const rows = await Visibility.find({ userId, isHidden: true }).select('productId').lean();
    return rows.map((row) => row.productId);
}

async function isHidden(userId, productId, session = null) {
    if (!userId || !productId) return false;
    let query = Visibility.exists({ userId, productId, isHidden: true });
    if (session) query = query.session(session);
    return Boolean(await query);
}

async function getOverrides(userId) {
    const rows = await Visibility.find({ userId }).lean();
    return new Map(rows.map((row) => [String(row.productId), row]));
}

async function getOverride(userId, productId, session = null) {
    let query = Visibility.findOne({ userId, productId }).lean();
    if (session) query = query.session(session);
    return query;
}

async function hiddenApiProductIds(userId) {
    if (!userId) return [];
    const rows = await Visibility.find({ userId, $or: [{ isHidden: true }, { isHiddenFromApi: true }] }).select('productId').lean();
    return rows.map((row) => row.productId);
}

module.exports = { hiddenProductIds, hiddenApiProductIds, isHidden, getOverrides, getOverride };
