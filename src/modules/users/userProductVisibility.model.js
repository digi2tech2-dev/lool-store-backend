'use strict';

const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    isHidden: { type: Boolean, default: false },
    isHiddenFromApi: { type: Boolean, default: false },
    priceOverride: { type: String, default: null, trim: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
schema.index({ userId: 1, productId: 1 }, { unique: true });
module.exports = mongoose.models.UserProductOverride || mongoose.model('UserProductOverride', schema);
