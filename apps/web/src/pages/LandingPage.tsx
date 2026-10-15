import { Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DIRECTIONS, DIRECTION_LABELS, type PublicScheduleResponse } from '@iitd-bus/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { DirectionBadge } from '../components/Badges';
import { Alert, LoadingSkeleton } from '../components/ui';
import { formatWallTime } from '../lib/format';

const logoSrc = `${import.meta.env.BASE_URL}sac-logo.png`;

export function LandingPage() {
  const { user, login, loading } = useAuth();
  const [params] = useSearchParams();
  const schedule = useQuery({
    queryKey: ['schedule'],
    queryFn: () => api<PublicScheduleResponse>('/schedule'),
  });

  if (!loading && user && !params.has('signedOut')) return <Navigate to="/dashboard" replace />;

  const services = schedule.data?.services ?? [];
  const provisional = services.some((s) => s.timeProvisional);

  return (
    <div className="space-y-10">
      {params.has('signedOut') && <Alert tone="success">You have been signed out.</Alert>}

      <section className="overflow-hidden rounded-2xl bg-ink-900 text-brand-100 shadow-lg">
        <div className="grid items-center gap-6 p-6 sm:p-10 md:grid-cols-[1fr_auto]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-300">
              Student Affairs Council · IIT Delhi
            </p>
            <h1 className="mt-2 text-3xl font-bold leading-tight text-white sm:text-4xl">
              MoveIITD campus shuttle
            </h1>
            <p className="mt-3 max-w-xl text-brand-100/90">
              Reserve a seat on the shuttle between IIT Delhi Hauz Khas Campus and IIT Delhi
              Sonipat Campus. Buses run Monday to Friday. Sign in with your IIT Delhi Kerberos
              account to book.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" className="btn-gold px-6 text-base" onClick={() => login()}>
                Sign in with Kerberos
              </button>
            </div>
          </div>
          <img
            src={logoSrc}
            alt="Student Affairs Council crest"
            className="mx-auto hidden h-44 w-44 md:block"
          />
        </div>
      </section>

      <section aria-labelledby="timetable-h">
        <h2 id="timetable-h" className="text-xl font-bold">
          Weekday timetable
        </h2>
        <div className="mt-3">
          {schedule.isPending ? (
            <LoadingSkeleton rows={2} label="Loading timetable" />
          ) : schedule.isError ? (
            <Alert tone="warning">The timetable could not be loaded right now.</Alert>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {DIRECTIONS.map((direction) => (
                  <div key={direction} className="card overflow-x-auto">
                    <h3 className="px-4 pt-3 pb-2">
                      <DirectionBadge direction={direction} />
                    </h3>
                    <table className="w-full text-left text-sm">
                      <caption className="sr-only">
                        Weekday departures, {DIRECTION_LABELS[direction]}
                      </caption>
                      <thead className="bg-brand-100 text-ink-900">
                        <tr>
                          <th scope="col" className="px-4 py-2">
                            Departure
                          </th>
                          <th scope="col" className="px-4 py-2">
                            Service
                          </th>
                          <th scope="col" className="px-4 py-2">
                            Seats
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {services
                          .filter((s) => s.direction === direction)
                          .sort((a, b) => a.departureTime.localeCompare(b.departureTime))
                          .map((s) => (
                            <tr
                              key={`${s.serviceLabel}-${s.departureTime}-${s.origin}`}
                              className="border-t border-ink-900/10"
                            >
                              <td className="px-4 py-2 font-semibold tabular-nums">
                                {formatWallTime(s.departureTime)}
                                {s.timeProvisional && (
                                  <span className="ml-1 text-amber-800" title="Time to be confirmed">
                                    *
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2">{s.serviceLabel}</td>
                              <td className="px-4 py-2 tabular-nums">{s.capacity}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
              {provisional && (
                <p className="mt-2 text-xs text-amber-900">
                  * Departure time awaiting confirmation by the transport office.
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="rules-h" className="grid gap-4 md:grid-cols-3">
        <h2 id="rules-h" className="sr-only">
          Booking rules
        </h2>
        <div className="card p-5">
          <h3 className="font-bold">When can I book?</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            <li>Booking opens 7 days before travel.</li>
            <li>Booking will close at 4:00 PM IST the day before travel.</li>
            <li>
              <strong>Booking for Monday trips closes on Friday at 4:00 PM.</strong>
            </li>
            <li>Regular bus booking will be allowed from Monday to Friday.</li>
          </ul>
        </div>
        <div className="card p-5">
          <h3 className="font-bold">Seats, Guests &amp; ID Requirements</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            <li>Up to 2 seats per person per trip may be booked for yourself and/or a guest.</li>
            <li>Bookings for non-IIT Delhi visitors are permitted only for official purposes.</li>
            <li>IIT Delhi members must carry their valid, institute-issued ID card.</li>
            <li>
              Visitors must carry a valid government-issued photo ID. IDs will be verified during
              boarding.
            </li>
            <li>
              A booking reference and confirmation email will be provided upon successful booking.
            </li>
            <li>
              Bookings can be cancelled until 2:00 PM on the day before travel (Friday for Monday
              trips).
            </li>
          </ul>
        </div>
        <div className="card p-5">
          <h3 className="font-bold">Waiting list</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            <li>
              Full trip? Join the waiting list. The first person gets the next free seat
              automatically.
            </li>
            <li>Seats can be given from the waiting list until booking closes.</li>
            <li>Seat numbers are not assigned.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
