import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Page } from '../../components/Layout';
import { Button, Card, ErrorNote, Field, Input, PageHeader, Spinner, Toggle, toast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { keys, useSettings } from '../../lib/queries';
import type { OperationalSettings } from '../../lib/types';

interface Form {
  restaurantName: string;
  pickupEnabled: boolean;
  rainSurchargeEnabled: boolean;
  rainSurchargeAmount: string;
  businessOpensHour: string;
  businessClosesHour: string;
  restaurantLatitude: string;
  restaurantLongitude: string;
}

function toForm(settings: OperationalSettings): Form {
  return {
    restaurantName: settings.restaurantName,
    pickupEnabled: settings.pickupEnabled,
    rainSurchargeEnabled: settings.rainSurchargeEnabled,
    rainSurchargeAmount: String(settings.rainSurchargeAmount),
    businessOpensHour: String(settings.businessOpensHour),
    businessClosesHour: String(settings.businessClosesHour),
    restaurantLatitude: settings.restaurantLatitude === null ? '' : String(settings.restaurantLatitude),
    restaurantLongitude: settings.restaurantLongitude === null ? '' : String(settings.restaurantLongitude),
  };
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const [form, setForm] = useState<Form | null>(null);

  // Solo la primera vez: la pausa se guarda aparte y no debe pisar lo que se está editando.
  useEffect(() => {
    if (settings.data) setForm((current) => current ?? toForm(settings.data));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (values: Form) =>
      api.patch<OperationalSettings>('/operational-settings', {
        restaurantName: values.restaurantName.trim(),
        pickupEnabled: values.pickupEnabled,
        rainSurchargeEnabled: values.rainSurchargeEnabled,
        rainSurchargeAmount: Number(values.rainSurchargeAmount) || 0,
        businessOpensHour: Math.trunc(Number(values.businessOpensHour)),
        businessClosesHour: Math.trunc(Number(values.businessClosesHour)),
        // Las coordenadas no admiten vacío: solo se mandan si están completas.
        ...(values.restaurantLatitude !== '' && values.restaurantLongitude !== ''
          ? { restaurantLatitude: Number(values.restaurantLatitude), restaurantLongitude: Number(values.restaurantLongitude) }
          : {}),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(keys.settings, saved);
      toast.ok('Configuración guardada.');
    },
  });

  // La pausa se guarda al instante: es el botón de emergencia cuando la cocina se satura.
  const pause = useMutation({
    mutationFn: (ordersPaused: boolean) => api.patch<OperationalSettings>('/operational-settings', { ordersPaused }),
    onSuccess: (saved) => {
      queryClient.setQueryData(keys.settings, saved);
      toast.ok(saved.ordersPaused ? 'Pedidos por WhatsApp y web en pausa.' : 'Se reanudaron los pedidos.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (form) save.mutate(form);
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => (current ? { ...current, [key]: value } : current));

  return (
    <Page className="max-w-3xl">
      <PageHeader title="Configuración" subtitle="Datos operativos del local. El POS siempre puede vender, incluso con los pedidos en pausa." />

      {settings.isPending && (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner className="h-8 w-8" />
        </div>
      )}
      {settings.isError && <ErrorNote>{errorMessage(settings.error)}</ErrorNote>}

      {form && settings.data && (
        <form onSubmit={submit} className="space-y-4">
          <Card className={settings.data.ordersPaused ? 'border-l-4 border-red-500 p-5' : 'p-5'}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-bold">Pausar pedidos de WhatsApp y web</h2>
                <p className="text-sm text-slate-500">Para cuando la cocina está saturada. Los pedidos ya tomados siguen su curso.</p>
              </div>
              <Toggle label="Pausar pedidos" checked={settings.data.ordersPaused} disabled={pause.isPending} onChange={(value) => pause.mutate(value)} />
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-bold">Local</h2>
            <div className="sm:max-w-sm">
              <Field label="Nombre del local" hint="Se ve en el encabezado y en el ticket.">
                <Input required maxLength={80} value={form.restaurantName} onChange={(event) => set('restaurantName', event.target.value)} />
              </Field>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-bold">Atención</h2>
            <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
              <Field label="Abre (hora)">
                <Input type="number" min={0} max={23} step="1" required value={form.businessOpensHour} onChange={(event) => set('businessOpensHour', event.target.value)} />
              </Field>
              <Field label="Cierra (hora)">
                <Input type="number" min={0} max={23} step="1" required value={form.businessClosesHour} onChange={(event) => set('businessClosesHour', event.target.value)} />
              </Field>
            </div>
            <p className="text-xs text-slate-500">
              Es un margen amplio, de 0 a 23, y puede cruzar la medianoche. La misma hora en los dos campos significa abierto las 24 horas. Dentro de ese margen, un pedido de WhatsApp se confirma solo si la caja está abierta; si no, queda esperando que lo
              acepten.
            </p>
            <label className="flex items-center gap-3 text-sm">
              <Toggle label="Permitir retiro en el local" checked={form.pickupEnabled} onChange={(value) => set('pickupEnabled', value)} />
              Permitir retiro en el local por WhatsApp
            </label>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-bold">Delivery</h2>
            <label className="flex items-center gap-3 text-sm">
              <Toggle label="Recargo por lluvia" checked={form.rainSurchargeEnabled} onChange={(value) => set('rainSurchargeEnabled', value)} />
              Cobrar recargo por lluvia
            </label>
            <div className="sm:max-w-40">
              <Field label="Recargo por lluvia (Bs)">
                <Input type="number" inputMode="decimal" min={0} step="0.5" value={form.rainSurchargeAmount} onChange={(event) => set('rainSurchargeAmount', event.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              <Field label="Latitud del local">
                <Input type="number" step="any" min={-90} max={90} value={form.restaurantLatitude} onChange={(event) => set('restaurantLatitude', event.target.value)} />
              </Field>
              <Field label="Longitud del local">
                <Input type="number" step="any" min={-180} max={180} value={form.restaurantLongitude} onChange={(event) => set('restaurantLongitude', event.target.value)} />
              </Field>
            </div>
            <p className="text-xs text-slate-500">Desde este punto se mide la distancia para cotizar el envío.</p>
          </Card>

          {save.isError && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
          <Button type="submit" size="lg" busy={save.isPending}>
            Guardar cambios
          </Button>
        </form>
      )}
    </Page>
  );
}
