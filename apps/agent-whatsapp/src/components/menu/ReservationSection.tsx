'use client';

import { useMemo, useState } from 'react';
import {
  EMPTY_RESERVATION,
  MAX_NOTES_LENGTH,
  MAX_PARTY_SIZE,
  reservationMessage,
  reservationUrl,
  todayIn,
  validateReservation,
  type ReservationErrors,
  type ReservationFields,
} from '@/lib/menu/reservation';
import { restaurantProfile } from '@/lib/restaurant/profile';

/**
 * Reservar una mesa desde la carta.
 *
 * El formulario no guarda nada en ningún lado: arma el mensaje y abre el chat
 * de WhatsApp del local con la reserva ya escrita. La confirma una persona,
 * que es quien sabe si esa noche hay mesa. Por eso el botón dice «pedir» y no
 * «reservar»: prometer la mesa aquí sería prometer algo que el menú no sabe.
 *
 * `chatUrl` es el chat del local (`wa.me`). Sin él no hay a quién mandarle la
 * reserva, y quien arma la página no monta esta sección (salvo en desarrollo,
 * para poder verla: entonces el botón queda apagado y lo dice).
 *
 * `presetNote` deja escrita la nota desde fuera del formulario: «Reservar con
 * este combo» en un cumpleaños. Cada `serial` nuevo la vuelve a escribir, sin
 * tocar lo demás que el cliente ya llenó.
 */
export function ReservationSection({
  chatUrl,
  presetNote = null,
}: {
  chatUrl: string | null;
  presetNote?: { text: string; serial: number } | null;
}) {
  const profile = restaurantProfile();
  const [fields, setFields] = useState<ReservationFields>(EMPTY_RESERVATION);
  const [errors, setErrors] = useState<ReservationErrors>({});
  const today = useMemo(() => todayIn(profile.timezone), [profile.timezone]);

  // Durante el render y no en un efecto: la nota aparece en el mismo cuadro.
  const [presetSerial, setPresetSerial] = useState<number | null>(null);
  if (presetNote && presetNote.serial !== presetSerial) {
    setPresetSerial(presetNote.serial);
    setFields((current) => ({ ...current, notes: presetNote.text.slice(0, MAX_NOTES_LENGTH) }));
    setErrors((current) => ({ ...current, notes: undefined }));
  }

  const set = <K extends keyof ReservationFields>(key: K, value: ReservationFields[K]) => {
    setFields((current) => ({ ...current, [key]: value }));
    // El error de un campo se va en cuanto se lo toca: no se queda acusando.
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const found = validateReservation(fields, today);
    setErrors(found);
    if (Object.values(found).some(Boolean) || !chatUrl) return;
    // En la misma pestaña: en el celular esto abre WhatsApp, y al volver el
    // menú sigue donde estaba.
    window.location.href = reservationUrl(chatUrl, reservationMessage(fields, profile.locale));
  };

  const field =
    'font-menu-body mt-1.5 block w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-base text-white placeholder:text-white/35 focus:border-menu-accent focus:ring-2 focus:ring-menu-accent/40 focus:outline-none [color-scheme:dark]';
  const label = 'font-menu-body block text-xs font-semibold tracking-wide text-white/70 uppercase';
  const problem = 'mt-1 text-xs font-medium text-amber-300';

  return (
    <form
      onSubmit={submit}
      noValidate
      className="mx-auto w-full max-w-md rounded-3xl border border-menu-accent/30 bg-menu-surface/85 p-5 shadow-lg shadow-black/40 backdrop-blur-sm"
    >
      <p className="font-menu-body text-sm leading-relaxed text-white/85">
        Dinos cuándo vienen y cuántos son. Te confirmamos la mesa por WhatsApp.
      </p>

      {/* Uno debajo del otro en el celular: lado a lado, el navegador corta el
          texto de su propio selector de fecha («dd/mm/aa…»). */}
      <div className="mt-4 grid grid-cols-1 gap-3 min-[460px]:grid-cols-2">
        <div>
          <label htmlFor="reserva-dia" className={label}>
            Día
          </label>
          <input
            id="reserva-dia"
            type="date"
            min={today}
            value={fields.date}
            onChange={(event) => set('date', event.target.value)}
            aria-invalid={errors.date ? true : undefined}
            className={field}
          />
          {errors.date ? <p className={problem}>{errors.date}</p> : null}
        </div>
        <div>
          <label htmlFor="reserva-hora" className={label}>
            Hora
          </label>
          <input
            id="reserva-hora"
            type="time"
            step={900}
            value={fields.time}
            onChange={(event) => set('time', event.target.value)}
            aria-invalid={errors.time ? true : undefined}
            className={field}
          />
          {errors.time ? <p className={problem}>{errors.time}</p> : null}
        </div>
      </div>

      <div className="mt-3">
        <span id="reserva-personas" className={label}>
          Personas
        </span>
        <div className="mt-1.5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => set('people', Math.max(1, fields.people - 1))}
            disabled={fields.people <= 1}
            aria-label="Una persona menos"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.08] text-2xl leading-none text-white ring-1 ring-white/20 disabled:opacity-35"
          >
            −
          </button>
          <output
            aria-labelledby="reserva-personas"
            aria-live="polite"
            className="font-menu-body min-w-12 text-center text-3xl font-bold text-white tabular-nums"
          >
            {fields.people}
          </output>
          <button
            type="button"
            onClick={() => set('people', Math.min(MAX_PARTY_SIZE, fields.people + 1))}
            disabled={fields.people >= MAX_PARTY_SIZE}
            aria-label="Una persona más"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-menu-accent/25 text-2xl leading-none text-menu-accent ring-1 ring-menu-accent/60 disabled:opacity-35"
          >
            +
          </button>
        </div>
        {errors.people ? <p className={problem}>{errors.people}</p> : null}
      </div>

      <div className="mt-3">
        <label htmlFor="reserva-nombre" className={label}>
          A nombre de
        </label>
        <input
          id="reserva-nombre"
          type="text"
          autoComplete="name"
          maxLength={60}
          value={fields.name}
          onChange={(event) => set('name', event.target.value)}
          aria-invalid={errors.name ? true : undefined}
          className={field}
        />
        {errors.name ? <p className={problem}>{errors.name}</p> : null}
      </div>

      <div className="mt-3">
        <label htmlFor="reserva-nota" className={label}>
          Algo que debamos saber <span className="font-normal normal-case text-white/45">(opcional)</span>
        </label>
        <textarea
          id="reserva-nota"
          rows={2}
          maxLength={MAX_NOTES_LENGTH}
          placeholder="Un cumpleaños, una silla para bebé…"
          value={fields.notes}
          onChange={(event) => set('notes', event.target.value)}
          className={`${field} resize-none`}
        />
        {errors.notes ? <p className={problem}>{errors.notes}</p> : null}
      </div>

      <button
        type="submit"
        disabled={!chatUrl}
        className="font-menu-body mt-5 flex w-full items-center justify-center rounded-full bg-menu-accent px-5 py-4 text-base font-bold text-menu-night shadow-lg shadow-black/30 transition-transform active:scale-[0.98] disabled:opacity-45"
      >
        Pedir la reserva por WhatsApp
      </button>
      {chatUrl ? null : (
        <p className="mt-2 text-center text-xs text-amber-300">
          Falta configurar el número de WhatsApp del local (WHATSAPP_BUSINESS_NUMBER).
        </p>
      )}
    </form>
  );
}
