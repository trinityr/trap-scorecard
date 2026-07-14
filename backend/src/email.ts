import nodemailer from "nodemailer";
import { getSetting } from "./settings";

// Thin wrapper around Nodemailer using DB-backed (Admin > App settings)
// SMTP config, same pattern as the Anthropic API key and Google Client ID —
// falls back to env vars, and is entirely optional: if nothing is
// configured, sendMail() just logs and no-ops instead of throwing, so
// features that trigger email (like pending team-join alerts) degrade
// gracefully rather than breaking the request that triggered them.

async function getSmtpConfig() {
  const host = await getSetting("smtp_host", process.env.SMTP_HOST);
  const port = await getSetting("smtp_port", process.env.SMTP_PORT);
  const user = await getSetting("smtp_user", process.env.SMTP_USER);
  const pass = await getSetting("smtp_pass", process.env.SMTP_PASS);
  const from = await getSetting("smtp_from", process.env.SMTP_FROM);
  if (!host || !port || !from) return null;
  return { host, port: Number(port), user, pass, from };
}

export async function isEmailConfigured(): Promise<boolean> {
  return (await getSmtpConfig()) !== null;
}

export async function sendMail(to: string | string[], subject: string, text: string, html?: string): Promise<void> {
  const config = await getSmtpConfig();
  if (!config) {
    console.warn(`[email] SMTP isn't configured yet (Admin > App settings) — skipped sending "${subject}" to ${Array.isArray(to) ? to.join(", ") : to}.`);
    return;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    });
    await transporter.sendMail({
      from: config.from,
      to: Array.isArray(to) ? to.join(", ") : to,
      subject,
      text,
      html,
    });
  } catch (err) {
    // Never let an email failure break the request that triggered it (e.g.
    // a registration or team-join) — just log it for the admin to notice.
    console.error(`[email] Failed to send "${subject}" to ${Array.isArray(to) ? to.join(", ") : to}:`, err);
  }
}
