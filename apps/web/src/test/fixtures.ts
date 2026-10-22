import type { BookingDto, TripDto } from '@iitd-bus/shared';

export function tripFixture(overrides: Partial<TripDto> = {}): TripDto {
  return {
    id: 'trip1',
    serviceLabel: 'Bus 2',
    travelDate: '2026-10-19',
    origin: 'DELHI',
    destination: 'SONIPAT',
    direction: 'DELHI_TO_SONIPAT',
    departureTime: '10:00',
    departureAt: '2026-10-19T04:30:00.000Z',
    capacity: 13,
    bookedCount: 4,
    seatsRemaining: 9,
    status: 'SCHEDULED',
    bookingOpensAt: '2026-10-11T18:30:00.000Z',
    bookingClosesAt: '2026-10-16T10:30:00.000Z',
    cancellationClosesAt: '2026-10-16T10:30:00.000Z',
    availability: 'OPEN',
    timeProvisional: false,
    isSpecial: false,
    waitlistCount: 0,
    myBookings: [],
    ...overrides,
  };
}

export function bookingFixture(overrides: Partial<BookingDto> = {}): BookingDto {
  return {
    reference: 'SNP-7K3M-Q9XD',
    status: 'CONFIRMED',
    bookedAt: '2026-10-14T05:00:00.000Z',
    cancelledAt: null,
    cancellationReason: null,
    cancelledByAdmin: false,
    canCancel: true,
    trip: tripFixture({
      myBookings: [
        {
          reference: 'SNP-7K3M-Q9XD',
          status: 'CONFIRMED',
          passengerType: 'SELF',
          passengerName: 'Asha Kumar',
        },
      ],
      bookedCount: 5,
      seatsRemaining: 8,
    }),
    emailStatus: 'PENDING',
    waitlistPosition: null,
    boardingCode: 'MIITD1.abcdefghijklmnopqrstuvwx',
    boardedAt: null,
    passenger: {
      type: 'SELF',
      name: 'Asha Kumar',
      email: 'asha@iitd.ac.in',
      phone: '9876543210',
      guestPhone: null,
      purpose: 'ACADEMIC',
      purposeDetail: null,
      idType: 'IITD_ID',
      idNumberMasked: 'asha',
    },
    ...overrides,
  };
}
