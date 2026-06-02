const axios = require('axios');

const TERMII_BASE = 'https://api.ng.termii.com/api';

async function sendOtp(phone, otp) {
  const { TERMII_API_KEY, TERMII_SENDER_ID } = process.env;

  if (!TERMII_API_KEY) {
    // Dev fallback — log OTP to console
    console.log(`[SMS DEV] OTP for ${phone}: ${otp}`);
    return { success: true, dev: true };
  }

  try {
    const res = await axios.post(`${TERMII_BASE}/sms/send`, {
      to: phone,
      from: TERMII_SENDER_ID || 'BinLink',
      sms: `Your BinLink verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`,
      type: 'plain',
      channel: 'generic',
      api_key: TERMII_API_KEY,
    });

    return { success: true, messageId: res.data?.message_id };
  } catch (err) {
    console.error('[SMS] Termii error:', err.response?.data || err.message);
    throw new Error('Failed to send OTP. Please try again.');
  }
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = { sendOtp, generateOtp };
