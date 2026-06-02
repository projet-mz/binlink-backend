const axios = require('axios');
const crypto = require('crypto');

const PAYSTACK_BASE = 'https://api.paystack.co';

function paystackHeaders() {
  return {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

// Channel map: our enum → Paystack channel string
const CHANNEL_MAP = {
  MTN_MOMO: 'mobile_money',
  VODAFONE_CASH: 'mobile_money',
  AIRTELTIGO: 'mobile_money',
  CASH: null,
};

// Provider map for Ghana MoMo
const PROVIDER_MAP = {
  MTN_MOMO: 'mtn',
  VODAFONE_CASH: 'vod',
  AIRTELTIGO: 'atl',
};

async function initiateCharge({ amount, phone, email, paymentMethod, bookingId }) {
  if (paymentMethod === 'CASH') {
    return { success: true, cash: true };
  }

  try {
    const res = await axios.post(
      `${PAYSTACK_BASE}/charge`,
      {
        amount: Math.round(amount * 100), // Paystack uses pesewas
        currency: 'GHS',
        email: email || `${phone}@binlink.app`,
        mobile_money: {
          phone,
          provider: PROVIDER_MAP[paymentMethod],
        },
        metadata: { bookingId },
        reference: `BL-${bookingId}-${Date.now()}`,
      },
      { headers: paystackHeaders() }
    );

    const data = res.data.data;
    return {
      success: true,
      reference: data.reference,
      status: data.status,
      displayText: data.display_text,
    };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error('[Paystack] Charge error:', msg);
    throw new Error(msg || 'Payment initiation failed');
  }
}

async function verifyTransaction(reference) {
  try {
    const res = await axios.get(
      `${PAYSTACK_BASE}/transaction/verify/${reference}`,
      { headers: paystackHeaders() }
    );
    const data = res.data.data;
    return {
      success: data.status === 'success',
      amount: data.amount / 100,
      reference: data.reference,
      status: data.status,
    };
  } catch (err) {
    console.error('[Paystack] Verify error:', err.message);
    return { success: false };
  }
}

function verifyWebhookSignature(rawBody, signature) {
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return hash === signature;
}

module.exports = { initiateCharge, verifyTransaction, verifyWebhookSignature };
