import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Html5Qrcode } from 'html5-qrcode';
import {
  DIRECTION_LABELS,
  istDateOf,
  type BoardingScanResponse,
  type ConductorRosterDto,
  type ConductorTripDto,
} from '@iitd-bus/shared';
import { api } from '../api/client';
import { SpecialBadge } from '../components/Badges';
import { useToast } from '../components/Toast';
import { Alert, EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../components/ui';
import { errorMessage, formatIst, formatTravelDate, formatWallTime } from '../lib/format';

const RESULT_TONE: Record<BoardingScanResponse['result'], 'success' | 'warning' | 'error'> = {
  BOARDED: 'success',
  ALREADY_BOARDED: 'warning',
  WRONG_TRIP: 'error',
  CANCELLED: 'error',
  NOT_CONFIRMED: 'error',
  TRIP_CANCELLED: 'error',
  INVALID: 'error',
};

export function ConductPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [date, setDate] = useState(() => istDateOf(new Date()));
  const tripId = params.get('trip');
  const [manual, setManual] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [last, setLast] = useState<BoardingScanResponse | null>(null);
  const onCode = useRef<(code: string) => void>(() => {});

  const trips = useQuery({
    queryKey: ['boarding', 'trips', date],
    queryFn: () => api<{ date: string; trips: ConductorTripDto[] }>(`/boarding/trips?date=${date}`),
  });
  const roster = useQuery({
    queryKey: ['boarding', 'roster', tripId],
    enabled: Boolean(tripId),
    refetchInterval: 4000,
    queryFn: () => api<ConductorRosterDto>(`/boarding/trips/${tripId}`),
  });

  const scan = useMutation({
    mutationFn: (code: string) =>
      api<BoardingScanResponse>('/boarding/scans', {
        method: 'POST',
        body: { tripId, code },
      }),
    onSuccess: (result) => {
      setLast(result);
      if (result.result === 'BOARDED') toast(`${result.passengerName} is boarded.`, 'success');
      void qc.invalidateQueries({ queryKey: ['boarding'] });
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const busy = useRef(false);
  const recent = useRef<{ code: string; at: number } | null>(null);
  onCode.current = (code: string) => {
    if (!tripId || busy.current) return;
    const now = Date.now();
    if (recent.current && recent.current.code === code && now - recent.current.at < 4000) return;
    recent.current = { code, at: now };
    busy.current = true;
    scan.mutate(code, {
      onSettled: () => {
        busy.current = false;
      },
    });
  };

  useEffect(() => {
    if (!tripId) return;
    const scanner = new Html5Qrcode('qr-reader');
    let stopped = false;
    setCameraError(null);
    void scanner
      .start(
        { facingMode: 'environment' },
        { fps: 8, qrbox: { width: 240, height: 240 } },
        (text) => onCode.current(text),
        () => {},
      )
      .catch(() => {
        if (!stopped) {
          setCameraError('The camera could not be started. You can type the code instead.');
        }
      });
    return () => {
      stopped = true;
      // stop() throws synchronously when the camera never started (permission
      // denied, or React running the effect cleanup before start() resolves).
      const shutdown = () => {
        try {
          scanner.clear();
        } catch {
          // The element is already gone.
        }
      };
      try {
        void scanner.stop().then(shutdown, shutdown);
      } catch {
        shutdown();
      }
    };
  }, [tripId]);

  const selected = trips.data?.trips.find((t) => t.id === tripId) ?? roster.data?.trip ?? null;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Scan tickets">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Travel date</span>
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setParams({});
              setLast(null);
            }}
          />
        </label>
      </PageHeader>

      {!tripId ? (
        <TripPicker
          loading={trips.isPending}
          error={trips.error}
          onRetry={() => void trips.refetch()}
          trips={trips.data?.trips ?? []}
          onPick={(id) => {
            setLast(null);
            setParams({ trip: id });
          }}
        />
      ) : (
        <div className="space-y-4">
          <div className="card flex items-start justify-between gap-3 p-4">
            <div>
              <p className="font-semibold">
                {selected ? formatWallTime(selected.departureTime) : 'Selected vehicle'}{' '}
                {selected ? `· ${selected.serviceLabel}` : ''}
              </p>
              {selected && (
                <p className="text-sm text-ink-800">
                  {formatTravelDate(selected.travelDate)} · {DIRECTION_LABELS[selected.direction]}
                </p>
              )}
              {selected && (
                <p className="mt-1 text-sm">
                  <strong>{selected.boardedCount}</strong> boarded of {selected.bookedCount} booked
                </p>
              )}
            </div>
            <button
              type="button"
              className="btn-secondary min-h-9 px-3 py-1"
              onClick={() => {
                setParams({});
                setLast(null);
              }}
            >
              Change
            </button>
          </div>

          {selected?.status === 'CANCELLED' && (
            <Alert tone="error" title="This departure is cancelled">
              Passes cannot be scanned for it.
            </Alert>
          )}

          <div id="qr-reader" className="overflow-hidden rounded-xl bg-black" />
          {cameraError && <Alert tone="warning">{cameraError}</Alert>}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const code = manual.trim();
              if (code) onCode.current(code);
              setManual('');
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">Ticket code</span>
              <input
                className="input"
                value={manual}
                placeholder="Or paste the ticket code"
                onChange={(e) => setManual(e.target.value)}
              />
            </label>
            <button type="submit" className="btn-primary" disabled={scan.isPending}>
              Check
            </button>
          </form>

          {last && (
            <Alert tone={RESULT_TONE[last.result]} title={last.passengerName ?? 'Scan result'}>
              {last.message}
            </Alert>
          )}

          <section aria-labelledby="boarded-h">
            <h2 id="boarded-h" className="mb-2 text-lg font-bold">
              Boarded
            </h2>
            {roster.isPending ? (
              <LoadingSkeleton rows={2} label="Loading boarded passengers" />
            ) : roster.isError ? (
              <ErrorState error={roster.error} onRetry={() => void roster.refetch()} />
            ) : (roster.data?.boarded.length ?? 0) === 0 ? (
              <p className="text-sm text-ink-800">No one has boarded yet.</p>
            ) : (
              <ol className="card divide-y divide-ink-900/10">
                {roster.data?.boarded.map((person, i) => (
                  <li
                    key={`${person.boardedAt}-${person.name}-${i}`}
                    className="flex justify-between gap-3 px-4 py-2 text-sm"
                  >
                    <span className="font-medium">{person.name}</span>
                    <span className="text-ink-800">{formatIst(person.boardedAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function TripPicker({
  loading,
  error,
  onRetry,
  trips,
  onPick,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  trips: ConductorTripDto[];
  onPick: (id: string) => void;
}) {
  if (loading) return <LoadingSkeleton rows={3} label="Loading vehicles" />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  const running = trips.filter((t) => t.status === 'SCHEDULED');
  if (running.length === 0) {
    return <EmptyState title="No vehicles on this date">Choose another travel date.</EmptyState>;
  }
  return (
    <ul className="space-y-3">
      {running.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            className="card flex w-full items-center gap-3 p-4 text-left"
            onClick={() => onPick(t.id)}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-900 text-sm font-bold text-brand-200">
              {t.vehicleNumber ?? t.serviceLabel.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">
                {formatWallTime(t.departureTime)} · {t.serviceLabel}
                {t.isSpecial && (
                  <span className="ml-2">
                    <SpecialBadge />
                  </span>
                )}
              </span>
              <span className="block text-sm text-ink-800">{DIRECTION_LABELS[t.direction]}</span>
              <span className="block text-xs text-ink-800">
                {t.boardedCount} boarded of {t.bookedCount} booked
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
