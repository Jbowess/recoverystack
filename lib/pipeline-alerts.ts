/**
 * Pipeline failure alerting.
 *
 * Supports Slack webhook and/or a generic webhook URL for notifications.
 * Set SLACK_WEBHOOK_URL and/or ALERT_WEBHOOK_URL env vars to enable.
 */

type AlertPayload = {
  pipeline: string;
  step?: string;
  status: 'failed' | 'warning';
  message: string;
  durationMs?: number;
  timestamp: string;
};

async function sendSlackAlert(payload: AlertPayload) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const emoji = payload.status === 'failed' ? '🔴' : '🟡';
  const stepInfo = payload.step ? ` → step \`${payload.step}\`` : '';
  const duration = payload.durationMs != null ? ` (${(payload.durationMs / 1000).toFixed(1)}s)` : '';

  const text = [
    `${emoji} *Pipeline ${payload.status.toUpperCase()}*: \`${payload.pipeline}\`${stepInfo}${duration}`,
    payload.message,
    `_${payload.timestamp}_`,
  ].join('\n');

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.warn('[alert] Slack notification failed:', err);
  }
}

async function sendGenericWebhookAlert(payload: AlertPayload) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('[alert] Webhook notification failed:', err);
  }
}

export async function sendPipelineAlert(opts: {
  pipeline: string;
  step?: string;
  status: 'failed' | 'warning';
  message: string;
  durationMs?: number;
}) {
  const payload: AlertPayload = {
    ...opts,
    timestamp: new Date().toISOString(),
  };

  await Promise.allSettled([
    sendSlackAlert(payload),
    sendGenericWebhookAlert(payload),
  ]);
}
