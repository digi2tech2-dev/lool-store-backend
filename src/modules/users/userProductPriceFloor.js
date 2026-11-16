'use strict';

const Decimal = require('decimal.js');
const { computeMarkup } = require('../../shared/utils/decimalPrecision');

// providerPrice is the most recent supplier-price snapshot used by the catalog.
function getPriceFloorError(product, price) {
    if (price == null || !product?.provider) return null;
    let floor;
    try {
        if (product.providerPrice == null || String(product.providerPrice).trim() === '') return 'SUPPLIER_PRICE_UNAVAILABLE';
        floor = new Decimal(String(product.providerPrice));
        if (!floor.isFinite() || floor.lte(0)) return 'SUPPLIER_PRICE_UNAVAILABLE';
        const amount = new Decimal(String(price));
        if (!amount.isFinite() || amount.lte(0)) return 'INVALID_CUSTOM_PRICE';
        return amount.lt(floor) ? 'CUSTOM_PRICE_BELOW_SUPPLIER' : null;
    } catch {
        return 'SUPPLIER_PRICE_UNAVAILABLE';
    }
}

// A saved custom price remains unchanged; when supplier cost rises above it,
// the effective price follows the supplier plus the customer's group markup.
function resolveCustomPrice(product, price, percentage) {
    if (price == null) return { price: null, usingSupplierPrice: false };
    const error = getPriceFloorError(product, price);
    if (error === 'CUSTOM_PRICE_BELOW_SUPPLIER') {
        return { price: computeMarkup(product.providerPrice, 'percentage', percentage), usingSupplierPrice: true };
    }
    return { price, usingSupplierPrice: false, error };
}

module.exports = { getPriceFloorError, resolveCustomPrice };
