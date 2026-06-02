const { getFirebaseApp, admin } = require('../config/firebase');

async function sendPush({ token, title, body, data = {} }) {
  const app = getFirebaseApp();
  if (!app || !token) return;

  try {
    await admin.messaging().send({
      token,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'binlink_default',
        },
      },
    });
  } catch (err) {
    console.error('[FCM] Push failed:', err.message);
  }
}

async function sendToMultiple(tokens, payload) {
  if (!tokens.length) return;
  await Promise.allSettled(tokens.map((t) => sendPush({ token: t, ...payload })));
}

module.exports = { sendPush, sendToMultiple };
