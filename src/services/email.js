const nodemailer = require('nodemailer');
const path = require('path');

/**
 * Outbound email service (Gmail SMTP).
 *
 * Templates and fixed email copy are English-only. User-provided content is
 * preserved as submitted. Recipients without an email are skipped by callers.
 *
 * Credentials come from the environment (see server/.env):
 *   MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS, MAIL_FROM
 * MAIL_PASS is a Gmail App Password (16 chars, no spaces).
 */

const MAIL_HOST = process.env.MAIL_HOST || 'smtp.gmail.com';
const MAIL_PORT = parseInt(process.env.MAIL_PORT || '587', 10);
const MAIL_USER = process.env.MAIL_USER || '';
const MAIL_PASS = process.env.MAIL_PASS || '';
const MAIL_FROM =
  process.env.MAIL_FROM || 'Real English Academy <noreply.realenglishacademy@gmail.com>';

/**
 * Frontend base URL for all links inside emails.
 * Read from FRONTEND_URL (preferred) or APP_BASE_URL, trailing slashes stripped.
 */
function frontendUrl() {
  const configured = (process.env.FRONTEND_URL || process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  if (configured) return configured;
  return 'http://localhost:3000';
}

const BRAND_INLINE_IMAGES = [
  {
    filename: 'REALLogo1.png',
    path: path.join(__dirname, '..', '..', 'brand', 'REALLogo1.png'),
    cid: 'academy-logo@realenglishacademy',
    contentDisposition: 'inline',
  },
];

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: MAIL_HOST,
      port: MAIL_PORT,
      secure: MAIL_PORT === 465,
      auth: MAIL_USER ? { user: MAIL_USER, pass: MAIL_PASS } : undefined,
    });
  }
  return transporter;
}

function isConfigured() {
  return Boolean(MAIL_USER && MAIL_PASS);
}

// ─── Shared English-only layout ──────────────────────────────────────────────

const BRAND = {
  primary: '#1a5276',
  accent: '#2e86c1',
  text: '#333333',
  muted: '#888888',
  bg: '#f4f1f1',
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateLong(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatTimeRange(startTime, endTime) {
  return [startTime, endTime].filter(Boolean).join(' – ');
}

/**
 * Builds the full HTML document using the same academy header for every email.
 *
 * @param {object} opts
 * @param {string} opts.subjectEn - English subject line
 * @param {string} opts.titleEn - English title shown in the banner
 * @param {string} opts.bodyEn - English body HTML (inside the content cell)
 * @param {{labelEn: string, href: string}} [opts.cta] - optional CTA button
 * @param {string} [opts.footerNoteEn] - small note under the CTA (English)
 */
function buildLayout({
  subjectEn,
  titleEn,
  bodyEn,
  cta,
  footerNoteEn,
}) {
  const ctaBlock = cta
    ? `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center">
                <a href="${esc(cta.href)}"
                   style="display:inline-block;background:${BRAND.primary};color:#ffffff;text-decoration:none;
                          padding:14px 36px;border-radius:8px;font-size:16px;font-weight:600;">
                  ${esc(cta.labelEn)}
                </a>
              </td>
            </tr>
          </table>
          <p style="color:${BRAND.muted};font-size:13px;line-height:1.5;margin:20px 0 0;">
            If the button doesn't work, copy and paste this link into your browser:<br />
            <a href="${esc(cta.href)}" style="color:${BRAND.accent};word-break:break-all;">${esc(cta.href)}</a>
          </p>`
    : '';

  const noteEn = footerNoteEn
    ? `<p style="color:#999;font-size:12px;line-height:1.5;margin:16px 0 0;">${footerNoteEn}</p>`
    : '';

  const bannerHeading = `
              <h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:700;line-height:1.3;">${esc(titleEn)}</h1>
              <img src="cid:academy-logo@realenglishacademy" alt="Real English Academy" height="96"
                   style="display:block;border:0;background:transparent;margin:16px auto 0;" />`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(subjectEn)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

          <!-- Banner / Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND.primary} 0%,${BRAND.accent} 100%);padding:36px 32px;text-align:center;">
              ${bannerHeading}
            </td>
          </tr>

          <!-- English section -->
          <tr>
            <td style="padding:36px 32px 8px;">
              ${bodyEn}
              ${ctaBlock}
              ${noteEn}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8f9fa;padding:20px 32px;text-align:center;">
              <p style="color:#999;font-size:12px;margin:0;">
                &copy; ${new Date().getFullYear()} Real English Academy. All rights reserved.
              </p>
              <p style="color:#bbb;font-size:11px;margin:6px 0 0;">
                This is an automated message — please do not reply.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Core send helper. Returns { sent: true } or { sent: false, reason }.
 * The logo is embedded inline in the HTML, not sent as a regular attachment.
 */
async function sendMail(toEmail, subject, html, text, replyTo) {
  if (!isConfigured()) {
    console.warn(`[email] SMTP not configured (MAIL_USER/MAIL_PASS empty). Skipping send to ${toEmail}`);
    return { sent: false, reason: 'smtp_not_configured' };
  }
  try {
    await getTransporter().sendMail({
      from: MAIL_FROM,
      to: toEmail,
      subject,
      html,
      text: text || '',
      ...(replyTo ? { replyTo } : {}),
      attachments: BRAND_INLINE_IMAGES,
    });
    return { sent: true };
  } catch (err) {
    console.error(`[email] Send error to ${toEmail}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

// ─── 1. Invitation ───────────────────────────────────────────────────────────

/**
 * Sends an invitation email (teacher or student).
 * @param {string} toEmail
 * @param {'TEACHER'|'STUDENT'} role
 * @param {string} inviteUrl - full URL with token
 */
async function sendInviteEmail(toEmail, role, inviteUrl) {
  const roleLabel = role === 'TEACHER' ? 'Teacher' : 'Student';
  const html = buildLayout({
    subjectEn: `You're invited to Real English Academy`,
    titleEn: 'Welcome to Real English Academy',
    bodyEn: `
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">Hello,</p>
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">
                You have been invited to join <strong>Real English Academy</strong> as a
                <strong style="color:${BRAND.primary};">${roleLabel}</strong>.
              </p>
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 28px;">
                Please use the button below to complete your profile and get started.
                This link is <strong>single-use</strong> and will expire in 7 days.
              </p>`,
    cta: { labelEn: 'Complete Your Profile', href: inviteUrl },
  });
  const text = [
    `You're invited to Real English Academy`,
    ``,
    `Hello,`,
    `You have been invited to join Real English Academy as a ${roleLabel}.`,
    `Please use the link below to complete your profile and get started.`,
    `This link is single-use and will expire in 7 days.`,
    ``,
    `Complete Your Profile: ${inviteUrl}`,
  ].join('\n');
  return sendMail(toEmail, `You're invited to Real English Academy`, html, text);
}

// ─── 2. Video call ───────────────────────────────────────────────────────────

/**
 * Sends a video call invitation email.
 * @param {string} toEmail
 * @param {object} opts - { title, description?, startDate, startTime, endTime, roomUrl, hostName }
 */
async function sendVideoCallEmail(toEmail, opts) {
  const { title, description, startDate, startTime, endTime, roomUrl, hostName } = opts;
  const dateLabel = formatDateLong(startDate);
  const timeLabel = formatTimeRange(startTime, endTime);
  const hostLine = hostName
    ? `<strong>${esc(hostName)}</strong> has scheduled a video call with you:`
    : 'A video call has been scheduled for you:';

  const detailsTable = (dateL) => `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                     style="background:#f8f9fa;border-radius:8px;padding:20px 24px;margin:0 0 28px;">
                <tr>
                  <td style="padding:4px 0;color:${BRAND.muted};font-size:13px;width:110px;">Call</td>
                  <td style="padding:4px 0;color:${BRAND.primary};font-size:15px;font-weight:600;">${esc(title || 'Video Call')}</td>
                </tr>
                ${description ? `<tr><td style="padding:4px 0;color:${BRAND.muted};font-size:13px;width:110px;">Details</td><td style="padding:4px 0;color:${BRAND.text};font-size:14px;">${esc(description)}</td></tr>` : ''}
                ${dateL ? `<tr><td style="padding:4px 0;color:${BRAND.muted};font-size:13px;width:110px;">Date</td><td style="padding:4px 0;color:${BRAND.text};font-size:14px;">${esc(dateL)}</td></tr>` : ''}
                ${timeLabel ? `<tr><td style="padding:4px 0;color:${BRAND.muted};font-size:13px;width:110px;">Time</td><td style="padding:4px 0;color:${BRAND.text};font-size:14px;">${esc(timeLabel)}</td></tr>` : ''}
              </table>`;

  const html = buildLayout({
    subjectEn: `📹 Video Call: ${title || 'Real English'}`,
    titleEn: 'Video Call Invitation',
    bodyEn: `
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">Hello,</p>
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 24px;">${hostLine}</p>
              ${detailsTable(dateLabel)}`,
    cta: { labelEn: 'Join Video Call', href: roomUrl },
    footerNoteEn: 'You will need to sign in with your Real English account to join the call.',
  });
  const text = [
    `Video Call: ${title || 'Real English'}`,
    ``,
    `Hello,`,
    hostName ? `${hostName} has scheduled a video call with you:` : `A video call has been scheduled for you:`,
    ``,
    `Call: ${title || 'Video Call'}`,
    description ? `Details: ${description}` : null,
    dateLabel ? `Date: ${dateLabel}` : null,
    timeLabel ? `Time: ${timeLabel}` : null,
    ``,
    `Join Video Call: ${roomUrl}`,
    `You will need to sign in with your Real English account to join the call.`,
  ].filter(Boolean).join('\n');
  return sendMail(toEmail, `📹 Video Call: ${title || 'Real English'}`, html, text);
}

// ─── 3. Calendar event (lesson / in-person call / any type) ─────────────────

/**
 * Sends a calendar event notification email (lesson, in-person call, etc.).
 * @param {string} toEmail
 * @param {object} opts - { title, description?, type ('LESSON'|'CALL'), mode ('VIDEO'|'IN_PERSON'),
 *                          startDate, startTime, endTime, isRecurring, endDate, daysOfWeek, hostName }
 */
async function sendCalendarEventEmail(toEmail, opts) {
  const {
    title, description, type, mode, startDate, startTime, endTime,
    isRecurring, endDate, daysOfWeek, hostName,
  } = opts;

  const typeLabel = type === 'CALL' ? 'Call' : 'Lesson';
  const modeLabel = mode === 'IN_PERSON' ? 'In person' : 'Online (video)';

  const weekdayNamesEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  let whenEn;
  if (isRecurring) {
    const days = (daysOfWeek || []).map((d) => weekdayNamesEn[d]).join(', ');
    const range = `${formatDateLong(startDate)} to ${formatDateLong(endDate)}`;
    whenEn = `Recurring: ${days}, ${range}`;
  } else {
    whenEn = `${formatDateLong(startDate)}${startTime ? `, ${formatTimeRange(startTime, endTime)}` : ''}`;
  }

  const hostLine = hostName
    ? `<strong>${esc(hostName)}</strong> has scheduled a ${typeLabel.toLowerCase()} for you:`
    : `A ${typeLabel.toLowerCase()} has been scheduled for you:`;

  const detailsTable = (whenLabel) => `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                     style="background:#f8f9fa;border-radius:8px;padding:20px 24px;margin:0 0 28px;">
                <tr>
                  <td style="padding:4px 0;color:${BRAND.muted};font-size:13px;width:110px;">${typeLabel}</td>
                  <td style="padding:4px 0;color:${BRAND.primary};font-size:15px;font-weight:600;">${esc(title)}</td>
                </tr>
                ${description ? `<tr><td style="padding:4px 0;color:${BRAND.muted};font-size:13px;width:110px;">Details</td><td style="padding:4px 0;color:${BRAND.text};font-size:14px;">${esc(description)}</td></tr>` : ''}
                <tr><td style="padding:4px 0;color:${BRAND.muted};font-size:13px;width:110px;">Mode</td><td style="padding:4px 0;color:${BRAND.text};font-size:14px;">${modeLabel}</td></tr>
                <tr><td style="padding:4px 0;color:${BRAND.muted};font-size:13px;width:110px;">When</td><td style="padding:4px 0;color:${BRAND.text};font-size:14px;">${esc(whenLabel)}</td></tr>
              </table>`;

  const html = buildLayout({
    subjectEn: `📅 ${typeLabel}: ${title}`,
    titleEn: `${typeLabel} Scheduled`,
    bodyEn: `
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">Hello,</p>
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 24px;">${hostLine}</p>
              ${detailsTable(whenEn)}`,
    cta: { labelEn: 'Open Calendar', href: `${frontendUrl()}/calendar` },
    footerNoteEn: 'Sign in to view the full details in your calendar.',
  });
  const text = [
    `${typeLabel}: ${title}`,
    ``,
    `Hello,`,
    hostName ? `${hostName} has scheduled a ${typeLabel.toLowerCase()} for you:` : `A ${typeLabel.toLowerCase()} has been scheduled for you:`,
    ``,
    `Title: ${title}`,
    description ? `Details: ${description}` : null,
    `Mode: ${modeLabel}`,
    `When: ${whenEn}`,
    ``,
    `Open Calendar: ${frontendUrl()}/calendar`,
  ].filter(Boolean).join('\n');
  return sendMail(toEmail, `📅 ${typeLabel}: ${title}`, html, text);
}

// ─── 4. Welcome (new registration) ──────────────────────────────────────────

/**
 * Sends the welcome email after a successful registration.
 * @param {string} toEmail
 * @param {object} user - { firstName, lastName, username, role }
 */
async function sendWelcomeEmail(toEmail, user) {
  const firstName = user.firstName || user.username;
  const roleLabel = user.role === 'TEACHER' ? 'Teacher' : 'Student';
  const html = buildLayout({
    subjectEn: `Welcome to Real English Academy, ${firstName}!`,
    titleEn: 'Welcome to Real English Academy',
    bodyEn: `
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">Dear ${esc(firstName)},</p>
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">
                Your account has been created successfully. You are now a
                <strong style="color:${BRAND.primary};">${roleLabel}</strong> at
                <strong>Real English Academy</strong>.
              </p>
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 28px;">
                We're delighted to have you with us. Log in to start learning,
                complete your daily quizzes, and join the community.
              </p>`,
    cta: { labelEn: 'Log In', href: `${frontendUrl()}/login` },
  });
  const text = [
    `Welcome to Real English Academy, ${firstName}!`,
    ``,
    `Dear ${firstName},`,
    `Your account has been created successfully. You are now a ${roleLabel} at Real English Academy.`,
    `We're delighted to have you with us. Log in to start learning, complete your daily quizzes, and join the community.`,
    ``,
    `Log In: ${frontendUrl()}/login`,
  ].join('\n');
  return sendMail(toEmail, `Welcome to Real English Academy, ${firstName}!`, html, text);
}

// ─── 5. Daily quiz reminder ──────────────────────────────────────────────────

/**
 * Sends the daily quiz reminder email.
 * @param {string} toEmail
 * @param {object} user - { firstName, username }
 */
async function sendDailyQuizEmail(toEmail, user) {
  const firstName = user.firstName || user.username;
  const todayEn = formatDateLong(new Date());
  const html = buildLayout({
    subjectEn: 'Your Daily Quiz is Ready 📝',
    titleEn: 'Daily Quiz',
    bodyEn: `
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">Hello ${esc(firstName)},</p>
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">
                Your daily quiz for <strong>${esc(todayEn)}</strong> is ready.
              </p>
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 28px;">
                Answer <strong>10 questions</strong> (5 easy, 3 medium, 2 hard) to earn
                <strong>daily points</strong> and keep your streak alive. It only takes a few minutes!
              </p>`,
    cta: { labelEn: 'Start Daily Quiz', href: `${frontendUrl()}/quiz` },
  });
  const text = [
    `Your Daily Quiz is Ready`,
    ``,
    `Hello ${firstName},`,
    `Your daily quiz for ${todayEn} is ready.`,
    `Answer 10 questions (5 easy, 3 medium, 2 hard) to earn daily points and keep your streak alive. It only takes a few minutes!`,
    ``,
    `Start Daily Quiz: ${frontendUrl()}/quiz`,
  ].join('\n');
  return sendMail(toEmail, 'Your Daily Quiz is Ready 📝', html, text);
}

// ─── 6. Weekly quiz reminder ─────────────────────────────────────────────────

/**
 * Sends the weekly quiz reminder email (Fridays).
 * @param {string} toEmail
 * @param {object} user - { firstName, username }
 */
async function sendWeeklyQuizEmail(toEmail, user) {
  const firstName = user.firstName || user.username;
  const todayEn = formatDateLong(new Date());
  const html = buildLayout({
    subjectEn: 'Your Weekly Quiz is Ready 🏆',
    titleEn: 'Weekly Quiz',
    bodyEn: `
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">Hello ${esc(firstName)},</p>
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">
                It's Friday! Your weekly quiz for the week of <strong>${esc(todayEn)}</strong> is ready.
              </p>
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 28px;">
                Answer <strong>12 questions</strong> (4 easy, 4 medium, 4 hard) to earn
                <strong>weekly points</strong> and climb the weekly leaderboard.
                Good luck!
              </p>`,
    cta: { labelEn: 'Start Weekly Quiz', href: `${frontendUrl()}/quiz` },
  });
  const text = [
    `Your Weekly Quiz is Ready`,
    ``,
    `Hello ${firstName},`,
    `It's Friday! Your weekly quiz for the week of ${todayEn} is ready.`,
    `Answer 12 questions (4 easy, 4 medium, 4 hard) to earn weekly points and climb the weekly leaderboard. Good luck!`,
    ``,
    `Start Weekly Quiz: ${frontendUrl()}/quiz`,
  ].join('\n');
  return sendMail(toEmail, 'Your Weekly Quiz is Ready 🏆', html, text);
}

// ─── 7. Tournament ───────────────────────────────────────────────────────────

/**
 * Sends the tournament announcement email to a participant.
 * @param {string} toEmail
 * @param {object} opts - { name, scheduledAt, durationMin, finalDurationMin, organizerName }
 */
async function sendTournamentEmail(toEmail, opts) {
  const { name, scheduledAt, durationMin, finalDurationMin, organizerName } = opts;
  const whenEn = `${formatDateLong(scheduledAt)}, ${new Date(scheduledAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  const orgLine = organizerName
    ? `organized by <strong>${esc(organizerName)}</strong>`
    : 'organized by the Real English Academy team';

  const detailsTable = (when) => `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                     style="background:#f8f9fa;border-radius:8px;padding:20px 24px;margin:0 0 28px;">
                <tr>
                  <td style="padding:4px 0;color:${BRAND.muted};font-size:13px;width:110px;">Tournament</td>
                  <td style="padding:4px 0;color:${BRAND.primary};font-size:15px;font-weight:600;">${esc(name)}</td>
                </tr>
                <tr><td style="padding:4px 0;color:${BRAND.muted};font-size:13px;width:110px;">Starts</td><td style="padding:4px 0;color:${BRAND.text};font-size:14px;">${esc(when)}</td></tr>
                <tr><td style="padding:4px 0;color:${BRAND.muted};font-size:13px;width:110px;">Rounds</td><td style="padding:4px 0;color:${BRAND.text};font-size:14px;">20 questions · ${durationMin} min</td></tr>
                <tr><td style="padding:4px 0;color:${BRAND.muted};font-size:13px;width:110px;">Final</td><td style="padding:4px 0;color:${BRAND.text};font-size:14px;">30 questions · ${finalDurationMin} min</td></tr>
              </table>`;

  const html = buildLayout({
    subjectEn: `🏅 Tournament: ${name}`,
    titleEn: 'You are in a Tournament!',
    bodyEn: `
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">Hello,</p>
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 24px;">
                You have been selected to take part in the tournament
                <strong style="color:${BRAND.primary};">${esc(name)}</strong>, ${orgLine}.
              </p>
              ${detailsTable(whenEn)}
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 28px;">
                Make sure you are logged in and ready when the tournament starts. Good luck!
              </p>`,
    cta: { labelEn: 'View Tournament', href: `${frontendUrl()}/tournaments` },
  });
  const text = [
    `Tournament: ${name}`,
    ``,
    `Hello,`,
    `You have been selected to take part in the tournament ${name}, ${organizerName ? `organized by ${organizerName}` : 'organized by the Real English Academy team'}.`,
    ``,
    `Starts: ${whenEn}`,
    `Rounds: 20 questions · ${durationMin} min`,
    `Final: 30 questions · ${finalDurationMin} min`,
    ``,
    `Make sure you are logged in and ready when the tournament starts. Good luck!`,
    ``,
    `View Tournament: ${frontendUrl()}/tournaments`,
  ].join('\n');
  return sendMail(toEmail, `🏅 Tournament: ${name}`, html, text);
}

/**
 * Sends a tournament "starts soon" reminder email to a participant.
 * @param {string} toEmail
 * @param {object} opts - { name, scheduledAt, durationMin, finalDurationMin }
 */
async function sendTournamentReminderEmail(toEmail, opts) {
  const { name, scheduledAt, durationMin, finalDurationMin } = opts;
  const whenEn = `${formatDateLong(scheduledAt)}, ${new Date(scheduledAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  const html = buildLayout({
    subjectEn: `⏰ Tournament starts soon: ${name}`,
    titleEn: 'Your Tournament Starts Soon!',
    bodyEn: `
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">Hello,</p>
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">
                The tournament <strong style="color:${BRAND.primary};">${esc(name)}</strong>
                starts in about <strong>1 hour</strong>.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                     style="background:#f8f9fa;border-radius:8px;padding:20px 24px;margin:0 0 28px;">
                <tr>
                  <td style="padding:4px 0;color:${BRAND.muted};font-size:13px;width:110px;">Starts</td>
                  <td style="padding:4px 0;color:${BRAND.text};font-size:14px;">${esc(whenEn)}</td>
                </tr>
                <tr><td style="padding:4px 0;color:${BRAND.muted};font-size:13px;width:110px;">Rounds</td><td style="padding:4px 0;color:${BRAND.text};font-size:14px;">20 questions · ${durationMin} min</td></tr>
                <tr><td style="padding:4px 0;color:${BRAND.muted};font-size:13px;width:110px;">Final</td><td style="padding:4px 0;color:${BRAND.text};font-size:14px;">30 questions · ${finalDurationMin} min</td></tr>
              </table>
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 28px;">
                Make sure you are logged in and ready when it starts. Good luck!
              </p>`,
    cta: { labelEn: 'Go to Tournament', href: `${frontendUrl()}/tournaments` },
  });
  const text = [
    `Tournament starts soon: ${name}`,
    ``,
    `Hello,`,
    `The tournament ${name} starts in about 1 hour.`,
    ``,
    `Starts: ${whenEn}`,
    `Rounds: 20 questions · ${durationMin} min`,
    `Final: 30 questions · ${finalDurationMin} min`,
    ``,
    `Make sure you are logged in and ready when it starts. Good luck!`,
    ``,
    `Go to Tournament: ${frontendUrl()}/tournaments`,
  ].join('\n');
  return sendMail(toEmail, `⏰ Tournament starts soon: ${name}`, html, text);
}

// ─── Contact form ─────────────────────────────────────────────────────────────

const CONTACT_INBOX = process.env.CONTACT_INBOX || 'realenglished@gmail.com';

/**
 * Renders the visitor's details as a definition list, shared by both
 * contact emails (staff notification + user confirmation).
 */
function contactDetailsHtml({ firstName, lastName, email, phone, subject, message }) {
  const rows = [
    ['Name', esc(firstName)],
    ['Last name', esc(lastName || '-')],
    ['Email', `<a href="mailto:${esc(email)}" style="color:${BRAND.accent};">${esc(email)}</a>`],
    ['Phone', esc(phone)],
    ['Subject', esc(subject)],
  ];
  const rowsHtml = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 12px 8px 0;vertical-align:top;color:${BRAND.muted};font-size:14px;white-space:nowrap;">${label}</td>
          <td style="padding:8px 0;vertical-align:top;color:${BRAND.text};font-size:14px;">${value}</td>
        </tr>`
    )
    .join('');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#f8f9fa;border:1px solid #e5e5e5;border-radius:8px;margin:0 0 16px;">
      ${rowsHtml}
    </table>
    <p style="color:${BRAND.muted};font-size:14px;margin:0 0 6px;font-weight:600;">Message</p>
    <div style="background:#f8f9fa;border:1px solid #e5e5e5;border-radius:8px;padding:14px 16px;
                color:${BRAND.text};font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word;">
      ${esc(message)}
    </div>`;
}

function contactDetailsText({ firstName, lastName, email, phone, subject, message }) {
  return [
    `Name: ${firstName}`,
    `Last name: ${lastName || '-'}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    `Subject: ${subject}`,
    ``,
    `Message:`,
    message,
  ].join('\n');
}

/**
 * A. Staff notification: a new contact-form message, sent to the school
 * inbox with replyTo set to the visitor's email so we can reply directly.
 */
async function sendContactNotificationEmail({ firstName, lastName, email, phone, subject, message }) {
  const details = contactDetailsHtml({ firstName, lastName, email, phone, subject, message });
  const html = buildLayout({
    subjectEn: `[New Contact Message] ${subject}`,
    titleEn: 'New Contact Message',
    bodyEn: `
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">
                A visitor sent a message through the website contact form.
                Reply directly — the visitor's email is set as the reply address.
              </p>
              ${details}`,
  });
  const text = [
    `[New Contact Message] ${subject}`,
    ``,
    `A visitor sent a message through the website contact form.`,
    ``,
    contactDetailsText({ firstName, lastName, email, phone, subject, message }),
  ].join('\n');
  return sendMail(CONTACT_INBOX, `[New Contact Message] ${subject}`, html, text, email);
}

/**
 * B. User confirmation: sent back to the visitor with a friendly
 * acknowledgement and a summary of what they submitted.
 */
async function sendContactConfirmationEmail({ firstName, lastName, email, phone, subject, message }) {
  const details = contactDetailsHtml({ firstName, lastName, email, phone, subject, message });
  const html = buildLayout({
    subjectEn: `We received your message - ${subject}`,
    titleEn: 'Thank you for reaching out!',
    bodyEn: `
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">
                Dear ${esc(firstName)},
              </p>
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">
                Thank you for contacting <strong>Real English Academy</strong>.
                Your message has been received successfully and we will get
                back to you as soon as possible.
              </p>
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">
                Here is a summary of what you sent us:
              </p>
              ${details}`,
  });
  const text = [
    `We received your message - ${subject}`,
    ``,
    `Dear ${firstName},`,
    `Thank you for contacting Real English Academy.`,
    `Your message has been received successfully and we will get back to you as soon as possible.`,
    ``,
    `Here is a summary of what you sent us:`,
    ``,
    contactDetailsText({ firstName, lastName, email, phone, subject, message }),
  ].join('\n');
  return sendMail(email, `We received your message - ${subject}`, html, text);
}

// ─── 9. Announcement ────────────────────────────────────────────────────────

/**
 * Strips HTML tags and collapses whitespace for a plain-text summary.
 */
function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sends a "new announcement" email to a single student.
 * Subject:  New Announcement: {title}
 * Body:     title + ~180-character summary + CTA button to the announcement page.
 * @param {string} toEmail
 * @param {{id: string, title: string, content: string}} announcement
 */
async function sendAnnouncementEmail(toEmail, announcement) {
  const summary = stripHtml(announcement.content).slice(0, 180);
  const link = `${frontendUrl()}/announcements/${announcement.id}`;

  const bodyEn = `
              <p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 16px;">
                <strong style="color:${BRAND.primary};font-size:18px;">${esc(announcement.title)}</strong>
              </p>
              ${summary
                ? `<p style="color:${BRAND.text};font-size:15px;line-height:1.6;margin:0 0 28px;">${esc(summary)}${stripHtml(announcement.content).length > 180 ? '…' : ''}</p>`
                : '<p style="margin:0 0 28px;"></p>'}`;

  const html = buildLayout({
    subjectEn: `New Announcement: ${announcement.title}`,
    titleEn: 'New Announcement',
    bodyEn,
    cta: {
      labelEn: 'Read Announcement',
      href: link,
    },
    footerNoteEn: 'This is an automated notification — please do not reply.',
  });

  const text = [
    `New Announcement: ${announcement.title}`,
    '',
    summary || '(No summary available)',
    '',
    'Read Announcement:',
    link,
  ].join('\n');

  return sendMail(toEmail, `New Announcement: ${announcement.title}`, html, text);
}

/**
 * Sends the announcement email to EVERY student (role STUDENT) that has an
 * email address. Runs fire-and-forget style: errors are logged, never thrown.
 * @param {{id: string, title: string, content: string}} announcement
 * @returns {Promise<{sent: number, skipped: number, failed: number}>}
 */
async function notifyStudentsOfAnnouncement(announcement) {
  const prisma = require('../prisma');
  const students = await prisma.user.findMany({
    where: { role: 'STUDENT', email: { not: null } },
    select: { id: true, email: true },
  });

  let sent = 0;
  let failed = 0;
  for (const student of students) {
    const result = await sendAnnouncementEmail(student.email, announcement);
    if (result.sent) sent++;
    else failed++;
  }
  console.log(
    `[email] Announcement "${announcement.title}": ${sent} sent, ${failed} failed, ${students.length - sent - failed} skipped`
  );
  return { sent, skipped: students.length - sent - failed, failed };
}

module.exports = {
  isConfigured,
  sendInviteEmail,
  sendVideoCallEmail,
  sendCalendarEventEmail,
  sendWelcomeEmail,
  sendDailyQuizEmail,
  sendWeeklyQuizEmail,
  sendTournamentEmail,
  sendTournamentReminderEmail,
  sendContactNotificationEmail,
  sendContactConfirmationEmail,
  sendAnnouncementEmail,
  notifyStudentsOfAnnouncement,
};
