const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

const sentMessages = [];
process.env.MAIL_USER = 'test@example.com';
process.env.MAIL_PASS = 'test-password';
process.env.FRONTEND_URL = 'https://academy.example';

nodemailer.createTransport = () => ({
  sendMail: async (message) => sentMessages.push(message),
});

const email = require('./email');

test('all email templates show their title above one inline logo only', async () => {
  await Promise.all([
    email.sendInviteEmail('student@example.com', 'STUDENT', 'https://academy.example/invite'),
    email.sendVideoCallEmail('student@example.com', {
      title: 'Speaking Practice',
      description: 'Weekly session',
      startDate: '2025-04-14T10:00:00Z',
      startTime: '10:00',
      endTime: '10:30',
      roomUrl: 'https://academy.example/video-calls/room/test',
      hostName: 'Alex',
    }),
    email.sendCalendarEventEmail('student@example.com', {
      title: 'English Lesson',
      description: 'Unit 4',
      type: 'LESSON',
      mode: 'VIDEO',
      startDate: '2025-04-14T10:00:00Z',
      startTime: '10:00',
      endTime: '10:30',
      isRecurring: true,
      endDate: '2025-05-14T10:00:00Z',
      daysOfWeek: [1, 3],
      hostName: 'Alex',
    }),
    email.sendWelcomeEmail('student@example.com', {
      firstName: 'Sam',
      username: 'sam',
      role: 'STUDENT',
    }),
    email.sendDailyQuizEmail('student@example.com', { firstName: 'Sam', username: 'sam' }),
    email.sendWeeklyQuizEmail('student@example.com', { firstName: 'Sam', username: 'sam' }),
    email.sendTournamentEmail('student@example.com', {
      name: 'Spring Tournament',
      scheduledAt: '2025-04-14T10:00:00Z',
      durationMin: 20,
      finalDurationMin: 30,
      organizerName: 'Alex',
    }),
    email.sendContactNotificationEmail({
      firstName: 'Sam',
      lastName: 'Taylor',
      email: 'sam@example.com',
      phone: '555-0100',
      subject: 'Course question',
      message: 'Please send course information.',
    }),
    email.sendContactConfirmationEmail({
      firstName: 'Sam',
      lastName: 'Taylor',
      email: 'sam@example.com',
      phone: '555-0100',
      subject: 'Course question',
      message: 'Please send course information.',
    }),
    email.sendAnnouncementEmail('student@example.com', {
      id: 'announcement-1',
      title: 'New Course',
      content: '<p>Registration is now open.</p>',
    }),
  ]);

  assert.equal(sentMessages.length, 10);
  const expectedTitles = [
    'Welcome to Real English Academy',
    'Video Call Invitation',
    'Lesson Scheduled',
    'Welcome to Real English Academy',
    'Daily Quiz',
    'Weekly Quiz',
    'You are in a Tournament!',
    'New Contact Message',
    'Thank you for reaching out!',
    'New Announcement',
  ];
  const headers = sentMessages.map((message) =>
    message.html.match(/<td style="background:linear-gradient\(135deg,[\s\S]*?<\/td>/)?.[0]
  );
  assert.ok(headers.every(Boolean));

  for (const [index, message] of sentMessages.entries()) {
    const titleAndLogo = headers[index].match(
      /<h1[^>]*>([\s\S]*?)<\/h1>\s*<img[^>]*src="cid:academy-logo@realenglishacademy"/
    );
    assert.ok(titleAndLogo, `Email ${index + 1} should show its logo immediately below the title`);
    assert.equal(titleAndLogo[1].trim(), expectedTitles[index]);
    assert.deepEqual(
      message.attachments.map(({ filename, cid, contentDisposition }) => ({
        filename,
        cid,
        contentDisposition,
      })),
      [{
        filename: 'REALLogo1.png',
        cid: 'academy-logo@realenglishacademy',
        contentDisposition: 'inline',
      }]
    );
    assert.match(message.html, /src="cid:academy-logo@realenglishacademy"/);
    assert.doesNotMatch(message.html, /https:\/\/academy\.example\/REALLogo1\.png/);
    assert.doesNotMatch(`${message.subject}\n${message.html}\n${message.text}`, /[\u0370-\u03FF\u1F00-\u1FFF]/u);
  }
});
