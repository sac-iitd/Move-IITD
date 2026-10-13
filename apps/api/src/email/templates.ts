import {
  CAMPUS_LABELS,
  ID_TYPE_LABELS,
  PURPOSE_LABELS,
  formatIst,
  formatTravelDate,
  formatWallTime,
  type Campus,
  type IdType,
  type NotificationType,
  type Purpose,
} from '@iitd-bus/shared';
import type { NotificationPayload } from './outbox';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

type Rows = [string, string][];
interface Section {
  title: string;
  rows: Rows;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const STATUS_LABEL = {
  CONFIRMED: 'Confirmed',
  WAITLISTED: 'Waitlisted',
  CANCELLED: 'Cancelled',
} as const;

function tripSection(p: NotificationPayload): Section {
  const rows: Rows = [];
  if (p.reference) rows.push(['Booking reference', p.reference]);
  if (p.status) rows.push(['Status', STATUS_LABEL[p.status]]);
  if (p.waitlistPosition) rows.push(['Waiting list position', `#${p.waitlistPosition}`]);
  rows.push(
    ['Travel date', formatTravelDate(p.travelDate!)],
    ['Departure', `${formatWallTime(p.departureTime!)} IST`],
    ['From', CAMPUS_LABELS[p.origin as Campus] ?? p.origin ?? ''],
    ['To', CAMPUS_LABELS[p.destination as Campus] ?? p.destination ?? ''],
    ['Vehicle', p.capacity ? `${p.serviceLabel} (${p.capacity} seats)` : (p.serviceLabel ?? '')],
  );
  if (p.reason) rows.push(['Reason', p.reason]);
  return { title: 'Trip details', rows };
}

function passengerSection(p: NotificationPayload): Section | null {
  const x = p.passenger;
  if (!x) return null;
  const rows: Rows = [
    ['Passenger', x.type === 'GUEST' ? `${x.name} (guest)` : x.name],
    ['ID proof to carry', ID_TYPE_LABELS[x.idType as IdType] ?? x.idType],
  ];
  if (x.idMasked) rows.push(['ID number', x.idMasked]);
  if (x.phone) rows.push(['Emergency contact', x.phone]);
  if (x.guestPhone) rows.push(['Guest phone', x.guestPhone]);
  const purpose = PURPOSE_LABELS[x.purpose as Purpose] ?? x.purpose;
  rows.push(['Purpose of visit', x.purposeDetail ? `${purpose}: ${x.purposeDetail}` : purpose]);
  if (x.type === 'GUEST') rows.push(['Booked by', x.bookedBy]);
  return { title: 'Passenger details', rows };
}

function layout(
  title: string,
  intro: string,
  sections: Section[],
  notes: string[],
  link: { href: string; label: string },
) {
  const text = [
    intro,
    ...sections.map(
      (s) => `${s.title.toUpperCase()}\n${s.rows.map(([k, v]) => `  ${k}: ${v}`).join('\n')}`,
    ),
    ...notes.map((n) => `- ${n}`),
    `${link.label}: ${link.href}`,
    '— MoveIITD · Student Affairs Council, IIT Delhi\nThis is an automated message. Please do not reply with passwords or personal documents.',
  ].join('\n\n');

  const sectionHtml = sections
    .map(
      (
        s,
      ) => `<h2 style="margin:20px 0 8px;font-size:15px;color:#6e4a16;text-transform:uppercase;letter-spacing:.04em">${esc(s.title)}</h2>
<table role="presentation" style="border-collapse:collapse;font-size:14px;width:100%">${s.rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:5px 12px 5px 0;color:#6e4a16;font-weight:600;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:5px 0;color:#2a1714">${esc(v)}</td></tr>`,
        )
        .join('')}</table>`,
    )
    .join('');
  const notesHtml = notes.length
    ? `<ul style="margin:20px 0 0;padding-left:20px;color:#2a1714;font-size:14px">${notes.map((n) => `<li style="margin:6px 0">${esc(n)}</li>`).join('')}</ul>`
    : '';
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#fbf6ee;font-family:Segoe UI,Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:580px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e7cc97">
<tr><td style="background:#2a1714;color:#d9ae5c;padding:16px 24px;font-size:18px;font-weight:700">MoveIITD · SAC Bus Service</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:20px;color:#2a1714">${esc(title)}</h1>
<p style="margin:0;color:#2a1714">${esc(intro)}</p>
${sectionHtml}
${notesHtml}
<p style="margin:24px 0 0"><a href="${esc(link.href)}" style="display:inline-block;background:#2a1714;color:#f3e6cc;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${esc(link.label)}</a></p>
</td></tr>
<tr><td style="padding:12px 24px;background:#f3e6cc;color:#6e4a16;font-size:12px">Student Affairs Council, IIT Delhi · Automated message. Please do not reply with passwords or personal documents.</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

/** Renders a notification. Payloads contain no secrets; ID numbers are masked. */
export function renderEmail(
  type: NotificationType,
  p: NotificationPayload,
  appUrl: string,
): RenderedEmail {
  const greeting = p.name ? `Dear ${p.name},` : 'Hello,';
  const when = p.travelDate
    ? `${formatWallTime(p.departureTime!)}, ${formatTravelDate(p.travelDate)}`
    : '';
  const ref = p.reference ? ` [${p.reference}]` : '';
  const sections = () =>
    [tripSection(p), passengerSection(p)].filter((s): s is Section => s !== null);
  // Guests cannot sign in as the booker, so their copy links to the home page instead.
  const bookingLink = p.guestCopy
    ? { href: `${appUrl}/`, label: 'About MoveIITD' }
    : { href: `${appUrl}/bookings/${p.reference ?? ''}`, label: 'View booking' };
  const dashLink = { href: `${appUrl}/dashboard`, label: 'Open MoveIITD' };
  const guestNote = p.guestCopy
    ? [
        `${p.passenger?.bookedBy ?? 'An IIT Delhi member'} booked this trip for you. Contact them for any changes.`,
      ]
    : [];
  const idNote = `Please bring your valid ID proof (${ID_TYPE_LABELS[(p.passenger?.idType ?? 'IITD_ID') as IdType]}) — it will be checked when boarding.`;
  const cancelNote = p.cancellationDeadline
    ? `Plans changed? Cancel from "My bookings" before ${formatIst(p.cancellationDeadline)} IST so someone on the waiting list gets the seat.`
    : 'Plans changed? Cancel from "My bookings" before 2:00 PM IST on the day before travel.';

  switch (type) {
    case 'BOOKING_CONFIRMATION': {
      const { text, html } = layout(
        'Your seat is confirmed',
        `${greeting} your seat on the MoveIITD shuttle is confirmed.`,
        sections(),
        [
          idNote,
          'Show this booking reference to the driver. Please be at the boarding point 10 minutes before departure. Seat numbers are not assigned.',
          ...(p.guestCopy ? [] : [cancelNote]),
          ...guestNote,
        ],
        bookingLink,
      );
      return { subject: `Booking confirmed: ${when}${ref}`, text, html };
    }
    case 'WAITLIST_JOINED': {
      const { text, html } = layout(
        "You're on the waiting list",
        `${greeting} this trip is full, so you've been added to the waiting list${p.waitlistPosition ? ` at position #${p.waitlistPosition}` : ''}.`,
        sections(),
        [
          'If a seat frees up before booking closes (4:00 PM IST the day before travel), it is given automatically to the first person on the list and you will get a confirmation email.',
          'If no seat frees up, your waiting-list entry is closed automatically and you will be informed.',
          'You can leave the waiting list any time from "My bookings".',
          ...guestNote,
        ],
        bookingLink,
      );
      return { subject: `Waiting list: ${when}${ref}`, text, html };
    }
    case 'WAITLIST_PROMOTED': {
      const { text, html } = layout(
        'Good news — you got a seat',
        `${greeting} a seat became available and your waiting-list booking is now CONFIRMED.`,
        sections(),
        [
          idNote,
          'Show this booking reference to the driver. Please be at the boarding point 10 minutes before departure.',
          ...(p.guestCopy ? [] : [cancelNote]),
          ...guestNote,
        ],
        bookingLink,
      );
      return { subject: `Seat confirmed from waiting list: ${when}${ref}`, text, html };
    }
    case 'WAITLIST_EXPIRED': {
      const { text, html } = layout(
        'Waiting list closed',
        `${greeting} unfortunately no seat became available on this trip before booking closed, so your waiting-list entry has been closed.`,
        sections(),
        ['Please check MoveIITD for other departures.'],
        dashLink,
      );
      return { subject: `No seat available: ${when}${ref}`, text, html };
    }
    case 'BOOKING_CANCELLATION': {
      const wasWaitlist = p.wasWaitlisted === true;
      const intro = p.cancelledByAdmin
        ? `${greeting} the transport office has cancelled this booking.`
        : wasWaitlist
          ? `${greeting} you have left the waiting list for this trip.`
          : `${greeting} this booking has been cancelled as requested and the seat released.`;
      const { text, html } = layout(
        'Booking cancelled',
        intro,
        sections(),
        ['You can book again from MoveIITD while booking for this trip is open.', ...guestNote],
        dashLink,
      );
      return { subject: `Booking cancelled: ${when}${ref}`, text, html };
    }
    case 'TRIP_CANCELLATION': {
      const { text, html } = layout(
        'Your trip has been cancelled',
        `${greeting} this departure has been cancelled by the transport office, so your booking on it is cancelled.`,
        sections(),
        [
          'We apologise for the inconvenience. Please check MoveIITD for other departures or special buses.',
          ...guestNote,
        ],
        dashLink,
      );
      return { subject: `Trip cancelled: ${when}${ref}`, text, html };
    }
    case 'USER_BLOCKED': {
      const rows: Rows = [
        ['Blocked from', p.blockedFrom ? formatTravelDate(p.blockedFrom) : '—'],
        ['Blocked until', p.blockedUntil ? formatTravelDate(p.blockedUntil) : '—'],
      ];
      if (p.reason) rows.push(['Reason', p.reason]);
      const { text, html } = layout(
        'Booking access paused',
        `${greeting} your MoveIITD booking access has been paused by the administrators.`,
        [{ title: 'Details', rows }],
        [
          'Any of your bookings for trips in this period have been cancelled; you will receive a separate email for each.',
          'You can still sign in to see your bookings. Booking will be available again after the end date.',
          'If you think this is a mistake, contact the Student Affairs Council.',
        ],
        dashLink,
      );
      return { subject: 'MoveIITD booking access paused', text, html };
    }
  }
}
